import { useEffect, useSyncExternalStore } from 'react';
import { CAPTION_LANGUAGES, type CaptionLanguage } from './call-captions-model';
import { defaultCaptionLanguage, loadCaptionLanguage, saveCaptionLanguage } from './call-captions';

/**
 * "My language": the one I speak in calls (captions) and read chats in
 * (translation). Stored under the existing caption-language key.
 */
let current: CaptionLanguage = defaultCaptionLanguage();
let loading: Promise<void> | undefined;
const listeners = new Set<() => void>();
const publish = (value: CaptionLanguage) => { current = value; listeners.forEach(listener => listener()); };

export function loadMyLanguage(): Promise<CaptionLanguage> {
  loading ??= loadCaptionLanguage().then(publish);
  return loading.then(() => current);
}
export async function setMyLanguage(value: CaptionLanguage): Promise<void> {
  publish(value);
  await saveCaptionLanguage(value);
}
export const languageInfo = (code: CaptionLanguage) => CAPTION_LANGUAGES.find(item => item.code === code)!;
export function useMyLanguage() {
  const code = useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => current);
  useEffect(() => { void loadMyLanguage(); }, []);
  return languageInfo(code);
}
