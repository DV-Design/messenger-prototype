import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react';
import { Platform, View } from 'react-native';
import { CameraView } from 'expo-camera';
import { File, Paths } from 'expo-file-system';
import { deleteMediaCache } from '../attachments';
import { MAX_MEDIA_BYTES, MEDIA_SECONDS } from '../media-model';
import { mergeCircleSegments } from '../video-merge';
import { errorText } from '../runtime';
import { t } from '../i18n';

export type CircleCaptureHandle = {
  /** Starts recording once the camera is ready; false when it is not ready yet. */
  record: () => boolean;
  stop: () => void;
  /** Turns the lens. On Android also while recording (a new segment, merged at the end); on iOS only before. */
  flip: () => boolean;
};
type Segment = { uri: string; ms: number; endedAt: number };
/** The lens chosen last time, as Telegram remembers it. */
let lastFacing: 'front' | 'back' = 'front';
export const CIRCLE_SIZE = 250;

/**
 * The round camera of a video circle being recorded in the message bar. Unmounting it cancels the
 * recording and deletes what was captured; a finished recording is handed over with its duration.
 */
export function CircleCapture({ ref, nonce, onReady, onFinished, onSegments, onFailed, onSwitching }: {
  ref?: Ref<CircleCaptureHandle>;
  nonce: string;
  /**
   * When given, the camera records silently (the voice is recorded on its own, without a break at
   * a lens switch) and the segments are handed over as they are, with when each one ended.
   */
  onSegments?: (segments: { uri: string; endedAt: number }[]) => void;
  onReady: () => void;
  onFinished: (uri: string, seconds: number) => void;
  onFailed: (message: string) => void;
  onSwitching: (switching: boolean) => void;
}) {
  const camera = useRef<CameraView>(null);
  const [facing, setFacing] = useState(lastFacing);
  const ready = useRef(false);
  const fellBack = useRef(false);
  const alive = useRef(true);
  const recording = useRef(false);
  const segments = useRef<Segment[]>([]);
  const elapsed = useRef(0);
  const segmentStarted = useRef(0);
  const next = useRef<'switch' | 'stop' | null>(null);
  const restartPending = useRef(false);
  const restartTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const callbacks = useRef({ onReady, onFinished, onSegments, onFailed, onSwitching });
  useEffect(() => { callbacks.current = { onReady, onFinished, onSegments, onFailed, onSwitching }; });
  const silent = useRef(!!onSegments).current;

  function discard() { for (const segment of segments.current) deleteMediaCache(segment.uri); segments.current = []; elapsed.current = 0; }
  function clearRestart() { restartPending.current = false; if (restartTimer.current) clearTimeout(restartTimer.current); restartTimer.current = undefined; }

  async function finish() {
    recording.current = false; clearRestart();
    const recorded = segments.current; const measured = elapsed.current;
    segments.current = []; elapsed.current = 0;
    if (!alive.current) { for (const segment of recorded) deleteMediaCache(segment.uri); return; }
    if (!recorded.length) { callbacks.current.onFailed(t('The camera did not save the recording.')); return; }
    if (silent && callbacks.current.onSegments) { callbacks.current.onSegments(recorded.map(segment => ({ uri: segment.uri, endedAt: segment.endedAt }))); return; }
    if (recorded.length === 1) { callbacks.current.onFinished(recorded[0]!.uri, Math.min(MEDIA_SECONDS.circle, measured / 1000)); return; }
    const merged = new File(Paths.cache, `lastcall-circle-merge-${nonce}-${Date.now()}.mp4`);
    try {
      const mergedMs = await mergeCircleSegments(recorded.map(segment => segment.uri), merged.uri);
      for (const segment of recorded) deleteMediaCache(segment.uri);
      if (!alive.current) { deleteMediaCache(merged.uri); return; }
      callbacks.current.onFinished(merged.uri, Math.min(MEDIA_SECONDS.circle, mergedMs / 1000));
    } catch (cause) {
      deleteMediaCache(merged.uri); for (const segment of recorded) deleteMediaCache(segment.uri);
      if (alive.current) callbacks.current.onFailed(errorText(cause));
    }
  }

  async function segment() {
    const remaining = Math.max(0.5, MEDIA_SECONDS.circle - elapsed.current / 1000);
    segmentStarted.current = Date.now(); recording.current = true;
    callbacks.current.onSwitching(false);
    try {
      const result = await camera.current!.recordAsync({ maxDuration: remaining, maxFileSize: MAX_MEDIA_BYTES, ...(silent ? { mute: true } : {}), ...(Platform.OS === 'ios' ? { codec: 'avc1' as const } : {}) });
      const endedAt = Date.now();
      const measured = segmentStarted.current ? Math.min(remaining * 1000, Date.now() - segmentStarted.current) : 0;
      segmentStarted.current = 0;
      const then = next.current; next.current = null;
      if (!result?.uri) throw new Error(t('The camera did not save the recording.'));
      if (!alive.current) { deleteMediaCache(result.uri); discard(); recording.current = false; return; }
      segments.current.push({ uri: result.uri, ms: measured, endedAt }); elapsed.current += measured;
      if (then === 'switch') {
        // Stop before changing the lens: Android OEMs finalize a recording when its camera is rebound.
        ready.current = false; restartPending.current = true;
        setFacing(value => (lastFacing = value === 'front' ? 'back' : 'front'));
        restartTimer.current = setTimeout(() => { if (restartPending.current && alive.current) { callbacks.current.onSwitching(false); void finish(); } }, 6000);
        return;
      }
      await finish();
    } catch (cause) {
      segmentStarted.current = 0; next.current = null; recording.current = false; clearRestart(); discard();
      if (alive.current) callbacks.current.onFailed(errorText(cause));
    }
  }

  useImperativeHandle(ref, () => ({
    record() {
      if (!ready.current || recording.current || !camera.current) return false;
      discard(); void segment(); return true;
    },
    stop() {
      if (restartPending.current) { clearRestart(); callbacks.current.onSwitching(false); void finish(); return; }
      if (!recording.current || next.current === 'stop') return;
      next.current = 'stop';
      try { camera.current?.stopRecording(); } catch { next.current = null; void finish(); }
    },
    flip() {
      if (next.current || restartPending.current) return false;
      if (recording.current) {
        if (Platform.OS !== 'android' || !ready.current) return false;
        next.current = 'switch'; callbacks.current.onSwitching(true);
        camera.current?.stopRecording();
        return true;
      }
      ready.current = false;
      setFacing(value => (lastFacing = value === 'front' ? 'back' : 'front'));
      return true;
    },
  }));
  useEffect(() => () => {
    alive.current = false; clearRestart();
    try { camera.current?.stopRecording(); } catch { /* not recording */ }
    discard();
  }, []);

  return <View style={{ width: CIRCLE_SIZE, height: CIRCLE_SIZE, borderRadius: CIRCLE_SIZE / 2, overflow: 'hidden', backgroundColor: '#182832' }}>
    <CameraView ref={camera} style={{ width: CIRCLE_SIZE, height: CIRCLE_SIZE }} facing={facing} mode="video" videoQuality={Platform.OS === 'ios' ? '4:3' : '480p'} videoBitrate={600_000} mirror={Platform.OS === 'android' || facing === 'front'}
      onCameraReady={() => {
        ready.current = true;
        if (restartPending.current && alive.current) { clearRestart(); void segment(); return; }
        callbacks.current.onReady();
      }}
      onMountError={event => {
        // A phone (or emulator) with one lens: try the other one once before giving up.
        if (!recording.current && !restartPending.current && !fellBack.current) {
          fellBack.current = true; ready.current = false;
          setFacing(value => (lastFacing = value === 'front' ? 'back' : 'front'));
          return;
        }
        if (recording.current || restartPending.current) { clearRestart(); next.current = null; callbacks.current.onSwitching(false); if (segments.current.length) { void finish(); return; } }
        if (alive.current) callbacks.current.onFailed(event.message);
      }} />
  </View>;
}
