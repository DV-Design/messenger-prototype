import { AppState, Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { AndroidImportance } from 'expo-notifications';
import { normalizeAccess, type Access } from './permission-model';
export const pushConfigured = Platform.OS === 'android' && Constants.expoConfig?.extra?.nativeFcmConfigured === true;
export const pushUnavailable = Platform.OS === 'ios'
  ? 'Push на iOS пока не настроен: нужны подпись приложения и APNs.'
  : 'Push не настроен в этой сборке: отсутствует клиентская конфигурация Firebase.';
export async function prepareNotificationChannel() {
  if (pushConfigured) await Notifications.setNotificationChannelAsync('lastcall-messages', { name: 'Сообщения LastCall', importance: AndroidImportance.HIGH });
}
export async function notificationPermission(request = false): Promise<Access> {
  if (!pushConfigured) return { status: 'unavailable', canAskAgain: false };
  await prepareNotificationChannel();
  return normalizeAccess(await (request ? Notifications.requestPermissionsAsync() : Notifications.getPermissionsAsync()));
}
/** No token API is called without a native Firebase client configuration. */
export function listenForWake(onOpen: () => void, onToken: (token: string) => void) {
  if (!pushConfigured) return () => {};
  Notifications.setNotificationHandler({ handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }) });
  const response = Notifications.addNotificationResponseReceivedListener(() => onOpen());
  const rotation = Notifications.addPushTokenListener(token => { if (token.type === 'android' && typeof token.data === 'string') onToken(token.data); });
  const last = Notifications.getLastNotificationResponse();
  if (last) { Notifications.clearLastNotificationResponse(); onOpen(); }
  const resume = AppState.addEventListener('change', value => { if (value === 'active') onOpen(); });
  return () => { response.remove(); rotation.remove(); resume.remove(); };
}
export async function nativePushToken(): Promise<string | null> {
  if (!pushConfigured || !(await Notifications.getPermissionsAsync()).granted) return null;
  await prepareNotificationChannel();
  const token = await Notifications.getDevicePushTokenAsync();
  if (token.type !== 'android' || typeof token.data !== 'string') throw new Error('Эта сборка поддерживает только Android FCM.');
  return token.data;
}
const refreshListeners = new Set<() => void>();
export const refreshPushRegistration = () => refreshListeners.forEach(listener => listener());
export const onPushRefresh = (listener: () => void) => { refreshListeners.add(listener); return () => { refreshListeners.delete(listener); }; };
