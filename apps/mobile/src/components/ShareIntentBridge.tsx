import { useEffect } from 'react';
import { AppState, NativeEventEmitter, NativeModules, Platform } from 'react-native';
import { router } from 'expo-router';
import { sharedItem } from '../share-intent-model';
import { setPendingShare } from '../share-intent';
import { useMessenger } from '../runtime';

type NativeShare = { take(): Promise<{ text: string | null; files: { path: string; fileName: string; mimeType: string; size: number }[]; failed: number } | null> };
const native = Platform.OS === 'android' ? NativeModules.LastCallShare as NativeShare | undefined : undefined;

/** "Share → LastCall" and "LastCall" in the text selection menu both land here, then on the chat picker. */
export function ShareIntentBridge() {
  const { profile } = useMessenger();
  const registered = !!profile;
  useEffect(() => {
    if (!native || !registered) return;
    let active = true;
    const take = () => {
      void native.take().then(value => {
        if (!active || !value) return;
        const item = sharedItem(value);
        if (!item && !value.failed) return;
        setPendingShare(item ?? { text: null, files: [], failed: value.failed });
        router.push('/share');
      }).catch(() => { /* Nothing readable was shared. */ });
    };
    take();
    const received = new NativeEventEmitter(NativeModules.LastCallShare).addListener('LastCallShareReceived', take);
    const resumed = AppState.addEventListener('change', state => { if (state === 'active') take(); });
    return () => { active = false; received.remove(); resumed.remove(); };
  }, [registered]);
  return null;
}
