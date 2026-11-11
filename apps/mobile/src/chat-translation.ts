import { useEffect, useState } from 'react';
import { NativeModules, Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { TranslationCache, baseLanguage, needsTranslation, translatable, translationKey } from './chat-translation-model';
import { t } from './i18n';

interface TranslationNative {
  identifyLanguage(text: string): Promise<string>;
  prepareTranslation(source: string, target: string): Promise<void>;
  translate(source: string, target: string, text: string): Promise<string>;
}
const native = NativeModules.LastCallCaptions as Partial<TranslationNative> | undefined;
/** On-device ML Kit: the language packs come from Google once; messages never leave the phone. */
export const chatTranslationSupported = Platform.OS === 'android' && !!native?.identifyLanguage && !!native?.translate;

/** null: shown as written (already my language, not recognized, or not translatable). */
const cache = new TranslationCache<string | null>();
const prepared = new Map<string, Promise<void>>();
let queue: Promise<unknown> = Promise.resolve();

function prepare(source: string, target: string) {
  const key = `${source}:${target}`;
  let ready = prepared.get(key);
  if (!ready) { ready = native!.prepareTranslation!(source, target); prepared.set(key, ready); ready.catch(() => prepared.delete(key)); }
  return ready;
}
async function translateNow(text: string, target: string): Promise<string | null> {
  if (!translatable(text)) return null;
  const detected = await native!.identifyLanguage!(text);
  if (!needsTranslation(detected, target)) return null;
  const source = baseLanguage(detected);
  try { await prepare(source, baseLanguage(target)); }
  catch { throw new Error(t('Could not download the translation pack. Check the connection and try again.')); }
  const translated = await native!.translate!(source, baseLanguage(target), text);
  // Codes, names and test strings come back unchanged: show them as written, not as "translated".
  return translated.trim().toLocaleLowerCase() === text.trim().toLocaleLowerCase() ? null : translated;
}
/** One at a time, so a long history does not flood the translator. Results are cached. */
export function translateMessage(text: string, target: string): Promise<string | null> {
  const key = translationKey(target, text);
  if (cache.has(key)) return Promise.resolve(cache.get(key)!);
  const job = queue.then(() => cache.has(key) ? cache.get(key)! : translateNow(text, target)).then(result => { cache.set(key, result); return result; });
  queue = job.catch(() => undefined);
  return job;
}
export const cachedTranslation = (text: string, target: string) => cache.get(translationKey(target, text));

// Chats where "Translate" is on, kept across restarts.
const KEY = 'lastcall-translated-chats-v1';
let chats: Set<string> | undefined;
const listeners = new Set<() => void>();
async function loadChats() {
  if (chats) return chats;
  try { chats = new Set((JSON.parse(await SecureStore.getItemAsync(KEY) ?? '[]') as string[]).filter(item => typeof item === 'string').slice(0, 200)); }
  catch { chats = new Set(); }
  return chats;
}
export async function setChatTranslated(id: string, on: boolean) {
  const set = await loadChats();
  if (on) set.add(id); else set.delete(id);
  listeners.forEach(listener => listener());
  await SecureStore.setItemAsync(KEY, JSON.stringify([...set])).catch(() => {});
}
export function useChatTranslated(id: string | undefined): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    let live = true;
    const read = () => { void loadChats().then(set => { if (live) setOn(!!id && set.has(id)); }); };
    read(); listeners.add(read);
    return () => { live = false; listeners.delete(read); };
  }, [id]);
  return on;
}

/** Translations of the given messages, newest first, filled in as they arrive. */
export function useTranslations(enabled: boolean, messages: readonly { id: string; text: string }[], target: string) {
  const active = enabled && chatTranslationSupported;
  const signature = active ? `${target}|${messages.map(item => `${item.id}:${item.text}`).join(',')}` : '';
  const [state, setState] = useState<{ signature: string; texts: Record<string, string>; busy: boolean; error: string }>();
  useEffect(() => {
    if (!active) return;
    let live = true;
    const texts: Record<string, string> = {};
    const publish = (busy: boolean, error = '') => { if (live) setState({ signature, texts: { ...texts }, busy, error }); };
    void (async () => {
      for (const item of [...messages].reverse()) {
        if (!live) return;
        try {
          const translated = await translateMessage(item.text, target);
          if (translated) { texts[item.id] = translated; publish(true); }
        } catch (cause) { publish(false, cause instanceof Error ? cause.message : String(cause)); return; }
      }
      publish(false);
    })();
    return () => { live = false; };
    // The signature covers the messages and the target language.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);
  if (!active) return { texts: {} as Record<string, string>, busy: false, error: '' };
  if (state?.signature === signature) return state;
  // Until the first result: whatever is already cached, so a reopened chat shows translations at once.
  const texts: Record<string, string> = {};
  for (const item of messages) { const done = cachedTranslation(item.text, target); if (done) texts[item.id] = done; }
  return { texts, busy: true, error: '' };
}
