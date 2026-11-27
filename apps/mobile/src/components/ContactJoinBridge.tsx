import { useEffect } from 'react';
import { AppState } from 'react-native';
import * as Notifications from 'expo-notifications';
import { router, useRootNavigationState } from 'expo-router';
import { directoryUserSchema } from '@messenger/core';
import { CONTACT_JOINED_KIND, checkContactJoins } from '../contact-joins';
import { client, useMessenger } from '../runtime';

/** Checks for contacts who joined (when online and on return to the app) and opens a chat from the notice. */
export function ContactJoinBridge() {
  const { snapshot, phone, profile } = useMessenger();
  const navigation = useRootNavigationState();
  const online = snapshot.status === 'online';
  const phoneLinked = Boolean(phone?.phone);
  useEffect(() => {
    if (!online || !profile) return;
    void checkContactJoins({ phoneLinked });
    const subscription = AppState.addEventListener('change', state => { if (state === 'active') void checkContactJoins({ phoneLinked }); });
    const timer = setInterval(() => void checkContactJoins({ phoneLinked }), 30 * 60_000);
    return () => { subscription.remove(); clearInterval(timer); };
  }, [online, profile, phoneLinked]);
  useEffect(() => {
    if (!navigation?.key || !profile) return;
    const open = (response: Notifications.NotificationResponse | null) => {
      const data = response?.notification.request.content.data as { kind?: string; user?: unknown } | undefined;
      if (data?.kind !== CONTACT_JOINED_KIND) return;
      const parsed = directoryUserSchema.safeParse({ ...(data.user as object), online: false, lastSeen: 0 });
      if (!parsed.success) return;
      void client().addContact(parsed.data).then(id => router.navigate({ pathname: '/chat/[id]', params: { id } })).catch(() => {});
    };
    open(Notifications.getLastNotificationResponse());
    const subscription = Notifications.addNotificationResponseReceivedListener(open);
    return () => subscription.remove();
  }, [navigation?.key, profile]);
  return null;
}
