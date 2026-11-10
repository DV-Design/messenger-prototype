import { AppState, NativeModules, Platform } from 'react-native';
import * as Haptics from 'expo-haptics';
import * as SecureStore from 'expo-secure-store';
import { messagePreviewScope, registerMessengerObserver } from './runtime';
import { CueThrottle, incomingCue, observeFeedback, type FeedbackState } from './feedback-model';

/** Telegram-like touch feedback and in-chat sounds. Both can be turned off in Settings. */
export interface FeedbackPreferences { sounds: boolean; haptics: boolean }
const KEY = 'lastcall-feedback-v1';
let preferences: FeedbackPreferences = { sounds: true, haptics: true };
const listeners = new Set<(value: FeedbackPreferences) => void>();
let loaded: Promise<void> | undefined;

export function loadFeedbackPreferences(): Promise<FeedbackPreferences> {
  loaded ??= SecureStore.getItemAsync(KEY).then(raw => {
    if (!raw) return;
    const value = JSON.parse(raw) as Partial<FeedbackPreferences>;
    preferences = { sounds: value.sounds !== false, haptics: value.haptics !== false };
  }).catch(() => {});
  return loaded.then(() => preferences);
}
export async function saveFeedbackPreferences(next: FeedbackPreferences): Promise<void> {
  preferences = next;
  listeners.forEach(listener => listener(next));
  await SecureStore.setItemAsync(KEY, JSON.stringify(next));
}
export function onFeedbackPreferences(listener: (value: FeedbackPreferences) => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }

export type HapticKind = 'longPress' | 'tick' | 'confirm' | 'reject' | 'press';
const ANDROID: Record<HapticKind, Haptics.AndroidHaptics> = {
  longPress: Haptics.AndroidHaptics.Long_Press,
  tick: Haptics.AndroidHaptics.Clock_Tick,
  confirm: Haptics.AndroidHaptics.Confirm,
  reject: Haptics.AndroidHaptics.Reject,
  press: Haptics.AndroidHaptics.Context_Click,
};
/** On Android this is the system haptic (View.performHapticFeedback), so the phone's "Touch feedback" setting still applies. */
export function haptic(kind: HapticKind): void {
  if (!preferences.haptics) return;
  const done = Platform.OS === 'android' ? Haptics.performAndroidHapticsAsync(ANDROID[kind])
    : kind === 'tick' ? Haptics.selectionAsync()
      : kind === 'confirm' ? Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
        : kind === 'reject' ? Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
          : Haptics.impactAsync(kind === 'longPress' ? Haptics.ImpactFeedbackStyle.Medium : Haptics.ImpactFeedbackStyle.Light);
  void done.catch(() => {});
}

interface NativeSounds { prepareUiSounds?: () => void; playUiSound?: (name: 'sent' | 'incoming') => void }
const native = (Platform.OS === 'android' ? NativeModules.LastCallNotifications : undefined) as NativeSounds | undefined;
/** Native SoundPool: no audio focus, silent when the phone is on silent/vibrate or in a call. */
export function playSound(name: 'sent' | 'incoming'): void {
  if (preferences.sounds) native?.playUiSound?.(name);
}
const sentThrottle = new CueThrottle(400);
/** The "sent" sound after the message is accepted for delivery. */
export function messageSent(): void { if (sentThrottle.allow(Date.now())) playSound('sent'); }

let openChat: string | undefined;
/** The chat screen in front, so its incoming messages get the quieter in-chat cue. */
export function setOpenChat(id: string | undefined): () => void {
  openChat = id;
  return () => { if (openChat === id) openChat = undefined; };
}

let stop: (() => void) | undefined;
export function startFeedback(): () => void {
  if (stop) return stop;
  void loadFeedbackPreferences();
  native?.prepareUiSounds?.();
  let state: FeedbackState | undefined;
  const incoming = new CueThrottle(1500);
  const unsubscribe = registerMessengerObserver((snapshot, manager) => {
    const scope = messagePreviewScope(manager);
    if (!scope) return;
    const selfId = scope.slice(scope.lastIndexOf(':') + 1);
    const result = observeFeedback(state, scope, snapshot, selfId);
    state = result.state;
    for (const event of result.events) {
      if (event.kind === 'callConnected') haptic('confirm');
      else if (event.kind === 'callEnded') haptic('press');
      else {
        const cue = incomingCue(event.conversationIds, openChat, AppState.currentState === 'active', !!snapshot.activeCall);
        if (cue === 'none' || !incoming.allow(Date.now())) continue;
        playSound('incoming');
        if (cue === 'app') haptic('tick');
      }
    }
  });
  stop = () => { unsubscribe(); stop = undefined; };
  return stop;
}
