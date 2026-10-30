import { useEffect, useRef, useState } from 'react';
import { AppState, NativeEventEmitter, NativeModules, Platform } from 'react-native';
import { router, useRootNavigationState } from 'expo-router';
import * as Crypto from 'expo-crypto';
import { client, messagePreviewScope, useMessenger } from '../runtime';
import { NotificationNavigationQueue } from '../notification-navigation-model';

const native = NativeModules.LastCallNotifications;
export function NotificationNavigationBridge() {
  const { ready, profile, identity, snapshot } = useMessenger();
  const navigation = useRootNavigationState();
  const queue = useRef(new NotificationNavigationQueue());
  const [revision, changed] = useState(0);
  useEffect(() => {
    if (Platform.OS !== 'android' || !native?.getInitialNotification) return;
    let active = true;
    const read = () => { void native.getInitialNotification().then((value: unknown) => {
      if (active && queue.current.offer(value)) changed(value => value + 1);
    }).catch(() => {}); };
    const opened = new NativeEventEmitter(native).addListener('LastCallNotificationOpened', read);
    const resumed = AppState.addEventListener('change', state => { if (state === 'active') { read(); changed(value => value + 1); } });
    read();
    return () => { active = false; opened.remove(); resumed.remove(); };
  }, []);
  useEffect(() => {
    if (!ready || !navigation?.key || !profile || !identity || AppState.currentState !== 'active') return;
    let active = true;
    const current = client(); const scope = messagePreviewScope(current);
    if (!scope) return;
    void Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, scope).then(hash => {
      if (!active || client() !== current) return;
      const id = queue.current.take({ ready: true, scope: hash, userId: identity.userId, conversations: current.getSnapshot().conversations });
      if (id) router.navigate({ pathname: '/chat/[id]', params: { id } });
    }).catch(() => {});
    return () => { active = false; };
  }, [ready, profile, identity, snapshot, navigation?.key, revision]);
  return null;
}
