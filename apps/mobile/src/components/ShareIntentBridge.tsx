import { useEffect, useRef, useSyncExternalStore } from 'react';
import { AppState, NativeEventEmitter, NativeModules, Platform } from 'react-native';
import { router, usePathname, useRootNavigationState } from 'expo-router';
import { sharedItem } from '../share-intent-model';
import { onPendingShare, pendingShare, setPendingShare } from '../share-intent';
import { useMessenger } from '../runtime';

type NativeShare = { take(): Promise<{ text: string | null; files: { path: string; fileName: string; mimeType: string; size: number }[]; failed: number } | null> };
const native = Platform.OS === 'android' ? NativeModules.LastCallShare as NativeShare | undefined : undefined;

/**
 * "Share → LastCall" and "LastCall" in the text selection menu both land here, then on the chat picker.
 * Reading the share and opening the picker are separate: on a cold start the share is often read
 * before navigation exists, and a push then would be lost, leaving the person on the chat list.
 */
export function ShareIntentBridge() {
  const { profile } = useMessenger();
  const registered = !!profile;
  const navigationReady = !!useRootNavigationState()?.key;
  const pathname = usePathname();
  const pending = useSyncExternalStore(onPendingShare, pendingShare);
  const shown = useRef<object | null>(null);
  useEffect(() => {
    if (!native || !registered) return;
    let active = true;
    const take = () => {
      void native.take().then(value => {
        if (!active || !value) return;
        const item = sharedItem(value);
        if (item || value.failed) setPendingShare(item ?? { text: null, files: [], failed: value.failed });
      }).catch(() => { /* Nothing readable was shared. */ });
    };
    take();
    // The activity can attach a moment after JavaScript starts; ask again shortly after.
    const retries = [600, 2000].map(delay => setTimeout(take, delay));
    const received = new NativeEventEmitter(NativeModules.LastCallShare).addListener('LastCallShareReceived', take);
    const resumed = AppState.addEventListener('change', state => { if (state === 'active') take(); });
    return () => { active = false; retries.forEach(clearTimeout); received.remove(); resumed.remove(); };
  }, [registered]);
  useEffect(() => {
    if (!pending || pending === shown.current || !navigationReady || !registered || pathname === '/share') return;
    shown.current = pending;
    router.push('/share');
  }, [pending, navigationReady, registered, pathname]);
  return null;
}
