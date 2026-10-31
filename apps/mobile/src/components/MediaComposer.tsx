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
import { Button, Icon } from './ui';
import { VoiceNote } from './VoiceNote';
import { VideoNote } from './VideoNote';
import { RecordingWaveform } from './RecordingWaveform';

const VOICE_OPTIONS = { ...RecordingPresets.HIGH_QUALITY, bitRate: 64_000, numberOfChannels: 1, isMeteringEnabled: true, directory: 'cache' as const };
type Draft = { uri: string; name: string; mime: string };
type Phase = 'idle' | 'preparing' | 'ready' | 'recording' | 'stopping' | 'preview' | 'sending' | 'failed';

export function MediaComposer({ kind, conversationId, blocked, onClose }: { kind: MediaKind; conversationId: string; blocked: boolean; onClose: () => void }) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [draft, setDraft] = useState<Draft>();
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState('');
  const [cameraReady, setCameraReady] = useState(false);
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
  const blockedRef = useRef(blocked);
  const close = useRef(onClose);
  useEffect(() => { blockedRef.current = blocked; close.current = onClose; });
  const finishVoice = useRef<(status: RecordingStatus) => void>(() => {});
  const recorder = useAudioRecorder(VOICE_OPTIONS, status => finishVoice.current(status));
  const cancelled = useRef(false);
  function update(next: Phase) { phaseRef.current = next; if (scope.active) setPhase(next); }
  function permitted() { scope.assert(); if (blockedRef.current || client() !== current || AppState.currentState !== 'active') throw new Error('Запись прервана. Откройте её снова после звонка.'); }
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
      void recorder.stop().catch(() => {}).finally(() => { deleteMediaCache(abandoned); if (scope.active) { setError(status.error || 'Запись прервана системой.'); update('failed'); } void resetAudio(); });
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
      const elapsed = (Date.now() - started.current) / 1000; setSeconds(elapsed);
      if (elapsed >= MEDIA_SECONDS[kind]) void stop.current();
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
        started.current = Date.now(); setSeconds(0); update('recording');
        const result = await camera.current!.recordAsync({ maxDuration: MEDIA_SECONDS.circle, maxFileSize: MAX_MEDIA_BYTES, ...(Platform.OS === 'ios' ? { codec: 'avc1' as const } : {}) });
        if (!result?.uri) throw new Error('Камера не сохранила запись.');
        if (attempt !== recordingAttempt.current) { deleteMediaCache(result.uri); return; }
        await finish(result.uri, Math.min(MEDIA_SECONDS.circle, (Date.now() - started.current) / 1000));
        return;
      }
      update('preparing');
      const mic = await mediaPermission(() => AudioModule.getRecordingPermissionsAsync(), () => AudioModule.requestRecordingPermissionsAsync(), permitted); permitted();
      if (!mic.granted) throw new Error('Разрешите микрофон в настройках телефона.');
      if (kind === 'circle') {
        const permission = await mediaPermission(() => Camera.getCameraPermissionsAsync(), () => Camera.requestCameraPermissionsAsync(), permitted); permitted();
        if (!permission.granted) throw new Error('Разрешите камеру в настройках телефона.');
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
    <Text style={[styles.title, { textAlign: 'center' }]}>{kind === 'voice' ? 'Голосовое сообщение' : 'Видеокружок'}</Text>
    <Text style={[styles.info, { textAlign: 'center' }]}>{kind === 'voice' ? 'До 2 минут · запись только на этом экране' : 'До 30 секунд · фронтальная камера'} · до 5 МиБ</Text>
    <View style={{ minHeight: 250, justifyContent: 'center', alignItems: 'center' }}>
      {draft && (phase === 'preview' || phase === 'sending') ? kind === 'voice' ? <VoiceNote uri={draft.uri} /> : <VideoNote uri={draft.uri} /> : kind === 'circle' && ['ready', 'recording', 'stopping'].includes(phase) ?
        <View style={{ width: 250, height: 250, borderRadius: 125, overflow: 'hidden', backgroundColor: '#182832' }}><CameraView ref={camera} style={{ width: 250, height: 250 }} facing="front" mode="video" videoQuality={Platform.OS === 'ios' ? '4:3' : '480p'} videoBitrate={600_000} mirror onCameraReady={() => setCameraReady(true)} onMountError={event => { recordingAttempt.current++; try { camera.current?.stopRecording(); } catch {} setError(event.message); update('failed'); }} /></View> : kind === 'voice' && ['recording', 'stopping'].includes(phase) ? <RecordingWaveform recorder={recorder} active={phase === 'recording'} /> : <Icon name={kind === 'voice' ? 'mic-circle-outline' : 'videocam-outline'} size={92} />}
    </View>
    {['recording', 'stopping'].includes(phase) && <Text style={{ textAlign: 'center', color: '#B03939', fontSize: 25, fontVariant: ['tabular-nums'] }}>● {mediaTime(seconds)} / {mediaTime(MEDIA_SECONDS[kind])}</Text>}
    {!!error && <Text style={styles.error}>{error}</Text>}
    {phase === 'idle' && <Text style={[styles.info, { textAlign: 'center' }]}>Если Android запросит доступ, разрешите его и откройте запись снова. Уход с этого экрана отменяет запись.</Text>}
    {phase === 'preview' || phase === 'sending' ? <Button title="Отправить" busy={phase === 'sending'} onPress={() => void send()} /> : phase === 'recording' || phase === 'stopping' ? <Button title="Остановить" busy={phase === 'stopping'} onPress={() => void stop.current()} /> : <Button title={kind === 'circle' && phase === 'idle' ? 'Включить камеру' : 'Начать запись'} busy={phase === 'preparing'} disabled={phase === 'failed' || phase === 'ready' && !cameraReady} onPress={() => void start()} />}
    {phase === 'sending' && <Text style={styles.info}>Сохраняем зашифрованное сообщение для доставки…</Text>}
    <Button title={draft ? 'Удалить и закрыть' : 'Отмена'} secondary disabled={phase === 'sending'} onPress={() => cancelRef.current()} />
  </SafeAreaView></Modal>;
}
