import { useEffect, useMemo, useState } from 'react';
import { NativeEventEmitter, NativeModules, Platform } from 'react-native';
import { getLocales } from 'expo-localization';
import * as SecureStore from 'expo-secure-store';
import { client } from './runtime';
import { CallCaptionsController, captionLanguage, emptyCaptionsView, type CaptionLanguage, type CaptionNative, type CaptionsView, type SpeechEvent, type VoiceEvent, type VoiceNative } from './call-captions-model';

const native = NativeModules.LastCallCaptions as (CaptionNative & Partial<VoiceNative>) | undefined;
const voiceNative = native?.voiceStatus ? native as VoiceNative : undefined;
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

const off: CaptionsView = emptyCaptionsView();

/** The audio tracks this hook may silence. Only `enabled` is changed, and it is restored afterwards. */
type Tracks = { getAudioTracks(): { id: string; enabled: boolean }[] } | null | undefined;

export function useCallCaptions(callId: string | undefined, available: boolean, muted: boolean, local?: Tracks, remote?: Tracks) {
  const [language, setLanguage] = useState<CaptionLanguage>();
  const [view, setView] = useState<CaptionsView>(off);
  useEffect(() => { let live = true; void loadCaptionLanguage().then(value => { if (live) setLanguage(value); }); return () => { live = false; }; }, []);
  const controller = useMemo(() => (callCaptionsSupported && language ? new CallCaptionsController({
    native: native!, voice: voiceNative, language, onChange: setView, send: frame => client().sendCallCaption(frame),
  }) : undefined), [language]);
  useEffect(() => {
    if (!controller) return;
    const unsubscribe = client().onCallCaption(frame => controller.onFrame(frame));
    const events = new NativeEventEmitter(NativeModules.LastCallCaptions).addListener('LastCallCaption', (raw: object) => {
      const event = raw as { type: string };
      if (event.type === 'voice-start' || event.type === 'voice-done') controller.onVoice(event as unknown as VoiceEvent);
      else controller.onSpeech(event as unknown as SpeechEvent);
    });
    return () => { unsubscribe(); events.remove(); controller.dispose(); };
  }, [controller]);
  useEffect(() => { controller?.setCall(callId, available); }, [controller, callId, available]);
  useEffect(() => { controller?.setMuted(muted); }, [controller, muted]);
  // With spoken translation the peer's own voice is not played here; captions and the voice replace it.
  const remoteIds = remote?.getAudioTracks().map(track => track.id).join() ?? '';
  useEffect(() => {
    if (!remote || !view.voiceActive) return;
    const tracks = remote.getAudioTracks();
    tracks.forEach(track => { track.enabled = false; });
    return () => tracks.forEach(track => { track.enabled = true; });
  }, [remote, remoteIds, view.voiceActive]);
  // While the translation plays, the other side must not hear it through this microphone.
  const localIds = local?.getAudioTracks().map(track => track.id).join() ?? '';
  useEffect(() => {
    if (!local || !view.speaking) return;
    const tracks = local.getAudioTracks();
    tracks.forEach(track => { track.enabled = false; });
    return () => tracks.forEach(track => { track.enabled = !muted; });
  }, [local, localIds, view.speaking, muted]);
  return { view, supported: !!controller && available, voiceSupported: !!controller?.voiceSupported && available,
    toggle: () => controller?.toggle(), decline: () => controller?.decline(), toggleVoice: () => controller?.toggleVoice() };
}
