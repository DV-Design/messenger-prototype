import { useEffect, useMemo, useState } from 'react';
import { NativeEventEmitter, NativeModules, Platform } from 'react-native';
import { getLocales } from 'expo-localization';
import * as SecureStore from 'expo-secure-store';
import { client } from './runtime';
import { CallCaptionsController, captionLanguage, type CaptionLanguage, type CaptionNative, type CaptionsView, type SpeechEvent } from './call-captions-model';

const native = NativeModules.LastCallCaptions as CaptionNative | undefined;
/** Android 13 is the first with a recognizer that takes audio from the app instead of opening the microphone. */
export const callCaptionsSupported = Platform.OS === 'android' && Number(Platform.Version) >= 33 && !!native?.speechStatus;
const LANGUAGE_KEY = 'messenger.captions.language.v1';

export const defaultCaptionLanguage = (): CaptionLanguage => captionLanguage(getLocales()[0]?.languageCode);
export async function loadCaptionLanguage(): Promise<CaptionLanguage> {
  try { return captionLanguage(await SecureStore.getItemAsync(LANGUAGE_KEY) ?? defaultCaptionLanguage()); }
  catch { return defaultCaptionLanguage(); }
}
export async function saveCaptionLanguage(language: CaptionLanguage): Promise<void> {
  await SecureStore.setItemAsync(LANGUAGE_KEY, language);
}
export function captionSpeechStatus(language: CaptionLanguage, tag: string) {
  return native ? native.speechStatus(language, tag) : Promise.resolve({ status: 'unavailable' as const });
}

const off: CaptionsView = { enabled: false, peerEnabled: false, asked: false, speech: 'off', translation: 'none', lines: [], own: '' };

export function useCallCaptions(callId: string | undefined, available: boolean, muted: boolean) {
  const [language, setLanguage] = useState<CaptionLanguage>();
  const [view, setView] = useState<CaptionsView>(off);
  useEffect(() => { let live = true; void loadCaptionLanguage().then(value => { if (live) setLanguage(value); }); return () => { live = false; }; }, []);
  const controller = useMemo(() => (callCaptionsSupported && language ? new CallCaptionsController({
    native: native!, language, onChange: setView, send: frame => client().sendCallCaption(frame),
  }) : undefined), [language]);
  useEffect(() => {
    if (!controller) return;
    const unsubscribe = client().onCallCaption(frame => controller.onFrame(frame));
    const events = new NativeEventEmitter(NativeModules.LastCallCaptions).addListener('LastCallCaption', event => controller.onSpeech(event as unknown as SpeechEvent));
    return () => { unsubscribe(); events.remove(); controller.dispose(); };
  }, [controller]);
  useEffect(() => { controller?.setCall(callId, available); }, [controller, callId, available]);
  useEffect(() => { controller?.setMuted(muted); }, [controller, muted]);
  return { view, supported: !!controller && available, toggle: () => controller?.toggle(), decline: () => controller?.decline() };
}
