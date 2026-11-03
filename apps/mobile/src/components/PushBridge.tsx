import { useEffect, useSyncExternalStore } from 'react';
import * as Notifications from 'expo-notifications';
import { client, reconnect, useMessenger } from '../runtime';
import { listenForWake, nativePushToken, onPushRefresh, pushConfigured, pushUnavailable } from '../notifications';
import { prepareMessagePreviews } from '../push-previews';
import { ensureBackgroundNotifications } from '../background-notifications';
import { prepareCallInvitePush } from '../system-calls';
import { callInviteCapability } from '../call-push-model';
import { t } from '../i18n';
let status = pushConfigured ? t('Waiting for the server connection') : pushUnavailable;
const listeners = new Set<() => void>();
const publish = (value: string) => { status = value; listeners.forEach(listener => listener()); };
export const usePushStatus = () => useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => status);
export function PushBridge() {
  const { snapshot, profile, identity } = useMessenger();
  useEffect(() => {
    if (!pushConfigured || !profile || !identity) return;
    let active = true;
    let running = false;
    let rotatedToken: string | undefined;
    async function register() {
      if (running || !active) return;
      if (client().getSnapshot().status !== 'online') { publish(t('Waiting for the server connection')); return; }
      running = true;
      const current = client();
      let success = false;
      try {
        const services = await current.getServices();
        if (!active || current !== client()) return;
        if (!services.push) { publish(t('Notifications are not configured on the server')); return; }
        const token = rotatedToken ?? await nativePushToken();
        if (!active || current !== client()) return;
        if (!token) { publish(t('Could not get the FCM token. Check Firebase and Google Play Services.')); return; }
        const backgroundSync = await ensureBackgroundNotifications();
        if (!active || current !== client()) return;
        const notificationsAllowed = (await Notifications.getPermissionsAsync()).granted;
        const messagePreview = backgroundSync && notificationsAllowed && await prepareMessagePreviews();
        if (!active || current !== client()) return;
        const callInviteV1 = callInviteCapability(backgroundSync, backgroundSync && await prepareCallInvitePush());
        if (!active || current !== client()) return;
        await current.registerPushToken(token, backgroundSync, messagePreview, callInviteV1); success = true;
        if (active) {
          if (rotatedToken === token) rotatedToken = undefined;
          publish(notificationsAllowed
            ? t('FCM registered. Actual delivery depends on the network and Android.')
            : t('Background messages are enabled. Notifications are disabled in app permissions.'));
        }
      } catch { if (active) publish(t('Could not register FCM. Check the network, Firebase and Google Play Services.')); }
      finally { running = false; if (active && success && rotatedToken) { const retryToken = rotatedToken; rotatedToken = undefined; queueMicrotask(() => { rotatedToken = retryToken; void register(); }); } }
    }
    const stopWake = listenForWake(() => { void reconnect().then(register); }, token => { rotatedToken = token; void register(); });
    const stopRefresh = onPushRefresh(() => { void register(); });
    if (snapshot.status === 'online') void register();
    return () => { active = false; stopWake(); stopRefresh(); };
  }, [snapshot.status, profile, identity]);
  return null;
}
