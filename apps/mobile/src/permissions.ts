import { Alert, AppState, NativeModules, PermissionsAndroid, Platform } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as SecureStore from 'expo-secure-store';
import { permissions as rtcPermissions } from 'react-native-webrtc';
import { notificationPermission, refreshPushRegistration } from './notifications';
import { hasAccess, inSequence, normalizeAccess, permissionSetupPlan, fullScreenCallAccess, requestSpecialAccess, type Access, type PermissionKind } from './permission-model';
const SETUP_KEY = 'messenger.permissions.0.3.0';
const CALL_SETUP_KEY = 'messenger.permissions.call-screen.1';
const callPermissions = NativeModules.LastCallAudio as { callUiStatus?(): Promise<{ supported: boolean; fullScreen: boolean }>; openFullScreenCallSettings?(): Promise<boolean> } | undefined;
let microphoneBlocked = false;
async function initialPlan() {
  const [runtimeMarker, callMarker, access] = await Promise.all([SecureStore.getItemAsync(SETUP_KEY), SecureStore.getItemAsync(CALL_SETUP_KEY), readPermission('fullScreenCalls')]);
  return permissionSetupPlan(runtimeMarker, callMarker, access);
}
export const setupComplete = async () => (await initialPlan()).length === 0;
export const completeSetup = async () => { await SecureStore.setItemAsync(SETUP_KEY, 'done'); await SecureStore.setItemAsync(CALL_SETUP_KEY, 'done'); };

export async function readPermission(kind: PermissionKind): Promise<Access> {
  if (kind === 'fullScreenCalls') {
    const api = Number(Platform.Version);
    return fullScreenCallAccess(Platform.OS, api, Platform.OS === 'android' && api >= 34 ? await callPermissions?.callUiStatus?.() : undefined);
  }
  if (kind === 'notifications') return notificationPermission();
  if (kind === 'camera') return normalizeAccess(await ImagePicker.getCameraPermissionsAsync());
  if (kind === 'photos') return normalizeAccess(await ImagePicker.getMediaLibraryPermissionsAsync());
  const status = await rtcPermissions.query({ name: 'microphone' });
  if (status === 'granted') { microphoneBlocked = false; return { status: 'granted', canAskAgain: true }; }
  return { status: status === 'denied' || microphoneBlocked ? 'denied' : 'undetermined', canAskAgain: Platform.OS === 'android' ? !microphoneBlocked : status !== 'denied' };
}
export async function requestPermission(kind: PermissionKind): Promise<Access> {
  if (kind === 'fullScreenCalls') {
    return requestSpecialAccess({
      read: () => readPermission(kind),
      explain: async () => {
        await SecureStore.setItemAsync(CALL_SETUP_KEY, 'attempted');
        return new Promise<boolean>(resolve => Alert.alert('Полноэкранные звонки',
          'Чтобы входящий звонок LastCall мог открываться поверх экрана блокировки, разрешите полноэкранные уведомления в настройках Android. Это отдельный доступ. Без него останется уведомление со звонком. Микрофон включается только после ответа.',
          [{ text: 'Позже', style: 'cancel', onPress: () => resolve(false) }, { text: 'Открыть настройки', onPress: () => resolve(true) }],
          { cancelable: true, onDismiss: () => resolve(false) }));
      },
      open: async () => !!(await callPermissions?.openFullScreenCallSettings?.()),
      subscribe: listener => { const subscription = AppState.addEventListener('change', listener); return () => subscription.remove(); },
    });
  }
  const before = await readPermission(kind);
  if (hasAccess(before) || !before.canAskAgain) return before;
  if (kind === 'notifications') { const access = await notificationPermission(true); refreshPushRegistration(); return access; }
  if (kind === 'camera') return normalizeAccess(await ImagePicker.requestCameraPermissionsAsync());
  if (kind === 'photos') return normalizeAccess(await ImagePicker.requestMediaLibraryPermissionsAsync());
  if (Platform.OS === 'android') {
    const result = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO);
    microphoneBlocked = result === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN;
    return { status: result === PermissionsAndroid.RESULTS.GRANTED ? 'granted' : 'denied', canAskAgain: !microphoneBlocked };
  }
  await rtcPermissions.request({ name: 'microphone' });
  return readPermission(kind);
}

let initialSequence: Promise<Awaited<ReturnType<typeof inSequence<Access>>>> | undefined;
async function foreground() {
  if (AppState.currentState === 'active') return;
  await new Promise<void>(resolve => {
    const listener = AppState.addEventListener('change', value => { if (value === 'active') { listener.remove(); resolve(); } });
  });
}
/** One process-wide sequence; OS focus changes never launch a second request. */
export function requestInitialPermissions(onResult: (kind: PermissionKind, access: Access) => void) {
  if (initialSequence) return initialSequence;
  initialSequence = (async () => {
    const plan = await initialPlan();
    // Save before the first prompt, so killing the process cannot repeat denied prompts.
    if (plan.some(kind => kind !== 'fullScreenCalls')) await SecureStore.setItemAsync(SETUP_KEY, 'attempted');
    const results = await inSequence(plan, async kind => {
      await foreground();
      const access = await requestPermission(kind); onResult(kind, access); return access;
    });
    await completeSetup();
    return results;
  })();
  return initialSequence;
}
