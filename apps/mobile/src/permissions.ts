import { AppState, PermissionsAndroid, Platform } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as SecureStore from 'expo-secure-store';
import { permissions as rtcPermissions } from 'react-native-webrtc';
import { notificationPermission, refreshPushRegistration } from './notifications';
import { PERMISSION_ORDER, hasAccess, inSequence, normalizeAccess, type Access, type PermissionKind } from './permission-model';
const SETUP_KEY = 'messenger.permissions.0.3.0';
let microphoneBlocked = false;
export const setupComplete = async () => ['done', 'attempted'].includes((await SecureStore.getItemAsync(SETUP_KEY)) ?? '');
export const completeSetup = async () => SecureStore.setItemAsync(SETUP_KEY, 'done');

export async function readPermission(kind: PermissionKind): Promise<Access> {
  if (kind === 'notifications') return notificationPermission();
  if (kind === 'camera') return normalizeAccess(await ImagePicker.getCameraPermissionsAsync());
  if (kind === 'photos') return normalizeAccess(await ImagePicker.getMediaLibraryPermissionsAsync());
  const status = await rtcPermissions.query({ name: 'microphone' });
  if (status === 'granted') { microphoneBlocked = false; return { status: 'granted', canAskAgain: true }; }
  return { status: status === 'denied' || microphoneBlocked ? 'denied' : 'undetermined', canAskAgain: Platform.OS === 'android' ? !microphoneBlocked : status !== 'denied' };
}
export async function requestPermission(kind: PermissionKind): Promise<Access> {
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
    // Save before the first prompt, so killing the process cannot repeat denied prompts.
    await SecureStore.setItemAsync(SETUP_KEY, 'attempted');
    const results = await inSequence(PERMISSION_ORDER, async kind => {
      await foreground();
      const access = await requestPermission(kind); onResult(kind, access); return access;
    });
    await completeSetup();
    return results;
  })();
  return initialSequence;
}
