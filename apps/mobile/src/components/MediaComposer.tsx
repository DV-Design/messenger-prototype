import { useEffect, useRef, useState } from 'react';
import { AppState, Modal, Platform, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AudioModule, RecordingPresets, setAudioModeAsync, useAudioRecorder, type RecordingStatus } from 'expo-audio';
import { Camera, CameraView } from 'expo-camera';
import * as Crypto from 'expo-crypto';
import { File, Paths } from 'expo-file-system';
import { client, errorText } from '../runtime';
import { deleteMediaCache, pruneMediaCache, sendRecordedMedia } from '../attachments';
import { createMediaScope, MAX_MEDIA_BYTES, MEDIA_SECONDS, mediaMetadata, mediaPermission, mediaTime, validateMedia, type MediaKind } from '../media-model';
import { stopMediaPlayback } from '../media-playback';
import { styles } from '../styles';
import { t } from '../i18n';
import { mergeCircleSegments } from '../video-merge';
import { Button, Icon } from './ui';
import { VoiceNote } from './VoiceNote';
import { VideoNote } from './VideoNote';
import { RecordingWaveform } from './RecordingWaveform';

const VOICE_OPTIONS = { ...RecordingPresets.HIGH_QUALITY, bitRate: 64_000, numberOfChannels: 1, isMeteringEnabled: true, directory: 'cache' as const };
type Draft = { uri: string; name: string; mime: string };
type Phase = 'idle' | 'preparing' | 'ready' | 'recording' | 'stopping' | 'processing' | 'preview' | 'sending' | 'failed';
type CircleSegment = { uri: string; ms: number };

