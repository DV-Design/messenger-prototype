import { useSyncExternalStore } from 'react';
import { AppRegistry, AppState, NativeEventEmitter, NativeModules, PermissionsAndroid, Platform } from 'react-native';
import RNCallKeep, { type InitialEvents } from 'react-native-callkeep';
import type { MessengerClient, MessengerSnapshot } from '@messenger/core';
import { registerMessengerObserver, retainMessenger } from './runtime';
import { WakeTaskRegistry, type WakeNotice } from './wake-model';
import { CallTaskRegistry, SystemCallController, callStatusText, nativeCallMode, type CallUiStatus } from './system-call-model';
const android = Platform.OS === 'android';
const apiLevel = Number(Platform.Version);
const nativeCalls = android && nativeCallMode(apiLevel) === 'self-managed';
// Android 7 has no self-managed Telecom account but can show the same private call UI.
const nativeUi = android && apiLevel >= 24;
const options = {
  ios: { appName: 'LastCall', supportsVideo: false },
  android: { alertTitle: 'Системные звонки LastCall', alertDescription: 'Разрешите звонки LastCall.', cancelButton: 'Позже', okButton: 'Настроить', additionalPermissions: [], selfManaged: nativeCalls },
};
let initialized: Promise<boolean> | undefined;
let enabled = false;
let status = android ? 'Системный экран звонков ещё не включён.' : 'Системные звонки iOS требуют отдельной настройки APNs/CallKit.';
const listeners = new Set<() => void>();
function publish(text: string) { status = text; listeners.forEach(listener => listener()); }
interface LastCallAudio {
  start(id: string, video: boolean): Promise<boolean>;
  stop(id: string): void;
  holdHost(id: string): void;
  releaseHost(id: string): void;
  holdWakeHost(id: string, durationMs: number): Promise<boolean>;
  releaseWakeHost(id: string): void;
  showCallUi(uuid: string, name: string, video: boolean, expiresAt: number): Promise<boolean>;
  dismissCallUi(uuid: string): void;
  startCallSetup(id: string, expiresAt: number): void;
  stopCallSetup(id: string): void;
  callUiStatus(): Promise<CallUiStatus>;
  openCallUiSettings(): void;
  prepareCallAccounts(): Promise<boolean>;
}
const audio = NativeModules.LastCallAudio as LastCallAudio | undefined;
const callTasks = new CallTaskRegistry();
const wakeTasks = new WakeTaskRegistry();
let callIntentExpiresAt = 0;
/** Call wake keeps a mic-free setup FGS; data wake keeps the original 12s native deadline. */
export async function retainWakeRuntime(notice: Extract<WakeNotice, { legacy: false }>): Promise<() => void> {
  if (!android || !audio?.holdWakeHost) return () => {};
  const call = notice.kind === 'call';
  if (call) callIntentExpiresAt = notice.expiresAt;
  const release = wakeTasks.acquire(notice.id);
  const budget = Math.min(call ? 28_000 : 12_000, notice.expiresAt - Date.now());
  if (budget <= 0) { release(); return () => {}; }
  try { await audio.holdWakeHost(notice.id, budget); }
  catch { if (release()) audio.releaseWakeHost(notice.id); throw new Error('Background timer ownership unavailable'); }
  if (call) { try { audio.startCallSetup(notice.id, notice.expiresAt); } catch { /* The P2P wake still proceeds. */ } }
  return () => { if (release()) { audio.releaseWakeHost(notice.id); if (call) audio.stopCallSetup(notice.id); } };
}
function retainCall(manager: MessengerClient, id: string): () => void {
  callTasks.claim(id); const release = retainMessenger(manager); audio?.holdHost(id);
  return () => { void release().finally(() => { callTasks.release(id); audio?.releaseHost(id); }).catch(() => {}); };
}
function showNativeCallUi(uuid: string, name: string, video: boolean): boolean {
  // Foreground rings in the existing CallOverlay; the native call activity is for lockscreen/background.
  if (!nativeUi || !audio?.showCallUi || AppState.currentState === 'active') return false;
  const now = Date.now();
  const expiresAt = callIntentExpiresAt > now ? Math.min(callIntentExpiresAt, now + 30_000) : now + 30_000;
  void audio.showCallUi(uuid, name, video, expiresAt).catch(() => {});
  return true;
}
const controller = new SystemCallController({
  present: async (uuid, name, video) => {
    // Android 7 shows the same authenticated call-only surface without Telecom.
    if (!nativeCalls) { showNativeCallUi(uuid, name, video); return true; }
    if (!(await initialize())) return true;
    RNCallKeep.displayIncomingCall(uuid, 'LastCall', name, 'generic', video); return true;
  },
  showUi: showNativeCallUi,
  dismiss: uuid => audio?.dismissCallUi(uuid),
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
    if (event.name === 'RNCallKeepShowIncomingCallUi') controller.showUi(event.data.callUUID);
  }
}
async function queryUiStatus(): Promise<CallUiStatus | undefined> {
  try { return await audio?.callUiStatus?.(); } catch { return undefined; }
}
/** Native setup without JS's permission-requesting setup() wrapper; safe in headless. */
function initialize(): Promise<boolean> {
  if (!android) return Promise.resolve(false);
  if (!nativeCalls) return (async () => {
    const ui = await queryUiStatus();
    enabled = !!ui?.supported;
    publish(callStatusText(enabled, ui));
    return false;
  })();
  if (!initialized) initialized = (async () => {
    if (!NativeModules.RNCallKeep) { publish('Системные звонки недоступны в этой сборке.'); return false; }
    try { await audio?.prepareCallAccounts?.(); } catch { /* Account cleanup is best effort. */ }
    NativeModules.RNCallKeep.setup(options.android);
    RNCallKeep.canMakeMultipleCalls(false); RNCallKeep.setAvailable(true); RNCallKeep.setReachable();
    enabled = await RNCallKeep.hasPhoneAccount().catch(() => false);
    publish(callStatusText(enabled, await queryUiStatus()));
    return enabled;
  })().catch(() => { publish('Не удалось настроить системные звонки. Повторите настройку на экране приложения.'); return false; });
  return initialized;
}
export async function refreshSystemCallStatus(): Promise<void> {
  await initialize(); if (!android) return;
  if (!nativeCalls) { const ui = await queryUiStatus(); enabled = !!ui?.supported; publish(callStatusText(enabled, ui)); return; }
  enabled = await RNCallKeep.hasPhoneAccount().catch(() => false);
  publish(callStatusText(enabled, await queryUiStatus()));
}
/** No phone-account/phone-number permission prompt: CallKeep self-registers its own account. */
export async function enableSystemCalls(): Promise<void> {
  if (!android || AppState.currentState !== 'active') return;
  await initialize();
  if (!nativeCalls) { const ui = await queryUiStatus(); enabled = !!ui?.supported; publish(callStatusText(enabled, ui)); try { audio?.openCallUiSettings?.(); } catch {} return; }
  const before = await queryUiStatus();
  try { audio?.openCallUiSettings?.(); } catch { /* Settings may be unavailable on some OEMs. */ }
  publish(callStatusText(enabled, before));
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
  RNCallKeep.addEventListener('showIncomingCallUi', event => { controller.showUi(event.callUUID); });
  RNCallKeep.addEventListener('createIncomingConnectionFailed', event => controller.failCurrent(event.callUUID));
  RNCallKeep.addEventListener('didLoadWithEvents', initial);
  void RNCallKeep.getInitialEvents().then(events => { initial(events); RNCallKeep.clearInitialEvents(); }).catch(() => {});
  if (NativeModules.LastCallAudio) {
    const events = new NativeEventEmitter(NativeModules.LastCallAudio);
    events.addListener('LastCallCallAction', (event: { callUUID?: string; action?: string }) => {
      if (typeof event?.callUUID !== 'string') return;
      if (event.action === 'answer') void controller.answer(event.callUUID); else controller.end(event.callUUID);
    });
  }
  registerMessengerObserver(observe);
  AppState.addEventListener('change', value => { if (value === 'active') void refreshSystemCallStatus(); else controller.remindUi(); });
  void initialize();
}
