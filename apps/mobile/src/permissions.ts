import { PermissionsAndroid, Platform } from 'react-native';
import * as Contacts from 'expo-contacts';
import * as ImagePicker from 'expo-image-picker';
import * as SecureStore from 'expo-secure-store';
import { permissions as rtcPermissions } from 'react-native-webrtc';
import { notificationPermission, refreshPushRegistration } from './notifications';
import { hasAccess, normalizeAccess, type Access, type PermissionKind } from './permission-model';
const SETUP_KEY = 'messenger.permissions.0.3.0';
let microphoneBlocked = false;
export const setupComplete = async () => (await SecureStore.getItemAsync(SETUP_KEY)) === 'done';
export const completeSetup = async () => SecureStore.setItemAsync(SETUP_KEY, 'done');

export async function readPermission(kind: PermissionKind): Promise<Access> {
  if (kind === 'notifications') return notificationPermission();
  if (kind === 'contacts') return normalizeAccess(await Contacts.getPermissionsAsync());
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
  if (kind === 'contacts') return normalizeAccess(await Contacts.requestPermissionsAsync());
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
export async function expandContactAccess(): Promise<void> {
  if (Platform.OS === 'ios') await Contacts.Contact.presentAccessPicker();
}