export function MediaComposer({ kind, conversationId, blocked, onClose }: { kind: MediaKind; conversationId: string; blocked: boolean; onClose: () => void }) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [draft, setDraft] = useState<Draft>();
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState('');
  const [cameraReady, setCameraReady] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [facing, setFacing] = useState<'front' | 'back'>('front');
  const current = useRef(client()).current;
  const scope = useRef(createMediaScope()).current;
  const nonce = useRef(Array.from(Crypto.getRandomBytes(16), byte => byte.toString(16).padStart(2, '0')).join('')).current;
  const camera = useRef<CameraView>(null);
  const phaseRef = useRef<Phase>('idle');
  const started = useRef(0);
  const original = useRef<string | null>(null);
  const draftRef = useRef<Draft | undefined>(undefined);
  const finishing = useRef(false);
  const recordingAttempt = useRef(0);
  const discarding = useRef(false);
  const switchingCamera = useRef(false);
  // Android records a new segment after every lens switch; the segments are
  // merged into one MP4 before preview. No camera rebind happens mid-recording.
  const segments = useRef<CircleSegment[]>([]);
  const segmentElapsed = useRef(0);
  const segmentStarted = useRef(0);
  const segmentAction = useRef<'switch' | 'stop' | null>(null);
  const segmentTarget = useRef<'front' | 'back' | null>(null);
  const segmentRestart = useRef<number | null>(null);
  const restartTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const blockedRef = useRef(blocked);
  const close = useRef(onClose);
  useEffect(() => { blockedRef.current = blocked; close.current = onClose; });
  const finishVoice = useRef<(status: RecordingStatus) => void>(() => {});
  const recorder = useAudioRecorder(VOICE_OPTIONS, status => finishVoice.current(status));
  const cancelled = useRef(false);
  function update(next: Phase) { phaseRef.current = next; if (scope.active) setPhase(next); }
  function permitted() { scope.assert(); if (blockedRef.current || client() !== current || AppState.currentState !== 'active') throw new Error(t('Recording interrupted. Open it again after the call.')); }
  function clearRestartTimer() {
    if (restartTimer.current) clearTimeout(restartTimer.current);
    restartTimer.current = undefined;
  }
  function resetCircleSession() {
    segments.current = [];
    segmentElapsed.current = 0;
    segmentStarted.current = 0;
    segmentAction.current = null;
    segmentTarget.current = null;
    segmentRestart.current = null;
    clearRestartTimer();
    setSwitching(false);
  }
  function discardCircleSegments() {
    for (const segment of segments.current) deleteMediaCache(segment.uri);
    resetCircleSession();
  }
  async function finishCircle(attempt: number) {
    if (!scope.active || attempt !== recordingAttempt.current) return;
    switchingCamera.current = false;
    const recorded = segments.current;
    const measured = segmentElapsed.current;
    resetCircleSession();
    if (!recorded.length) { setError(t('The camera did not save the recording.')); update('failed'); return; }
    let uri = recorded[0]!.uri;
    let duration = Math.min(MEDIA_SECONDS.circle, measured / 1000);
    if (recorded.length > 1) {
      update('processing');
      const merged = new File(Paths.cache, `lastcall-circle-merge-${nonce}-${Date.now()}.mp4`);
      try {
        const mergedMs = await mergeCircleSegments(recorded.map(segment => segment.uri), merged.uri);
        for (const segment of recorded) deleteMediaCache(segment.uri);
        if (!scope.active || attempt !== recordingAttempt.current) { deleteMediaCache(merged.uri); return; }
        uri = merged.uri;
        duration = Math.min(MEDIA_SECONDS.circle, mergedMs / 1000);
      } catch (cause) {
        deleteMediaCache(merged.uri);
        for (const segment of recorded) deleteMediaCache(segment.uri);
        if (scope.active && attempt === recordingAttempt.current) { setError(errorText(cause)); update('failed'); }
        return;
      }
    }
    if (!scope.active || attempt !== recordingAttempt.current) { deleteMediaCache(uri); return; }
    await finish(uri, duration);
  }
  async function recordCircleSegment(attempt: number) {
    if (!scope.active || attempt !== recordingAttempt.current) return;
    const remaining = Math.max(0.5, MEDIA_SECONDS.circle - segmentElapsed.current / 1000);
    segmentStarted.current = Date.now();
    switchingCamera.current = false;
    setSwitching(false);
    setSeconds(segmentElapsed.current / 1000);
    update('recording');
    try {
      const result = await camera.current!.recordAsync({ maxDuration: remaining, maxFileSize: MAX_MEDIA_BYTES });
      const measured = segmentStarted.current ? Math.min(remaining * 1000, Date.now() - segmentStarted.current) : 0;
      segmentStarted.current = 0;
      if (!result?.uri) throw new Error(t('The camera did not save the recording.'));
      if (!scope.active || attempt !== recordingAttempt.current) { deleteMediaCache(result.uri); return; }
      segments.current.push({ uri: result.uri, ms: measured });
      segmentElapsed.current += measured;
      const action = segmentAction.current;
      segmentAction.current = null;
      if (action === 'switch') {
        const target = segmentTarget.current;
        segmentTarget.current = null;
        if (!target) { await finishCircle(attempt); return; }
        // Stop before changing the lens: Android OEMs finalize a recording
        // when its VideoCapture is rebound, even as a persistent recording.
        setCameraReady(false);
        segmentRestart.current = attempt;
        setFacing(target);
        clearRestartTimer();
        restartTimer.current = setTimeout(() => {
          restartTimer.current = undefined;
          if (segmentRestart.current !== attempt || !scope.active || attempt !== recordingAttempt.current) return;
          segmentRestart.current = null;
          switchingCamera.current = false;
          setSwitching(false);
          void finishCircle(attempt);
        }, 6000);
        return;
      }
      await finishCircle(attempt);
    } catch (cause) {
      segmentStarted.current = 0;
      segmentAction.current = null;
      segmentTarget.current = null;
      segmentRestart.current = null;
      clearRestartTimer();
      switchingCamera.current = false;
      setSwitching(false);
      if (!scope.active || attempt !== recordingAttempt.current) return;
      discardCircleSegments();
      setError(errorText(cause));
      update('failed');
    }
  }
  function flipCamera() {
    if (kind !== 'circle' || switchingCamera.current || segmentAction.current) return;
    const currentPhase = phaseRef.current;
    if (Platform.OS === 'android' && currentPhase === 'recording') {
      try { permitted(); } catch { return; }
      if (!cameraReady) return;
      switchingCamera.current = true;
      segmentAction.current = 'switch';
      segmentTarget.current = facing === 'front' ? 'back' : 'front';
      setSwitching(true);
      camera.current?.stopRecording();
      return;
    }
    // iOS only supports choosing the lens before capture.
    const allowed = Platform.OS === 'android' ? ['ready', 'recording'].includes(currentPhase) : currentPhase === 'ready';
    if (!allowed) return;
    try { permitted(); } catch { return; }
    switchingCamera.current = true;
    setTimeout(() => { switchingCamera.current = false; }, 700);
    setFacing(value => (value === 'front' ? 'back' : 'front'));
  }
  function retake() {
    if (phaseRef.current !== 'preview' || !draftRef.current) return;
    deleteMediaCache(draftRef.current.uri);
    draftRef.current = undefined; original.current = null; setDraft(undefined); setSeconds(0); finishing.current = false;
    recordingAttempt.current++;
    discardCircleSegments();
    if (kind === 'circle') { setCameraReady(false); update('ready'); } else update('idle');
  }
  async function resetAudio() { if (!blockedRef.current) await setAudioModeAsync({ allowsRecording: false, allowsBackgroundRecording: false, shouldPlayInBackground: false }).catch(() => {}); }
  async function finish(uri: string, duration: number) {
    original.current = uri;
    if (!scope.active) { deleteMediaCache(uri); return; }
    if (finishing.current || draftRef.current) return;
    finishing.current = true;
    let ownedUri: string | undefined;
    try {
      permitted();
      const input = new File(uri);
      validateMedia(input.size, duration, kind);
      const metadata = mediaMetadata(kind, nonce, uri);
      const owned = new File(Paths.cache, metadata.name);
      ownedUri = owned.uri;
      await input.move(owned);
      if (!scope.active) { deleteMediaCache(owned.uri); return; }
      permitted();
      const next = { uri: owned.uri, ...metadata };
      original.current = null; draftRef.current = next; setDraft(next); update('preview');
    } catch (cause) { deleteMediaCache(uri); deleteMediaCache(ownedUri); if (scope.active) { setError(errorText(cause)); update('idle'); } }
    finally { finishing.current = false; }
  }
  useEffect(() => { finishVoice.current = status => {
    if (discarding.current) { deleteMediaCache(status.url); return; }
    if (status.hasError && scope.active) {
      discarding.current = true;
      const abandoned = original.current ?? recorder.uri; original.current = abandoned;
      update('stopping');
      void recorder.stop().catch(() => {}).finally(() => { deleteMediaCache(abandoned); if (scope.active) { setError(status.error || t('Recording stopped by the system.')); update('failed'); } void resetAudio(); });
    } else if (status.isFinished && status.url) {
      if (!scope.active) { deleteMediaCache(status.url); return; }
      // stop() and its native status event can both report the same file.
      if (phaseRef.current === 'recording' || phaseRef.current === 'stopping') {
        update('stopping'); void finish(status.url, Math.min(MEDIA_SECONDS.voice, (Date.now() - started.current) / 1000)); void resetAudio();
      }
    }
  }; });
  const cancelRef = useRef(() => {});
  useEffect(() => { cancelRef.current = () => {
    if (cancelled.current) return;
    cancelled.current = true; scope.cancel(); recordingAttempt.current++;
    try { camera.current?.stopRecording(); } catch {}
    discardCircleSegments();
    try { original.current ??= recorder.uri; void recorder.stop().catch(() => {}).finally(() => deleteMediaCache(original.current)); } catch {}
    deleteMediaCache(original.current); deleteMediaCache(draftRef.current?.uri);
    stopMediaPlayback(); void resetAudio(); close.current();
  }; });
  useEffect(() => {
    stopMediaPlayback(); pruneMediaCache();
    const listener = AppState.addEventListener('change', state => { if (state === 'background') cancelRef.current(); });
    return () => { listener.remove(); cancelRef.current(); };
  }, []);
  useEffect(() => { if (blocked) cancelRef.current(); }, [blocked]);
  const stop = useRef(async () => {});
  useEffect(() => { stop.current = async () => {
    if (phaseRef.current !== 'recording') return;
    if (kind === 'circle' && Platform.OS === 'android') {
      if (segmentAction.current) return;
      segmentAction.current = 'stop';
      update('stopping');
      try { camera.current?.stopRecording(); } catch { segmentAction.current = null; await finishCircle(recordingAttempt.current); }
      return;
    }
    update('stopping');
    if (kind === 'circle') { camera.current?.stopRecording(); return; }
    try {
      await recorder.stop();
      // Some devices dispatch the native completion event after stop resolves.
      if (scope.active && (phaseRef.current as Phase) === 'stopping' && recorder.uri) await finish(recorder.uri, Math.min(MEDIA_SECONDS.voice, (Date.now() - started.current) / 1000));
    } catch (cause) { deleteMediaCache(original.current); if (scope.active) { setError(errorText(cause)); update('failed'); } }
    finally { await resetAudio(); }
  }; });
  useEffect(() => {
    if (phase !== 'recording') return;
    const interval = setInterval(() => {
      const elapsed = kind === 'circle' && Platform.OS === 'android'
        ? (segmentElapsed.current + (segmentStarted.current ? Date.now() - segmentStarted.current : 0)) / 1000
        : (Date.now() - started.current) / 1000;
      setSeconds(elapsed);
      if (elapsed < MEDIA_SECONDS[kind]) return;
      if (kind === 'circle' && Platform.OS === 'android') {
        if (!segmentAction.current && phaseRef.current === 'recording') void stop.current();
      } else void stop.current();
    }, 200);
    return () => clearInterval(interval);
  }, [phase, kind]);
  async function start() {
    if (!['idle', 'ready'].includes(phaseRef.current)) return;
    setError('');
    const attempt = ++recordingAttempt.current;
    try {
      permitted(); stopMediaPlayback();
      if (kind === 'circle' && phaseRef.current === 'ready') {
        if (!cameraReady) return;
        started.current = Date.now(); setSeconds(0);
        if (Platform.OS === 'android') {
          resetCircleSession();
          await recordCircleSegment(attempt);
          return;
        }
        update('recording');
        const result = await camera.current!.recordAsync({ maxDuration: MEDIA_SECONDS.circle, maxFileSize: MAX_MEDIA_BYTES, ...(Platform.OS === 'ios' ? { codec: 'avc1' as const } : {}) });
        if (!result?.uri) throw new Error(t('The camera did not save the recording.'));
        if (attempt !== recordingAttempt.current) { deleteMediaCache(result.uri); return; }
        await finish(result.uri, Math.min(MEDIA_SECONDS.circle, (Date.now() - started.current) / 1000));
        return;
      }
      update('preparing');
      const mic = await mediaPermission(() => AudioModule.getRecordingPermissionsAsync(), () => AudioModule.requestRecordingPermissionsAsync(), permitted); permitted();
      if (!mic.granted) throw new Error(t('Allow microphone access in phone settings.'));
      if (kind === 'circle') {
        const permission = await mediaPermission(() => Camera.getCameraPermissionsAsync(), () => Camera.requestCameraPermissionsAsync(), permitted); permitted();
        if (!permission.granted) throw new Error(t('Allow camera access in phone settings.'));
        setCameraReady(false); update('ready'); return;
      }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true, shouldPlayInBackground: false, allowsBackgroundRecording: false, interruptionMode: 'doNotMix' }); permitted();
      await recorder.prepareToRecordAsync({ ...VOICE_OPTIONS, fileName: `lastcall-voice-${nonce}` });
      original.current = recorder.uri; permitted();
      started.current = Date.now(); setSeconds(0); recorder.record({ forDuration: MEDIA_SECONDS.voice }); update('recording');
    } catch (cause) {
      if (!scope.active || attempt !== recordingAttempt.current) { try { await recorder.stop(); } catch {} deleteMediaCache(recorder.uri); return; }
      try { await recorder.stop(); } catch {}
      deleteMediaCache(original.current); deleteMediaCache(recorder.uri); setError(errorText(cause)); update('idle'); await resetAudio();
    }
  }
  async function send() {
    if (!draftRef.current || phaseRef.current !== 'preview') return;
    try {
      permitted(); stopMediaPlayback(); update('sending');
      await sendRecordedMedia(current, conversationId, draftRef.current, scope);
      if (scope.active) cancelRef.current();
    } catch (cause) { if (scope.active) { setError(errorText(cause)); update('preview'); } }
  }
  return <Modal visible animationType="slide" onRequestClose={() => { if (phaseRef.current !== 'sending') cancelRef.current(); }} presentationStyle="pageSheet"><SafeAreaView style={[styles.whiteScreen, { padding: 22, gap: 20, justifyContent: 'center' }]}>
    <Text style={[styles.title, { textAlign: 'center' }]}>{kind === 'voice' ? t('Voice message') : t('Video circle')}</Text>
    <Text style={[styles.info, { textAlign: 'center' }]}>{kind === 'voice' ? t('Up to 2 minutes · recording only on this screen') : Platform.OS === 'android' ? t('Up to 30 seconds · you can switch the camera while recording') : t('Up to 30 seconds · choose the camera before recording')} · {t('up to 5 MiB')}</Text>
    <View style={{ minHeight: 250, justifyContent: 'center', alignItems: 'center' }}>
      {draft && (phase === 'preview' || phase === 'sending') ? kind === 'voice' ? <VoiceNote uri={draft.uri} /> : <View style={{ alignItems: 'center', gap: 8 }}><Text style={styles.info}> {t('Preview — tap to play')}</Text><VideoNote uri={draft.uri} autoPlay /></View> : kind === 'circle' && ['ready', 'recording', 'stopping'].includes(phase) ?
        <View style={{ width: 250, height: 250, borderRadius: 125, overflow: 'hidden', backgroundColor: '#182832' }}><CameraView ref={camera} style={{ width: 250, height: 250 }} facing={facing} mode="video" videoQuality={Platform.OS === 'ios' ? '4:3' : '480p'} videoBitrate={600_000} mirror={Platform.OS === 'android' || facing === 'front'} onCameraReady={() => {
          setCameraReady(true);
          const attempt = segmentRestart.current;
          if (attempt !== null && attempt === recordingAttempt.current && scope.active) {
            segmentRestart.current = null;
            clearRestartTimer();
            void recordCircleSegment(attempt);
          }
        }} onMountError={event => {
          if (phaseRef.current === 'recording' && Platform.OS === 'android' && segmentRestart.current !== null) {
            segmentRestart.current = null; clearRestartTimer(); switchingCamera.current = false; setSwitching(false);
            setError(event.message); void finishCircle(recordingAttempt.current); return;
          }
          if (phaseRef.current === 'recording') { setError(event.message); return; }
          recordingAttempt.current++; try { camera.current?.stopRecording(); } catch {} setError(event.message); update('failed');
        }} /></View> : kind === 'voice' && ['recording', 'stopping'].includes(phase) ? <RecordingWaveform recorder={recorder} active={phase === 'recording'} /> : <Icon name={kind === 'voice' ? 'mic-circle-outline' : 'videocam-outline'} size={92} />}
    </View>
    {['recording', 'stopping'].includes(phase) && <Text style={{ textAlign: 'center', color: '#B03939', fontSize: 25, fontVariant: ['tabular-nums'] }}>● {mediaTime(seconds)} / {mediaTime(MEDIA_SECONDS[kind])}</Text>}
    {!!error && <Text style={styles.error}>{error}</Text>}
    {phase === 'idle' && <Text style={[styles.info, { textAlign: 'center' }]}> {t('If Android asks for access, allow it and open recording again. Leaving this screen cancels recording.')}</Text>}
    {phase === 'processing' ? <Text style={[styles.info, { textAlign: 'center' }]}>{t('Processing video…')}</Text> : phase === 'preview' || phase === 'sending' ? <Button title={t('Send')} busy={phase === 'sending'} onPress={() => void send()} /> : phase === 'recording' || phase === 'stopping' ? <Button title={t('Stop')} busy={phase === 'stopping'} onPress={() => void stop.current()} /> : <Button title={kind === 'circle' && phase === 'idle' ? t('Turn on camera') : t('Start recording')} busy={phase === 'preparing'} disabled={phase === 'failed' || phase === 'ready' && !cameraReady} onPress={() => void start()} />}
    {kind === 'circle' && (Platform.OS === 'android' ? ['ready', 'recording'].includes(phase) : phase === 'ready') && <Button title={switching ? t('Switching camera…') : facing === 'front' ? t('Rear camera') : t('Front camera')} secondary busy={!cameraReady || switching} disabled={!cameraReady || switching || phase === 'stopping'} onPress={flipCamera} />}
    {phase === 'preview' && kind === 'circle' && <Button title={t('Retake')} secondary onPress={retake} />}
    {phase === 'sending' && <Text style={styles.info}> {t('Saving the encrypted message for delivery…')}</Text>}
    <Button title={draft ? t('Delete and close') : t('Cancel')} secondary disabled={phase === 'sending'} onPress={() => cancelRef.current()} />
  </SafeAreaView></Modal>;
}
