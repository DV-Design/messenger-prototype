import { useEffect, useImperativeHandle, useRef, useState, type ReactNode, type Ref } from 'react';
import { Animated, AppState, I18nManager, PanResponder, Platform, Text, View } from 'react-native';
import { AudioModule, RecordingPresets, setAudioModeAsync, useAudioRecorder, type RecordingStatus } from 'expo-audio';
import { Camera } from 'expo-camera';
import * as Crypto from 'expo-crypto';
import { File, Paths } from 'expo-file-system';
import { client, errorText } from '../runtime';
import { deleteMediaCache, pruneMediaCache, sendRecordedMedia } from '../attachments';
import { createMediaScope, MEDIA_SECONDS, mediaMetadata, mediaTime, validateMedia, type MediaKind } from '../media-model';
import { stopMediaPlayback } from '../media-playback';
import { haptic, messageSent } from '../feedback';
import { reportDenied } from '../permission-notice';
import { appendWaveformSample, type WaveformSample } from '../waveform-model';
import { colors, styles } from '../styles';
import { t } from '../i18n';
import { Icon, IconButton } from './ui';
import { VoiceNote } from './VoiceNote';
import { VideoNote } from './VideoNote';
import { CircleCapture, type CircleCaptureHandle } from './CircleCapture';

const VOICE_OPTIONS = { ...RecordingPresets.HIGH_QUALITY, bitRate: 64_000, numberOfChannels: 1, isMeteringEnabled: true, directory: 'cache' as const };
/** A touch shorter than this is a tap: it switches between voice and video circle, as in Telegram. */
const TAP_MS = 220;
/** Shorter recordings are dropped. */
const MIN_SECONDS = 0.6;
const CANCEL_DISTANCE = 110;
const LOCK_DISTANCE = 80;
const LEVEL_BARS = 28;
/** Voice or circle, remembered while the app runs. */
let lastKind: MediaKind = 'voice';

/**
 * hold: the finger is on the button; locked: recording hands-free; preview: stopped, check it
 * before sending. Like Telegram, everything happens in the message bar, not on a separate screen.
 */
type Phase = 'idle' | 'starting' | 'hold' | 'locked' | 'stopping' | 'preview' | 'sending';
type Recording = { uri: string; name: string; mime: string; kind: MediaKind };
export type RecordComposerHandle = { startLocked: (kind: MediaKind) => void };

