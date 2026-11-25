import { useEffect, useImperativeHandle, useRef, useState, type ReactNode, type Ref } from 'react';
import { Animated, AppState, I18nManager, PanResponder, Text, View } from 'react-native';
import { AudioModule, RecordingPresets, setAudioModeAsync, useAudioRecorder, type RecordingStatus } from 'expo-audio';
import * as Crypto from 'expo-crypto';
import { File, Paths } from 'expo-file-system';
import { client, errorText } from '../runtime';
import { deleteMediaCache, sendRecordedMedia } from '../attachments';
import { createMediaScope, MEDIA_SECONDS, mediaMetadata, mediaTime, validateMedia } from '../media-model';
import { stopMediaPlayback } from '../media-playback';
import { haptic, messageSent } from '../feedback';
import { reportDenied } from '../permission-notice';
import { appendWaveformSample, type WaveformSample } from '../waveform-model';
import { colors, styles } from '../styles';
import { t } from '../i18n';
import { Icon, IconButton } from './ui';
import { VoiceNote } from './VoiceNote';

const VOICE_OPTIONS = { ...RecordingPresets.HIGH_QUALITY, bitRate: 64_000, numberOfChannels: 1, isMeteringEnabled: true, directory: 'cache' as const };
/** Shorter holds are taken as a tap: nothing is sent and the hint says to hold. */
const MIN_HOLD_SECONDS = 0.6;
const CANCEL_DISTANCE = 110;
const LOCK_DISTANCE = 80;
const LEVEL_BARS = 28;

/**
 * hold: the finger is on the button; locked: recording hands-free; preview: stopped, listen before
 * sending. Like Telegram, everything happens in the message bar, not on a separate screen.
 */
type Phase = 'idle' | 'starting' | 'hold' | 'locked' | 'stopping' | 'preview' | 'sending';
type Recording = { uri: string; name: string; mime: string };
export type VoiceComposerHandle = { startLocked: () => void };

