import { useSyncExternalStore } from 'react';
import { AppRegistry, AppState, NativeModules, PermissionsAndroid, Platform } from 'react-native';
import RNCallKeep, { type InitialEvents } from 'react-native-callkeep';
import type { MessengerClient, MessengerSnapshot } from '@messenger/core';
import { registerMessengerObserver, retainMessenger } from './runtime';
import { WakeTaskRegistry } from './wake-model';
import { CallTaskRegistry, SystemCallController } from './system-call-model';
const android = Platform.OS === 'android';
const options = {
  ios: { appName: 'LastCall', supportsVideo: false },
  android: { alertTitle: 'Системные звонки LastCall', alertDescription: 'Разрешите звонки и включите LastCall в телефонных аккаунтах Android.', cancelButton: 'Позже', okButton: 'Настроить', additionalPermissions: [], selfManaged: false,
    foregroundService: { channelId: 'lastcall-system-calls', channelName: 'Звонки LastCall', notificationTitle: 'LastCall · входящий звонок', notificationIcon: 'ic_launcher', foregroundServiceType: 4 } },
};
let initialized: Promise<boolean> | undefined;
let enabled = false;
let status = android ? 'Системный экран звонков ещё не включён.' : 'Системные звонки iOS требуют отдельной настройки APNs/CallKit.';
const listeners = new Set<() => void>();
function publish(text: string) { status = text; listeners.forEach(listener => listener()); }
const audio = NativeModules.LastCallAudio as { start(id: string, video: boolean): Promise<boolean>; stop(id: string): void; holdHost(id: string): void; releaseHost(id: string): void; holdWakeHost(id: string): Promise<boolean>; releaseWakeHost(id: string): void } | undefined;
const callTasks = new CallTaskRegistry();
const wakeTasks = new WakeTaskRegistry();
export async function retainWakeRuntime(id: string): Promise<() => void> {
  if (!android || !audio?.holdWakeHost) return () => {};
  const release = wakeTasks.acquire(id);
  try { await audio.holdWakeHost(id); }
  catch { if (release()) audio.releaseWakeHost(id); throw new Error('Background timer ownership unavailable'); }
  return () => { if (release()) audio.releaseWakeHost(id); };
}
function retainCall(manager: MessengerClient, id: string): () => void {
  callTasks.claim(id); const release = retainMessenger(manager); audio?.holdHost(id);
  return () => { void release().finally(() => { callTasks.release(id); audio?.releaseHost(id); }).catch(() => {}); };
}
const controller = new SystemCallController({
  present: async (uuid, name, video) => {
    await initialize(); if (!enabled) return false;
    RNCallKeep.displayIncomingCall(uuid, 'LastCall', name, 'generic', video); return true;
  },
  activate: uuid => RNCallKeep.setCurrentCallActive(uuid),
  end: uuid => RNCallKeep.endCall(uuid),
  startAudio: async (uuid, video) => {
    if (!(await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO))) throw new Error('Microphone must be granted in foreground');
    if (video && !(await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.CAMERA))) throw new Error('Camera must be granted in foreground');
    if (!audio) throw new Error('Native call audio service unavailable'); await audio.start(uuid, video);
  },
  stopAudio: uuid => audio?.stop(uuid),
  retain: (manager, uuid) => retainCall(manager as MessengerClient, uuid),
});
function initial(events: InitialEvents) {
  for (const event of events) {
    if (event.name === 'RNCallKeepPerformAnswerCallAction') void controller.answer(event.data.callUUID);
    if (event.name === 'RNCallKeepPerformEndCallAction') controller.end(event.data.callUUID);
    if (event.name === 'RNCallKeepDidPerformSetMutedCallAction') controller.mute(event.data.callUUID, event.data.muted);
  }
}
/** Native setup without JS's permission-requesting setup() wrapper; safe in headless. */
function initialize(): Promise<boolean> {
  if (!android) return Promise.resolve(false);
  if (!initialized) initialized = (async () => {
    if (!NativeModules.RNCallKeep) return false;
    NativeModules.RNCallKeep.setup(options.android);
    RNCallKeep.canMakeMultipleCalls(false); RNCallKeep.setAvailable(true); RNCallKeep.setReachable();
    enabled = await RNCallKeep.hasPhoneAccount();
    publish(enabled ? 'Системные входящие звонки включены.' : 'Включите LastCall в телефонных аккаунтах Android.');
    return enabled;
  })().catch(() => { publish('Не удалось настроить системные звонки. Повторите настройку на экране приложения.'); return false; });
  return initialized;
}
export async function refreshSystemCallStatus(): Promise<void> {
  await initialize(); if (!android) return;
  enabled = await RNCallKeep.hasPhoneAccount().catch(() => false);
  publish(enabled ? 'Системные входящие звонки включены.' : 'Включите LastCall в телефонных аккаунтах Android.');
}
export async function enableSystemCalls(): Promise<void> {
  if (!android || AppState.currentState !== 'active') return;
  await initialize();
  const granted = await PermissionsAndroid.requestMultiple([PermissionsAndroid.PERMISSIONS.READ_PHONE_NUMBERS, PermissionsAndroid.PERMISSIONS.CALL_PHONE]);
  if (Object.values(granted).some(value => value !== PermissionsAndroid.RESULTS.GRANTED)) { publish('Доступы телефона не предоставлены. Обычный экран звонка в приложении остаётся доступен.'); return; }
  NativeModules.RNCallKeep.openPhoneAccounts();
}
export const answerCurrentSystemCall = () => android ? controller.answer() : Promise.resolve(false);
export function useSystemCallStatus(): string {
  return useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => status);
}
let activeOutgoing: { id: string; release: () => void } | undefined;
function observe(snapshot: MessengerSnapshot, manager: MessengerClient) {
  controller.update(snapshot, manager);
  const call = snapshot.activeCall;
  // An outgoing microphone was explicitly opened by the foreground caller.
  if (!activeOutgoing && call?.session.callId && call.session.callState === 'outgoing' && call.session.localStream && AppState.currentState === 'active') {
    const id = call.session.callId; activeOutgoing = { id, release: retainCall(manager, id) };
    void audio?.start(id, !!call.session.callVideo).catch(() => { if (manager.getSnapshot().activeCall?.session.callId === id) manager.endCall(); });
  }
  if (activeOutgoing && call?.session.callId !== activeOutgoing.id) { audio?.stop(activeOutgoing.id); activeOutgoing.release(); activeOutgoing = undefined; }
}
if (android && NativeModules.RNCallKeep) {
  AppRegistry.registerHeadlessTask('lastcall-wake-runtime', () => async (data: { intentId?: string }) => { if (typeof data.intentId === 'string') await wakeTasks.run(data.intentId); });
  AppRegistry.registerHeadlessTask('lastcall-call-runtime', () => async (data: { callId?: string }) => { if (typeof data.callId === 'string') await callTasks.run(data.callId); });
  RNCallKeep.addEventListener('checkReachability', () => RNCallKeep.setReachable());
  RNCallKeep.addEventListener('answerCall', event => { void controller.answer(event.callUUID); });
  RNCallKeep.addEventListener('endCall', event => controller.end(event.callUUID));
  RNCallKeep.addEventListener('didPerformSetMutedCallAction', event => controller.mute(event.callUUID, event.muted));
  RNCallKeep.addEventListener('createIncomingConnectionFailed', event => controller.failCurrent(event.callUUID));
  RNCallKeep.addEventListener('didLoadWithEvents', initial);
  void RNCallKeep.getInitialEvents().then(events => { initial(events); RNCallKeep.clearInitialEvents(); }).catch(() => {});
  registerMessengerObserver(observe);
  AppState.addEventListener('change', value => { if (value === 'active') void refreshSystemCallStatus(); });
  void initialize();
}
