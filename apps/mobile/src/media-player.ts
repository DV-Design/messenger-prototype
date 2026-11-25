import { useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer, type AudioStatus } from 'expo-audio';
import { createVideoPlayer, type VideoPlayer } from 'expo-video';
import * as Crypto from 'expo-crypto';
import { File, Paths } from 'expo-file-system';
import type { MessengerFile } from '@messenger/core';
import { deleteMediaCache, loadFileData } from './attachments';
import { claimMediaPlayback } from './media-playback';
import { MAX_MEDIA_BYTES, type MediaKind } from './media-model';
import { t } from './i18n';

/**
 * The voice message or video circle being played, as Telegram does it: one player for the whole
 * app, so it keeps playing while a photo is opened or the chat list is browsed. A call, a recording,
 * a video in the viewer or leaving the app stops or pauses it.
 */
export type NowPlaying = {
  key: string; kind: MediaKind; conversationId: string;
  playing: boolean; loading: boolean; position: number; duration: number;
  /** Chat rows showing this circle right now; when none does, a small floating circle shows it. */
  inlineViews: number;
  /**
   * The floating circle holds the video surface. A player shows in one view at a time: a view that
   * goes away takes the surface with it, so a new view attaches only after the old one let go
   * (otherwise the circle stays black while it plays).
   */
  floating: boolean;
  error?: string;
};

let state: NowPlaying | undefined;
const listeners = new Set<() => void>();
let audio: AudioPlayer | undefined;
let video: VideoPlayer | undefined;
let copy: string | undefined;
let release: (() => void) | undefined;
let detach: (() => void)[] = [];
let generation = 0;

function publish(next: NowPlaying | undefined) { state = next; for (const listener of listeners) listener(); }
function patch(update: Partial<NowPlaying>) { if (state) publish({ ...state, ...update }); }
export function subscribeNowPlaying(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
export function nowPlayingSnapshot() { return state; }
export function useNowPlaying() { return useSyncExternalStore(subscribeNowPlaying, nowPlayingSnapshot); }
export const mediaFileKey = (file: Pick<MessengerFile, 'conversationId' | 'senderId' | 'id'>) => `${file.conversationId}:${file.senderId}:${file.id}`;
/** The circle's player, for the one view that shows it. */
export function nowPlayingVideo() { return video; }

export function stopNowPlaying() {
  generation++;
  for (const remove of detach) remove();
  detach = [];
  try { audio?.remove(); } catch { /* already released */ }
  try { video?.release(); } catch { /* already released */ }
  audio = undefined; video = undefined;
  deleteMediaCache(copy); copy = undefined;
  const done = release; release = undefined; done?.();
  if (state) publish(undefined);
}

export function togglePlayback() {
  const player = audio ?? video;
  if (!state || !player) return;
  if (state.playing) { player.pause(); return; }
  const ended = state.duration > 0 && state.position >= state.duration - 0.15;
  if (ended && video) video.replay();
  else if (ended && audio) { const current = audio; void current.seekTo(0).catch(() => {}).then(() => current.play()); }
  else player.play();
}

/** Plays a voice message or circle from the chat; the same one again toggles pause. */
export async function playMediaFile(file: MessengerFile, kind: MediaKind) {
  const key = mediaFileKey(file);
  if (state?.key === key) { togglePlayback(); return; }
  stopNowPlaying();
  const mine = ++generation;
  publish({ key, kind, conversationId: file.conversationId, playing: false, loading: true, position: 0, duration: 0, inlineViews: 0, floating: false });
  // Anything else that takes the speaker (a recording, a video in the viewer) stops this one.
  release = claimMediaPlayback(stopNowPlaying);
  const nonce = Array.from(Crypto.getRandomBytes(16), byte => byte.toString(16).padStart(2, '0')).join('');
  const cached = new File(Paths.cache, `lastcall-media-play-${nonce}.${kind === 'voice' ? 'm4a' : file.mime === 'video/quicktime' ? 'mov' : 'mp4'}`);
  try {
    const bytes = await loadFileData(file);
    if (!bytes?.byteLength || bytes.byteLength > MAX_MEDIA_BYTES) throw new Error(t('Recording is no longer stored on this device.'));
    if (mine !== generation) return;
    await cached.write(bytes);
    if (mine !== generation || AppState.currentState !== 'active') { deleteMediaCache(cached.uri); if (mine === generation) stopNowPlaying(); return; }
    copy = cached.uri;
    if (kind === 'voice') {
      await setAudioModeAsync({ allowsRecording: false, shouldPlayInBackground: false, allowsBackgroundRecording: false, playsInSilentMode: true, interruptionMode: 'doNotMix' });
      if (mine !== generation) return;
      const player = createAudioPlayer(cached.uri, { updateInterval: 200 });
      audio = player;
      const subscription = player.addListener('playbackStatusUpdate', (status: AudioStatus) => {
        if (status.didJustFinish) { stopNowPlaying(); return; }
        patch({ playing: status.playing, position: status.currentTime, duration: status.duration || state?.duration || 0, loading: !status.isLoaded });
      });
      detach.push(() => subscription.remove());
      player.play();
    } else {
      const player = createVideoPlayer(cached.uri);
      video = player;
      player.loop = false; player.staysActiveInBackground = false; player.timeUpdateEventInterval = 0.25;
      const playing = player.addListener('playingChange', ({ isPlaying }) => patch({ playing: isPlaying, loading: false }));
      const time = player.addListener('timeUpdate', ({ currentTime }) => patch({ position: currentTime }));
      const loaded = player.addListener('sourceLoad', ({ duration }) => patch({ duration, loading: false }));
      const ended = player.addListener('playToEnd', () => stopNowPlaying());
      detach.push(() => { playing.remove(); time.remove(); loaded.remove(); ended.remove(); });
      patch({ loading: false });
      player.play();
    }
  } catch {
    deleteMediaCache(cached.uri);
    if (mine === generation) { stopNowPlaying(); publish({ key, kind, conversationId: file.conversationId, playing: false, loading: false, position: 0, duration: 0, inlineViews: 0, floating: false, error: t('Could not open the recording. Try again.') }); setTimeout(() => { if (state?.error && state.key === key) publish(undefined); }, 4000); }
  }
}

/** The floating circle took or released the video surface. */
export function setFloatingShown(key: string, shown: boolean) { if (state?.key === key && state.floating !== shown) patch({ floating: shown }); }
/** A chat row showing the circle that is playing; returns the call that says it went away. */
export function showCircleInline(key: string) {
  if (state?.key === key) patch({ inlineViews: state.inlineViews + 1 });
  return () => { if (state?.key === key) patch({ inlineViews: Math.max(0, state.inlineViews - 1) }); };
}

// Leaving the app pauses; coming back leaves it paused, as Telegram does.
AppState.addEventListener('change', next => { if (next !== 'active') { audio?.pause(); video?.pause(); } });