export function VoiceComposer({ ref, conversationId, disabled, trailing, children, onActiveChange, onError, onHint }: {
  ref?: Ref<VoiceComposerHandle>;
  conversationId: string;
  /** A call is on, or the chat cannot send: recording stops and the microphone is off. */
  disabled: boolean;
  /** The send button while text is typed; the microphone shows only when it is absent. */
  trailing?: ReactNode;
  /** The attach button and the text field, replaced by the recording while it lasts. */
  children: ReactNode;
  onActiveChange: (active: boolean) => void;
  onError: (message: string) => void;
  onHint: (message: string) => void;
}) {
  const [phase, setPhaseState] = useState<Phase>('idle');
  const [seconds, setSeconds] = useState(0);
  const [recording, setRecording] = useState<Recording>();
  const [levels, setLevels] = useState<WaveformSample[]>([]);
  const phaseRef = useRef<Phase>('idle');
  const scope = useRef(createMediaScope());
  const attempt = useRef(0);
  const nonce = useRef('');
  const started = useRef(0);
  const released = useRef(false);
  /** Where the current touch began: a touch that started the recording never sends a locked one. */
  const touchFrom = useRef<Phase>('idle');
  const fileRef = useRef<Recording | undefined>(undefined);
  const rawUri = useRef<string | null>(null);
  const drag = useRef(new Animated.ValueXY()).current;
  const finished = useRef<(status: RecordingStatus) => void>(() => {});
  const atLimit = useRef(() => {});
  const gesture = useRef({ onGrant() {}, onMove(_dx: number, _dy: number) {}, onRelease() {}, onTerminate() {} });
  const recorder = useAudioRecorder(VOICE_OPTIONS, status => finished.current(status));
  const props = useRef({ conversationId, disabled, onActiveChange, onError, onHint });
  useEffect(() => { props.current = { conversationId, disabled, onActiveChange, onError, onHint }; });

  function setPhase(next: Phase) {
    const wasActive = phaseRef.current !== 'idle';
    phaseRef.current = next; setPhaseState(next);
    if (wasActive !== (next !== 'idle')) props.current.onActiveChange(next !== 'idle');
  }
  function allowed() {
    scope.current.assert();
    if (props.current.disabled || AppState.currentState !== 'active') throw new Error(t('Recording interrupted. Open it again after the call.'));
  }
  async function resetAudio() { await setAudioModeAsync({ allowsRecording: false, allowsBackgroundRecording: false, shouldPlayInBackground: false }).catch(() => {}); }
  function forget() {
    deleteMediaCache(rawUri.current); rawUri.current = null;
    deleteMediaCache(fileRef.current?.uri); fileRef.current = undefined; setRecording(undefined);
    setSeconds(0); setLevels([]); drag.setValue({ x: 0, y: 0 });
  }

  /** Stops and drops everything except a voice message already being sent. */
  const cancel = useRef(() => {});
  const cancelNow = () => {
    const current = phaseRef.current;
    if (current === 'idle' || current === 'sending') return;
    scope.current.cancel(); attempt.current++;
    if (current === 'hold' || current === 'locked' || current === 'starting' || current === 'stopping') {
      const abandoned = rawUri.current ?? recorder.uri;
      void recorder.stop().catch(() => {}).finally(() => { deleteMediaCache(abandoned); void resetAudio(); });
    }
    forget(); setPhase('idle');
  };

  async function start(locked: boolean) {
    if (phaseRef.current !== 'idle' || props.current.disabled) return;
    const mine = ++attempt.current;
    scope.current = createMediaScope();
    nonce.current = Array.from(Crypto.getRandomBytes(16), byte => byte.toString(16).padStart(2, '0')).join('');
    released.current = false;
    props.current.onError(''); props.current.onHint('');
    setPhase('starting');
    try {
      stopMediaPlayback();
      let access = await AudioModule.getRecordingPermissionsAsync();
      if (!access.granted) {
        if (access.canAskAgain !== false) access = await AudioModule.requestRecordingPermissionsAsync();
        if (!access.granted) { reportDenied('microphone'); if (mine === attempt.current) setPhase('idle'); return; }
        // The system dialog took the finger off the button: start again by holding.
        if (!locked) { if (mine === attempt.current) { setPhase('idle'); props.current.onHint(t('Hold to record, release to send.')); } return; }
      }
      allowed();
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true, shouldPlayInBackground: false, allowsBackgroundRecording: false, interruptionMode: 'doNotMix' });
      allowed();
      await recorder.prepareToRecordAsync({ ...VOICE_OPTIONS, fileName: `lastcall-voice-${nonce.current}` });
      rawUri.current = recorder.uri;
      allowed();
      if (mine !== attempt.current) return;
      if (!locked && released.current) { cancel.current(); props.current.onHint(t('Hold to record, release to send.')); return; }
      started.current = Date.now(); setSeconds(0); setLevels([]);
      recorder.record({ forDuration: MEDIA_SECONDS.voice });
      setPhase(locked ? 'locked' : 'hold'); haptic('longPress');
    } catch (cause) {
      if (mine !== attempt.current) return;
      try { await recorder.stop(); } catch { /* not started */ }
      deleteMediaCache(rawUri.current); rawUri.current = null; await resetAudio();
      setPhase('idle'); props.current.onError(errorText(cause));
    }
  }

  /** Ends the recording and either sends it, keeps it for listening, or reports it as too short. */
  async function stop(then: 'send' | 'preview') {
    const from = phaseRef.current;
    if (from !== 'hold' && from !== 'locked') return;
    const mine = attempt.current;
    const duration = Math.min(MEDIA_SECONDS.voice, (Date.now() - started.current) / 1000);
    setPhase('stopping');
    try { await recorder.stop(); } catch { /* already stopped at the time limit */ }
    await resetAudio();
    if (mine !== attempt.current) return;
    const uri = recorder.uri ?? rawUri.current;
    if (duration < MIN_HOLD_SECONDS) {
      deleteMediaCache(uri); forget(); setPhase('idle');
      if (from === 'hold') props.current.onHint(t('Hold to record, release to send.'));
      return;
    }
    try {
      if (!uri) throw new Error(t('Recording stopped by the system.'));
      scope.current.assert();
      const input = new File(uri);
      validateMedia(input.size, duration, 'voice');
      const metadata = mediaMetadata('voice', nonce.current, uri);
      const owned = new File(Paths.cache, metadata.name);
      await input.move(owned);
      rawUri.current = null;
      const next = { uri: owned.uri, ...metadata };
      fileRef.current = next;
      if (mine !== attempt.current) { deleteMediaCache(next.uri); return; }
      setRecording(next);
      if (then === 'preview') { setPhase('preview'); haptic('press'); }
      else await send();
    } catch (cause) {
      if (mine !== attempt.current) return;
      deleteMediaCache(uri); forget(); setPhase('idle'); props.current.onError(errorText(cause));
    }
  }

  async function send() {
    const file = fileRef.current;
    if (!file) return;
    const current = client();
    const sending = scope.current;
    setPhase('sending');
    try {
      stopMediaPlayback();
      await sendRecordedMedia(current, props.current.conversationId, file, sending);
      messageSent();
      deleteMediaCache(file.uri); fileRef.current = undefined; setRecording(undefined); setSeconds(0); setLevels([]);
      setPhase('idle');
    } catch (cause) {
      props.current.onError(errorText(cause));
      // Kept for another try, as a recording to listen to.
      if (fileRef.current === file) { setRecording(file); setPhase('preview'); }
    }
  }

  // The time limit, the native end of recording and recorder errors.
  const finishedNow = (status: RecordingStatus) => {
    if (status.hasError && (phaseRef.current === 'hold' || phaseRef.current === 'locked')) {
      cancel.current(); props.current.onError(status.error || t('Recording stopped by the system.'));
    } else if (status.isFinished && (phaseRef.current === 'hold' || phaseRef.current === 'locked')) void stop('preview');
  };
  useEffect(() => { cancel.current = cancelNow; finished.current = finishedNow; gesture.current = gestureNow; atLimit.current = () => void stop('preview'); });
  useEffect(() => {
    if (phase !== 'hold' && phase !== 'locked') return;
    const timer = setInterval(() => {
      const elapsed = (Date.now() - started.current) / 1000;
      setSeconds(elapsed);
      let metering: number | undefined;
      try { const state = recorder.getStatus(); if (state.isRecording) metering = state.metering; } catch { /* no meter */ }
      setLevels(previous => appendWaveformSample(previous, metering).slice(-LEVEL_BARS));
      if (elapsed >= MEDIA_SECONDS.voice) atLimit.current();
    }, 150);
    return () => clearInterval(timer);
  }, [phase, recorder]);
  // Leaving the app, a call or leaving the chat ends an unsent recording.
  useEffect(() => {
    const listener = AppState.addEventListener('change', state => { if (state === 'background') cancel.current(); });
    return () => { listener.remove(); cancel.current(); };
  }, []);
  useEffect(() => { if (disabled) cancel.current(); }, [disabled]);
  useImperativeHandle(ref, () => ({ startLocked: () => void start(true) }));

  // Hold to record, release to send, slide left to cancel, slide up to record hands-free.
  const gestureNow = {
    onGrant() {
      const current = phaseRef.current;
      touchFrom.current = current;
      if (current === 'idle') void start(false);
    },
    onMove(dx: number, dy: number) {
      const current = phaseRef.current;
      if (current !== 'hold' && current !== 'starting') return;
      const back = I18nManager.isRTL ? dx : -dx;
      drag.setValue({ x: I18nManager.isRTL ? Math.max(0, dx) : Math.min(0, dx), y: Math.min(0, dy) });
      if (back > CANCEL_DISTANCE) { haptic('reject'); released.current = true; cancel.current(); }
      else if (-dy > LOCK_DISTANCE && current === 'hold') { haptic('confirm'); drag.setValue({ x: 0, y: 0 }); setPhase('locked'); }
    },
    onRelease() {
      const current = phaseRef.current;
      drag.setValue({ x: 0, y: 0 });
      const from = touchFrom.current;
      touchFrom.current = 'idle';
      if (current === 'starting') released.current = true;
      else if (current === 'hold') void stop('send');
      // Lifting the finger after sliding up keeps recording; a later tap on the button sends.
      else if (current === 'locked' && from === 'locked') void stop('send');
      else if (current === 'preview' && from === 'preview') void send();
    },
    // Taken away by the system: a recording in progress keeps going hands-free.
    onTerminate() {
      drag.setValue({ x: 0, y: 0 });
      if (phaseRef.current === 'hold') setPhase('locked'); else if (phaseRef.current === 'starting') released.current = true;
    },
  };
  const [responder] = useState(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: () => gesture.current.onGrant(),
    onPanResponderMove: (_, state) => gesture.current.onMove(state.dx, state.dy),
    onPanResponderRelease: () => gesture.current.onRelease(),
    onPanResponderTerminate: () => gesture.current.onTerminate(),
  }));

  const recordingNow = phase === 'hold' || phase === 'starting' || phase === 'locked' || phase === 'stopping';
  const showTrailing = !!trailing && phase === 'idle';
  const micMode = phase === 'idle' || phase === 'starting' || phase === 'hold';
  const timer = <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
    <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: '#D93A3A', opacity: Math.floor(seconds * 2) % 2 ? 0.35 : 1 }} />
    <Text style={{ color: colors.text, fontSize: 16, fontVariant: ['tabular-nums'] }}>{mediaTime(seconds)}</Text>
  </View>;
  let body: ReactNode = children;
  if (phase === 'hold' || phase === 'starting') {
    body = <View style={{ flex: 1, minHeight: 44, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10 }}>
      {timer}
      <Animated.View style={{ flex: 1, alignItems: 'center', opacity: drag.x.interpolate({ inputRange: I18nManager.isRTL ? [0, CANCEL_DISTANCE] : [-CANCEL_DISTANCE, 0], outputRange: I18nManager.isRTL ? [1, 0.2] : [0.2, 1], extrapolate: 'clamp' }) }}>
        <Text style={{ color: colors.secondary, fontSize: 15 }}>{I18nManager.isRTL ? '›' : '‹'} {t('Slide to cancel')}</Text>
      </Animated.View>
    </View>;
  } else if (phase === 'locked' || phase === 'stopping') {
    body = <View style={{ flex: 1, minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 4 }}>
      <IconButton name="trash-outline" color={colors.danger} label={t('Delete recording')} onPress={() => cancel.current()} />
      {timer}
      <View accessible={false} style={{ flex: 1, height: 28, marginHorizontal: 6, flexDirection: 'row', alignItems: 'center', gap: 2 }}>
        {[...Array<WaveformSample>(Math.max(0, LEVEL_BARS - levels.length)).fill(null), ...levels].map((level, index) => <View key={index} style={{ flex: 1, maxWidth: 3, height: 3 + (level ?? 0) * 24, borderRadius: 2, backgroundColor: level === null ? '#C5D9D2' : colors.accent }} />)}
      </View>
      <IconButton name="stop-circle-outline" color="#D93A3A" label={t('Stop and listen')} disabled={phase !== 'locked'} onPress={() => void stop('preview')} />
    </View>;
  } else if ((phase === 'preview' || phase === 'sending') && recording) {
    body = <View style={{ flex: 1, minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 4 }}>
      <IconButton name="trash-outline" color={colors.danger} label={t('Delete recording')} disabled={phase === 'sending'} onPress={() => cancel.current()} />
      <View style={{ flex: 1, alignItems: 'flex-start' }}><VoiceNote uri={recording.uri} /></View>
    </View>;
  }

  return <View style={styles.composer}>
    {body}
    {showTrailing ? trailing : <View>
      {phase === 'hold' && <Animated.View pointerEvents="none" style={{ position: 'absolute', bottom: 62, alignSelf: 'center', alignItems: 'center', paddingVertical: 8, paddingHorizontal: 9, borderRadius: 20, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line, transform: [{ translateY: drag.y.interpolate({ inputRange: [-LOCK_DISTANCE, 0], outputRange: [-24, 0], extrapolate: 'clamp' }) }] }}>
        <Icon name="lock-open-outline" size={20} color={colors.secondary} /><Icon name="chevron-up" size={16} color={colors.secondary} />
      </Animated.View>}
      <Animated.View {...responder.panHandlers}
        accessible accessibilityRole="button"
        accessibilityLabel={micMode ? t('Record voice message') : t('Send voice message')}
        accessibilityHint={micMode ? t('Hold to record, release to send.') : undefined}
        accessibilityState={{ disabled: disabled || phase === 'sending' || phase === 'stopping' }}
        accessibilityActions={[{ name: 'activate' }]}
        onAccessibilityAction={() => { const current = phaseRef.current; if (current === 'idle') void start(true); else if (current === 'locked') void stop('send'); else if (current === 'preview') void send(); }}
        pointerEvents={disabled || phase === 'sending' || phase === 'stopping' ? 'none' : 'auto'}
        style={[{ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
          micMode && !recordingNow ? null : { backgroundColor: colors.accent },
          (disabled || phase === 'sending') && styles.disabled,
          { transform: [{ translateX: drag.x }, { scale: phase === 'hold' || phase === 'starting' ? 1.35 : 1 }] }]}>
        <Icon name={micMode ? 'mic-outline' : 'arrow-up'} size={micMode && !recordingNow ? 27 : 25} color={micMode && !recordingNow ? undefined : colors.white} />
      </Animated.View>
    </View>}
  </View>;
}
