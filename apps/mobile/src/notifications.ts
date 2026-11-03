import { t } from './i18n';
import { AppState, Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { AndroidImportance } from 'expo-notifications';
import { normalizeAccess, type Access } from './permission-model';
import { processMessagePreview } from './push-previews';
import { isEncryptedMessagePreview, isLocalMessagePreview } from './push-preview-model';
import { parseWakeNotice } from './wake-model';
import { isCallPushPayload } from './call-push-model';
import { processCallPush } from './call-pushes';
export { processMessagePreview };
export const pushConfigured = Platform.OS === 'android' && Constants.expoConfig?.extra?.nativeFcmConfigured === true;
export const pushUnavailable = Platform.OS === 'ios'
  ? t('Push on iOS is not configured yet: app signing and APNs are required.')
  : t('Push is not configured in this build: Firebase client configuration is missing.');
export async function prepareNotificationChannel() {
  if (Platform.OS === 'android') await Notifications.setNotificationChannelAsync('lastcall-messages', { name: t('LastCall messages'), importance: AndroidImportance.HIGH });
}
export async function notificationPermission(request = false): Promise<Access> {
  if (Platform.OS !== 'android' && Platform.OS !== 'ios') return { status: 'unavailable', canAskAgain: false };
  await prepareNotificationChannel();
  return normalizeAccess(await (request ? Notifications.requestPermissionsAsync() : Notifications.getPermissionsAsync()));
}
// Also applies to P2P-only local previews, before Router or a foreground bridge exists.
Notifications.setNotificationHandler({ handleNotification: async notification => {
  const hidden = isCallPushPayload(notification) || isEncryptedMessagePreview(notification) || (isLocalMessagePreview(notification) && AppState.currentState === 'active');
  return { shouldShowBanner: !hidden, shouldShowList: !hidden, shouldPlaySound: !hidden, shouldSetBadge: false };
} });
/** No token API is called without a native Firebase client configuration. */
export function listenForWake(onOpen: () => void, onToken: (token: string) => void) {
  if (!pushConfigured) return () => {};
  const received = Notifications.addNotificationReceivedListener(notification => {
    if (isCallPushPayload(notification)) { void processCallPush(notification); return; }
    if (!isLocalMessagePreview(notification)) void processMessagePreview(notification).finally(() => { if (parseWakeNotice(notification) || isLocalMessagePreview(notification)) onOpen(); });
  });
  const response = Notifications.addNotificationResponseReceivedListener(notification => { if (isCallPushPayload(notification)) { void processCallPush(notification); return; } if (parseWakeNotice(notification) || isLocalMessagePreview(notification)) onOpen(); });
  const rotation = Notifications.addPushTokenListener(token => { if (token.type === 'android' && typeof token.data === 'string') onToken(token.data); });
  const last = Notifications.getLastNotificationResponse();
  if (last) { Notifications.clearLastNotificationResponse(); if (isCallPushPayload(last)) void processCallPush(last); else if (parseWakeNotice(last) || isLocalMessagePreview(last)) onOpen(); }
  const resume = AppState.addEventListener('change', value => { if (value === 'active') onOpen(); });
  return () => { received.remove(); response.remove(); rotation.remove(); resume.remove(); };
}
export async function nativePushToken(): Promise<string | null> {
  // Data-only FCM wake does not require POST_NOTIFICATIONS. Requiring the
  // notification permission here prevented background message sync entirely
  // when the user denied it; previews are gated separately.
  if (!pushConfigured) return null;
  await prepareNotificationChannel();
  const token = await Notifications.getDevicePushTokenAsync();
  if (token.type !== 'android' || typeof token.data !== 'string') throw new Error(t('This build supports Android FCM only.'));
  return token.data;
}
const refreshListeners = new Set<() => void>();
export const refreshPushRegistration = () => refreshListeners.forEach(listener => listener());
export const onPushRefresh = (listener: () => void) => { refreshListeners.add(listener); return () => { refreshListeners.delete(listener); }; };
