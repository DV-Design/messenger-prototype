import { AppState, Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { AndroidImportance } from 'expo-notifications';
import { t } from './i18n';

const CHANNEL = 'lastcall-delivery';

/** Quiet and short-lived. Returns how to remove it, or undefined when nothing was shown. */
export async function showDeliveryProgress(): Promise<(() => Promise<void>) | undefined> {
  if (Platform.OS !== 'android' || AppState.currentState === 'active') return undefined;
  try {
    if (!(await Notifications.getPermissionsAsync()).granted) return undefined;
    await Notifications.setNotificationChannelAsync(CHANNEL, { name: t('LastCall message delivery'), importance: AndroidImportance.LOW, showBadge: false });
    const id = await Notifications.scheduleNotificationAsync({ content: { title: 'LastCall', body: t('Delivering your messages…') }, trigger: { channelId: CHANNEL } });
    return () => Notifications.dismissNotificationAsync(id).catch(() => {});
  } catch { return undefined; }
}