export function RecordComposer({ ref, conversationId, disabled, trailing, above, children, onActiveChange, onError, onHint }: {
  ref?: Ref<RecordComposerHandle>;
  conversationId: string;
  /** A call is on, or the chat is not on screen: recording stops and the button is off. */
  disabled: boolean;
  /** The send button while text is typed; the record button shows only when it is absent. */
  trailing?: ReactNode;
  /** Everything above the message bar; a video circle is shown over it. */
  above: ReactNode;
  /** The attach button and the text field, replaced by the recording while it lasts. */
  children: ReactNode;
  onActiveChange: (active: boolean) => void;
  onError: (message: string) => void;
  onHint: (message: string) => void;
}) {
  const [phase, setPhaseState] = useState<Phase>('idle');
  const [kind, setKindState] = useState<MediaKind>(lastKind);
  const [seconds, setSeconds] = useState(0);
  const [recording, setRecording] = useState<Recording>();
  const [levels, setLevels] = useState<WaveformSample[]>([]);
  const [cameraOn, setCameraOn] = useState(false);
  const [switching, setSwitching] = useState(false);
  const phaseRef = useRef<Phase>('idle');
  const kindRef = useRef<MediaKind>(lastKind);
  const scope = useRef(createMediaScope());
  const attempt = useRef(0);
  const nonce = useRef('');
  const started = useRef(0);
  const released = useRef(false);
  const wantLocked = useRef(false);
  const stopThen = useRef<'send' | 'preview'>('send');
  const fileRef = useRef<Recording | undefined>(undefined);
  const rawUri = useRef<string | null>(null);
  const tapTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const touchFrom = useRef<Phase>('idle');
  const capture = useRef<CircleCaptureHandle>(null);
  const drag = useRef(new Animated.ValueXY()).current;
  const finished = useRef<(status: RecordingStatus) => void>(() => {});
  const cancel = useRef(() => {});
  const atLimit = useRef(() => {});
  const gesture = useRef({ onGrant() {}, onMove(_dx: number, _dy: number) {}, onRelease() {}, onTerminate() {} });
  const recorder = useAudioRecorder(VOICE_OPTIONS, status => finished.current(status));
  const props = useRef({ conversationId, disabled, onActiveChange, onError, onHint });
  useEffect(() => { props.current = { conversationId, disabled, onActiveChange, onError, onHint }; });

  const holdHint = (value: MediaKind) => value === 'voice' ? t('Hold to record a voice message, release to send. Tap to switch to video.') : t('Hold to record a video circle, release to send. Tap to switch to voice.');
  function setPhase(next: Phase) {
    const wasActive = phaseRef.current !== 'idle';
    phaseRef.current = next; setPhaseState(next);
    if (wasActive !== (next !== 'idle')) props.current.onActiveChange(next !== 'idle');
  }
  function setKind(next: MediaKind) { kindRef.current = next; lastKind = next; setKindState(next); }
  function allowed() {
    scope.current.assert();
    if (props.current.disabled || AppState.currentState !== 'active') throw new Error(t('Recording interrupted. Open it again after the call.'));
  }
  async function resetAudio() { await setAudioModeAsync({ allowsRecording: false, allowsBackgroundRecording: false, shouldPlayInBackground: false }).catch(() => {}); }
  function forget() {
    deleteMediaCache(rawUri.current); rawUri.current = null;
    deleteMediaCache(fileRef.current?.uri); fileRef.current = undefined; setRecording(undefined);
    setSeconds(0); setLevels([]); setSwitching(false); setCameraOn(false); drag.setValue({ x: 0, y: 0 });
  }

  /** Stops and drops everything except a recording already being sent. */
  const cancelNow = () => {
    const current = phaseRef.current;
    if (current === 'idle' || current === 'sending') return;
    scope.current.cancel(); attempt.current++;
    if (kindRef.current === 'voice' && current !== 'preview') {
      const abandoned = rawUri.current ?? recorder.uri;
      void recorder.stop().catch(() => {}).finally(() => { deleteMediaCache(abandoned); void resetAudio(); });
    }
    // Unmounting the camera stops a circle and deletes what it captured.
    forget(); setPhase('idle');
  };

  async function permissions(value: MediaKind, locked: boolean): Promise<boolean> {
    const needs: { read: () => Promise<{ granted: boolean; canAskAgain?: boolean }>; ask: () => Promise<{ granted: boolean }>; name: 'microphone' | 'camera' }[] = [
      { read: () => AudioModule.getRecordingPermissionsAsync(), ask: () => AudioModule.requestRecordingPermissionsAsync(), name: 'microphone' },
      ...(value === 'circle' ? [{ read: () => Camera.getCameraPermissionsAsync(), ask: () => Camera.requestCameraPermissionsAsync(), name: 'camera' as const }] : []),
    ];
    let asked = false;
    for (const need of needs) {
      const current = await need.read();
      if (current.granted) continue;
      if (current.canAskAgain === false) { reportDenied(need.name); return false; }
      asked = true;
      if (!(await need.ask()).granted) { reportDenied(need.name); return false; }
    }
    // The system dialog took the finger off the button: start again by holding.
    if (asked && !locked) { props.current.onHint(holdHint(value)); return false; }
    return true;
  }

  async function start(locked: boolean, value: MediaKind) {
    if (phaseRef.current !== 'idle' || props.current.disabled) return;
    const mine = ++attempt.current;
    scope.current = createMediaScope();
    nonce.current = Array.from(Crypto.getRandomBytes(16), byte => byte.toString(16).padStart(2, '0')).join('');
    released.current = false; wantLocked.current = locked;
    if (value !== kindRef.current) setKind(value);
    props.current.onError(''); props.current.onHint('');
    setPhase('starting');
    try {
      stopMediaPlayback(); pruneMediaCache();
      if (!(await permissions(value, locked))) { if (mine === attempt.current) setPhase('idle'); return; }
      allowed();
      if (value === 'circle') { setCameraOn(true); return; } // continues in cameraReady
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true, shouldPlayInBackground: false, allowsBackgroundRecording: false, interruptionMode: 'doNotMix' });
      allowed();
      await recorder.prepareToRecordAsync({ ...VOICE_OPTIONS, fileName: `lastcall-voice-${nonce.current}` });
      rawUri.current = recorder.uri;
      allowed();
      if (mine !== attempt.current) return;
      if (!wantLocked.current && released.current) { cancel.current(); props.current.onHint(holdHint('voice')); return; }
      started.current = Date.now(); setSeconds(0); setLevels([]);
      recorder.record({ forDuration: MEDIA_SECONDS.voice });
      setPhase(wantLocked.current ? 'locked' : 'hold'); haptic('longPress');
    } catch (cause) {
      if (mine !== attempt.current) return;
      if (value === 'voice') { try { await recorder.stop(); } catch { /* not started */ } await resetAudio(); }
      deleteMediaCache(rawUri.current); rawUri.current = null; setCameraOn(false);
      setPhase('idle'); props.current.onError(errorText(cause));
    }
  }
  function cameraReady() {
    if (phaseRef.current !== 'starting' || kindRef.current !== 'circle') return;
    try { allowed(); } catch (cause) { cancel.current(); props.current.onError(errorText(cause)); return; }
    if (!wantLocked.current && released.current) { cancel.current(); props.current.onHint(holdHint('circle')); return; }
    if (!capture.current?.record()) return;
    started.current = Date.now(); setSeconds(0);
    setPhase(wantLocked.current ? 'locked' : 'hold'); haptic('longPress');
  }

  /** Ends the recording and sends it or keeps it to check first; too short ones are dropped. */
  async function stop(then: 'send' | 'preview') {
    const from = phaseRef.current;
    if (from !== 'hold' && from !== 'locked') return;
    const duration = (Date.now() - started.current) / 1000;
    if (duration < MIN_SECONDS) { cancel.current(); if (from === 'hold') props.current.onHint(holdHint(kindRef.current)); return; }
    stopThen.current = then;
    setPhase('stopping');
    if (kindRef.current === 'circle') { capture.current?.stop(); return; } // continues in recorded
    const mine = attempt.current;
    try { await recorder.stop(); } catch { /* already stopped at the time limit */ }
    await resetAudio();
    if (mine !== attempt.current) return;
    await recorded(recorder.uri ?? rawUri.current, Math.min(MEDIA_SECONDS.voice, duration));
  }
  /** A finished recording, voice or circle: kept under its own name, then sent or shown. */
  async function recorded(uri: string | null, duration: number) {
    const value = kindRef.current;
    const mine = attempt.current;
    if (phaseRef.current === 'hold' || phaseRef.current === 'locked') stopThen.current = 'preview'; // the time limit
    try {
      if (!uri) throw new Error(t('Recording stopped by the system.'));
      scope.current.assert();
      const input = new File(uri);
      validateMedia(input.size, duration, value);
      const metadata = mediaMetadata(value, nonce.current, uri);
      const owned = new File(Paths.cache, metadata.name);
      await input.move(owned);
      rawUri.current = null;
      const next = { uri: owned.uri, ...metadata, kind: value };
      if (mine !== attempt.current) { deleteMediaCache(next.uri); return; }
      fileRef.current = next; setRecording(next); setCameraOn(false);
      if (stopThen.current === 'preview') { setPhase('preview'); haptic('press'); }
      else await send();
    } catch (cause) {
      deleteMediaCache(uri);
      if (mine !== attempt.current) return;
      forget(); setPhase('idle'); props.current.onError(errorText(cause));
    }
  }

  async function send() {
    const file = fileRef.current;
    if (!file) return;
    const current = client();
    setPhase('sending');
    try {
      stopMediaPlayback();
      await sendRecordedMedia(current, props.current.conversationId, file, scope.current);
      messageSent();
      deleteMediaCache(file.uri); fileRef.current = undefined; setRecording(undefined); setSeconds(0); setLevels([]);
      setPhase('idle');
    } catch (cause) {
      props.current.onError(errorText(cause));
      // Kept for another try.
      if (fileRef.current === file) { setRecording(file); setPhase('preview'); }
    }
  }

  // The voice time limit, the native end of recording and recorder errors.
  const finishedNow = (status: RecordingStatus) => {
    if (kindRef.current !== 'voice' || (phaseRef.current !== 'hold' && phaseRef.current !== 'locked')) return;
    if (status.hasError) { cancel.current(); props.current.onError(status.error || t('Recording stopped by the system.')); }
    else if (status.isFinished) void stop('preview');
  };

  // Hold to record, release to send, slide left to cancel, slide up to record hands-free; a tap switches voice and circle.
  const gestureNow = {
    onGrant() {
      const current = phaseRef.current;
      touchFrom.current = current;
      if (current !== 'idle') return;
      clearTimeout(tapTimer.current);
      tapTimer.current = setTimeout(() => { tapTimer.current = undefined; void start(false, kindRef.current); }, TAP_MS);
    },
    onMove(dx: number, dy: number) {
      const current = phaseRef.current;
      if (current !== 'hold' && current !== 'starting') return;
      const back = I18nManager.isRTL ? dx : -dx;
      drag.setValue({ x: I18nManager.isRTL ? Math.max(0, dx) : Math.min(0, dx), y: Math.min(0, dy) });
      if (back > CANCEL_DISTANCE) { haptic('reject'); cancel.current(); }
      else if (-dy > LOCK_DISTANCE) {
        if (current === 'starting') wantLocked.current = true;
        else { haptic('confirm'); drag.setValue({ x: 0, y: 0 }); setPhase('locked'); }
      }
    },
    onRelease() {
      const current = phaseRef.current;
      const from = touchFrom.current;
      touchFrom.current = 'idle';
      drag.setValue({ x: 0, y: 0 });
      if (tapTimer.current) {
        clearTimeout(tapTimer.current); tapTimer.current = undefined;
        const next = kindRef.current === 'voice' ? 'circle' : 'voice';
        setKind(next); haptic('tick'); props.current.onHint(holdHint(next));
        return;
      }
      if (current === 'starting') released.current = true;
      else if (current === 'hold') void stop('send');
      // Lifting the finger after sliding up keeps recording; a later tap on the button sends.
      else if (current === 'locked' && from === 'locked') void stop('send');
      else if (current === 'preview' && from === 'preview') void send();
    },
    // Taken away by the system: a recording in progress keeps going hands-free.
    onTerminate() {
      drag.setValue({ x: 0, y: 0 });
      if (tapTimer.current) { clearTimeout(tapTimer.current); tapTimer.current = undefined; return; }
      if (phaseRef.current === 'hold') setPhase('locked'); else if (phaseRef.current === 'starting') wantLocked.current = true;
    },
  };
  useEffect(() => { cancel.current = cancelNow; finished.current = finishedNow; gesture.current = gestureNow; atLimit.current = () => void stop('preview'); });
  useEffect(() => {
    if (phase !== 'hold' && phase !== 'locked') return;
    const timer = setInterval(() => {
      const elapsed = (Date.now() - started.current) / 1000;
      setSeconds(elapsed);
      if (kindRef.current !== 'voice') return; // the camera ends a circle at its limit itself
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
    return () => { listener.remove(); clearTimeout(tapTimer.current); cancel.current(); };
  }, []);
  useEffect(() => { if (disabled) cancel.current(); }, [disabled]);
  useImperativeHandle(ref, () => ({ startLocked: value => void start(true, value) }));
  const [responder] = useState(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: () => gesture.current.onGrant(),
    onPanResponderMove: (_, state) => gesture.current.onMove(state.dx, state.dy),
    onPanResponderRelease: () => gesture.current.onRelease(),
    onPanResponderTerminate: () => gesture.current.onTerminate(),
  }));

  const circle = kind === 'circle';
  const recordingNow = phase === 'hold' || phase === 'starting' || phase === 'locked' || phase === 'stopping';
  const showTrailing = !!trailing && phase === 'idle';
  const recordMode = phase === 'idle' || phase === 'starting' || phase === 'hold';
  const recordIcon = circle ? 'videocam-outline' : 'mic-outline';
  const timer = <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
    <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: '#D93A3A', opacity: Math.floor(seconds * 2) % 2 ? 0.35 : 1 }} />
    <Text style={{ color: colors.text, fontSize: 16, fontVariant: ['tabular-nums'] }}>{mediaTime(seconds)}{circle ? ` / ${mediaTime(MEDIA_SECONDS.circle)}` : ''}</Text>
  </View>;
  const flip = circle && (Platform.OS === 'android' ? phase === 'locked' : false)
    ? <IconButton name="camera-reverse-outline" label={t('Switch camera')} disabled={switching} onPress={() => { capture.current?.flip(); }} /> : null;
  let body: ReactNode = null;
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
      {circle ? <View style={{ flex: 1 }} /> : <View accessible={false} style={{ flex: 1, height: 28, marginHorizontal: 6, flexDirection: 'row', alignItems: 'center', gap: 2 }}>
        {[...Array<WaveformSample>(Math.max(0, LEVEL_BARS - levels.length)).fill(null), ...levels].map((level, index) => <View key={index} style={{ flex: 1, maxWidth: 3, height: 3 + (level ?? 0) * 24, borderRadius: 2, backgroundColor: level === null ? '#C5D9D2' : colors.accent }} />)}
      </View>}
      {flip}
      <IconButton name="stop-circle-outline" color="#D93A3A" label={circle ? t('Stop and watch') : t('Stop and listen')} disabled={phase !== 'locked' || switching} onPress={() => void stop('preview')} />
    </View>;
  } else if ((phase === 'preview' || phase === 'sending') && recording) {
    body = <View style={{ flex: 1, minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 4 }}>
      <IconButton name="trash-outline" color={colors.danger} label={t('Delete recording')} disabled={phase === 'sending'} onPress={() => cancel.current()} />
      {recording.kind === 'voice' ? <View style={{ flex: 1, alignItems: 'flex-start' }}><VoiceNote uri={recording.uri} /></View>
        : <Text style={[styles.info, { flex: 1, paddingHorizontal: 6 }]}>{t('Video circle')}</Text>}
    </View>;
  }

  // A circle is shown over the chat while it is recorded and checked.
  const overlay = circle && (cameraOn || ((phase === 'preview' || phase === 'sending') && recording?.kind === 'circle'))
    ? <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(237, 245, 241, 0.92)' }}>
      {cameraOn ? <CircleCapture ref={capture} nonce={nonce.current} onReady={cameraReady} onSwitching={setSwitching}
        onFinished={(uri, duration) => void recorded(uri, duration)}
        onFailed={message => { cancel.current(); props.current.onError(message); }} />
        : recording ? <VideoNote uri={recording.uri} autoPlay /> : null}
    </View> : null;

  return <View style={{ flex: 1 }}>
    <View style={{ flex: 1 }}>{above}{overlay}</View>
    <View style={styles.composer}>
      {/* The text field stays mounted and focused under the recording, so the keyboard does not
          close and the bar does not jump while recording, as in Telegram. */}
      {/* collapsable={false}: a flattened wrapper would be re-created natively when its style changes,
          taking focus from the field and closing the keyboard. */}
      <View collapsable={false} style={{ flex: 1, flexDirection: 'row', alignItems: 'flex-end' }}>
        <View collapsable={false} importantForAccessibility={body ? 'no-hide-descendants' : 'auto'} pointerEvents={body ? 'none' : 'auto'}
          style={[{ flex: 1, flexDirection: 'row', alignItems: 'flex-end', gap: 6 }, !!body && { position: 'absolute', left: 0, right: 0, bottom: 0, opacity: 0 }]}>{children}</View>
        {body}
      </View>
      {showTrailing ? trailing : <View>
        {phase === 'hold' && <Animated.View pointerEvents="none" style={{ position: 'absolute', bottom: 62, alignSelf: 'center', alignItems: 'center', paddingVertical: 8, paddingHorizontal: 9, borderRadius: 20, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line, transform: [{ translateY: drag.y.interpolate({ inputRange: [-LOCK_DISTANCE, 0], outputRange: [-24, 0], extrapolate: 'clamp' }) }] }}>
          <Icon name="lock-open-outline" size={20} color={colors.secondary} /><Icon name="chevron-up" size={16} color={colors.secondary} />
        </Animated.View>}
        <Animated.View {...responder.panHandlers}
          accessible accessibilityRole="button"
          accessibilityLabel={recordMode ? (circle ? t('Record video circle') : t('Record voice message')) : (circle ? t('Send video circle') : t('Send voice message'))}
          accessibilityHint={recordMode ? holdHint(kind) : undefined}
          accessibilityState={{ disabled: disabled || phase === 'sending' || phase === 'stopping' }}
          accessibilityActions={[{ name: 'activate' }, { name: 'longpress' }]}
          onAccessibilityAction={event => {
            const current = phaseRef.current;
            // A screen reader cannot hold: double tap records hands-free, double tap and hold switches.
            if (event.nativeEvent.actionName === 'longpress') { if (current === 'idle') { const next = kindRef.current === 'voice' ? 'circle' : 'voice'; setKind(next); props.current.onHint(holdHint(next)); } return; }
            if (current === 'idle') void start(true, kindRef.current); else if (current === 'locked') void stop('send'); else if (current === 'preview') void send();
          }}
          pointerEvents={disabled || phase === 'sending' || phase === 'stopping' ? 'none' : 'auto'}
          style={[{ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
            recordMode && !recordingNow ? null : { backgroundColor: colors.accent },
            (disabled || phase === 'sending') && styles.disabled,
            { transform: [{ translateX: drag.x }, { scale: phase === 'hold' || phase === 'starting' ? 1.35 : 1 }] }]}>
          <Icon name={recordMode ? recordIcon : 'arrow-up'} size={recordMode && !recordingNow ? 27 : 25} color={recordMode && !recordingNow ? undefined : colors.white} />
        </Animated.View>
      </View>}
    </View>
  </View>;
}
