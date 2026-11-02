import { useEffect, useRef, useState } from 'react';
import { BackHandler, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { RTCView, type MediaStream as NativeMediaStream } from 'react-native-webrtc';
import { callSafetyEmoji } from '@messenger/core';
import { client, errorText, useMessenger } from '../runtime';
import { answerCurrentSystemCall } from '../system-calls';
import { useCallAudioRoutes } from '../call-audio';
import { audioRouteLabel } from '../call-audio-model';
import { useCallCamera } from '../call-camera';
import type { CallCameraTrack } from '../call-camera-model';
import { nativeCallPip, useCallPip } from '../call-pip';
import { ownsLiveCall } from '../call-pip-model';
import { VideoControlsController } from '../video-controls-model';
import { colors, styles } from '../styles';
import { Avatar, Icon, IconButton } from './ui';

export function CallOverlay() {
  const { snapshot } = useMessenger();
  const call = snapshot.activeCall;
  if (!call || call.session.callState === 'idle') return null;
  // Stable for the whole call: callState changes must not remount video/PiP ownership.
  return <CallPanel key={call.session.callId ?? call.conversationId} />;
}

function CallPanel() {
  const { snapshot, identity } = useMessenger();
  const call = snapshot.activeCall;
  const [collapsed, setCollapsed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [audioMenu, setAudioMenu] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [controls] = useState(() => new VideoControlsController(setControlsVisible));
  const audio = useCallAudioRoutes(call?.session.callId);
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const callId = call?.session.callId;
  const callState = call?.session.callState;

  const local = call?.session.localStream;
  const remote = call?.session.remoteStream;
  const remoteVideo = !!remote?.getVideoTracks().some(track => track.readyState !== 'ended');
  const localVideo = !!local?.getVideoTracks().some(track => track.readyState !== 'ended');
  // Show the local camera as the main stage only while an outgoing call waits
  // for the peer. An incoming/active call without a remote video track must
  // never display the phone's own camera as if it were the peer's video.
  const outgoingPreview = callState === 'outgoing' && !remoteVideo && localVideo;
  const video = remoteVideo || outgoingPreview;
  const activeVideo = callState === 'active' && remoteVideo;
  const localTrack = local?.getVideoTracks().find(track => track.readyState === 'live');
  const camera = useCallCamera(callId, localTrack as unknown as CallCameraTrack | undefined);
  const pip = useCallPip({
    callId,
    enabled: activeVideo && !collapsed,
    width,
    height,
    // Read the LIVE client snapshot: React state can lag behind a native close.
    onClose: () => {
      const liveCallId = client().getSnapshot().activeCall?.session.callId;
      if (ownsLiveCall(liveCallId, callId)) {
        nativeCallPip()?.clear(callId);
        client().endCall();
      }
    },
  });
  const pipActive = pip.snapshot.active || pip.snapshot.transitioning;
  const shownError = error || pip.error || camera.state.error;

  const menuVisible = audioMenu && !pipActive;
  useEffect(() => {
    controls.configure(activeVideo, pipActive, menuVisible);
  }, [activeVideo, pipActive, menuVisible, controls]);
  useEffect(() => () => controls.dispose(), [controls]);

  async function minimize() {
    setAudioMenu(false);
    if (Platform.OS === 'android' && activeVideo) {
      if (await pip.minimize()) return;
    }
    setCollapsed(true);
  }
  const minimizeRef = useRef(minimize);
  useEffect(() => { minimizeRef.current = minimize; });
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (collapsed) setCollapsed(false);
      else void minimizeRef.current();
      return true;
    });
    return () => subscription.remove();
  }, [collapsed]);

  if (!call || callState === 'idle') return null;
  const contact = snapshot.contacts.find(item => item.userId === call.peerId);
  const conversation = snapshot.conversations.find(item => item.id === call.conversationId);
  const name = contact?.displayName ?? conversation?.title ?? 'Собеседник';
  const status = callState === 'incoming' ? (call.session.callVideo ? 'Входящий видеозвонок' : 'Входящий вызов') : callState === 'outgoing' ? 'Вызов…' : 'Разговор';
  const safetyCode = identity && contact && callId ? callSafetyEmoji(identity.publicKey, contact.publicKey, callId) : '';
  const landscape = width > height;
  const selectedAudio = audio.routes.find(route => route.selected);
  const audioIcon = selectedAudio?.kind === 'bluetooth' ? 'bluetooth' : selectedAudio?.kind === 'earpiece' ? 'ear' : selectedAudio?.kind === 'wired' ? 'headset' : 'volume-high';
  const frontCamera = camera.state.facing !== 'environment';
  const finish = () => {
    controls.interact();
    if (callId) nativeCallPip()?.clear(callId);
    client().endCall();
  };
  async function accept() {
    setBusy(true); setError('');
    try { if (!(await answerCurrentSystemCall())) await client().acceptCall(); } catch (cause) { setError(errorText(cause)); }
    finally { setBusy(false); }
  }
  const controlsStrip = <View style={styles.callControls}>
          {callState === 'incoming' ? <>
            <Pressable accessibilityRole="button" accessibilityLabel="Отклонить вызов" style={styles.callControl} onPress={() => { controls.interact(); client().rejectCall(); }}><View style={[styles.callCircle, { backgroundColor: colors.danger }]}><Icon name="call" color={colors.white} size={28} /></View><Text style={styles.callControlLabel}>Отклонить</Text></Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="Принять вызов" disabled={busy} style={[styles.callControl, busy && styles.disabled]} onPress={() => void accept()}><View style={[styles.callCircle, { backgroundColor: colors.accent }]}><Icon name="call" color={colors.white} size={28} /></View><Text style={styles.callControlLabel}>{busy ? 'Подключаем…' : 'Принять'}</Text></Pressable>
          </> : <>
            <Pressable accessibilityRole="button" accessibilityLabel={call.session.muted ? 'Включить микрофон' : 'Выключить микрофон'} style={styles.callControl} onPress={() => { controls.interact(); client().setMuted(!call.session.muted); }}><View style={styles.callCircle}><Icon name={call.session.muted ? 'mic-off' : 'mic'} color={colors.white} size={28} /></View><Text style={styles.callControlLabel}>{call.session.muted ? 'Включить' : 'Микрофон'}</Text></Pressable>
            {activeVideo && camera.state.available && <Pressable accessibilityRole="button" accessibilityLabel="Переключить камеру" disabled={camera.state.busy} style={[styles.callControl, camera.state.busy && styles.disabled]} onPress={() => { controls.interact(); void camera.switchCamera(); }}><View style={styles.callCircle}><Icon name="camera-reverse" color={colors.white} size={28} /></View><Text style={styles.callControlLabel}>{frontCamera ? 'Задняя' : 'Передняя'}</Text></Pressable>}
            {audio.supported && <Pressable accessibilityRole="button" accessibilityLabel={`Выбрать звук: ${selectedAudio ? audioRouteLabel[selectedAudio.kind] : 'подключаем'}`} accessibilityState={{ disabled: !audio.active || !audio.routes.length }} disabled={!audio.active || !audio.routes.length} style={[styles.callControl, (!audio.active || !audio.routes.length) && styles.disabled]} onPress={() => { controls.interact(); setAudioMenu(true); }}><View style={styles.callCircle}><Icon name={audioIcon} color={colors.white} size={28} /></View><Text style={styles.callControlLabel}>Звук</Text></Pressable>}
            <Pressable accessibilityRole="button" accessibilityLabel="Завершить звонок" style={styles.callControl} onPress={finish}><View style={[styles.callCircle, { backgroundColor: colors.danger }]}><Icon name="call" color={colors.white} size={28} /></View><Text style={styles.callControlLabel}>Завершить</Text></Pressable>
          </>}
        </View>;
  const notice = shownError || (camera.state.busy ? 'Переключаем камеру…' : '');
  const banner = collapsed && <Pressable style={[styles.callBanner, { top: insets.top + 4 }]} onPress={() => setCollapsed(false)} accessibilityRole="button" accessibilityLabel="Вернуться к звонку">
      <Icon name="call" color={colors.white} size={19} /><Text style={styles.callBannerText}>{name} · {shownError || status.toLowerCase()}</Text><Icon name="chevron-forward" color={colors.white} size={19} /></Pressable>;
  const panel = <View style={{ flex: 1 }}>
      {video ? <Pressable style={styles.callVideoStage} onPress={() => controls.tap()} accessibilityRole="none">
        <RTCView style={styles.callVideoFill} objectFit="cover" zOrder={0} mirror={!remoteVideo && frontCamera} pointerEvents="none" streamURL={((remoteVideo ? remote : local) as unknown as NativeMediaStream).toURL()} />
        {remoteVideo && localVideo && !pipActive && <View pointerEvents="none" style={[styles.callVideoPip, { top: insets.top + (landscape ? 72 : 100), right: insets.right + 16, width: landscape ? 84 : 108, height: landscape ? 116 : 152 }]}>
          <RTCView style={styles.flex} objectFit="cover" zOrder={1} mirror={frontCamera} streamURL={(local as unknown as NativeMediaStream).toURL()} />
        </View>}
        {/* Removed from the tree, not merely transparent, while hidden or in PiP. */}
        {!pipActive && controlsVisible && <>
          <View style={[styles.callVideoHeader, { paddingTop: insets.top + 12, paddingLeft: insets.left + 20, paddingRight: insets.right + 12 }]}>
            <View style={styles.callVideoHeading}><Text numberOfLines={1} style={styles.callVideoName}>{name}</Text><Text style={styles.callSubtitle}>{status}</Text>{!!safetyCode && <Text style={[styles.callSubtitle, { fontSize: 22 }]}>Код сверки: {safetyCode}</Text>}</View>
            <IconButton name="chevron-down" label="Свернуть звонок" color={colors.white} onPress={() => { controls.interact(); void minimize(); }} />
          </View>
          <View style={[styles.callVideoFooter, { paddingBottom: insets.bottom + 16, paddingLeft: insets.left + 16, paddingRight: insets.right + 16 }]}>
            {!!notice && <Text style={styles.error}>{notice}</Text>}{controlsStrip}
          </View>
        </>}
      </Pressable> : <SafeAreaView style={styles.callScreen}>
        <View style={{ position: 'absolute', right: 15, top: insets.top + 10 }}><IconButton name="chevron-down" label="Свернуть звонок" color={colors.white} onPress={() => void minimize()} /></View>
        <Avatar name={name} id={call.peerId} size={94} /><Text style={styles.callName}>{name}</Text><Text style={styles.callSubtitle}>{status}</Text>{!!safetyCode && <Text style={[styles.callSubtitle, { fontSize: 22 }]}>Код сверки: {safetyCode}</Text>}
        {!!notice && <Text style={styles.error}>{notice}</Text>}{controlsStrip}
      </SafeAreaView>}
      {menuVisible && <View style={StyleSheet.absoluteFill}>
        <Pressable style={StyleSheet.absoluteFill} accessibilityRole="button" accessibilityLabel="Закрыть выбор звука" onPress={() => setAudioMenu(false)} />
        <View style={{ position: 'absolute', left: insets.left + 20, right: insets.right + 20, bottom: insets.bottom + 110, maxHeight: Math.max(120, height - insets.top - insets.bottom - 135), backgroundColor: '#252332', borderRadius: 20, padding: 16 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}><Text style={{ color: colors.white, fontSize: 18, fontWeight: '600' }}>Звук звонка</Text><IconButton name="close" label="Закрыть выбор звука" color={colors.white} onPress={() => setAudioMenu(false)} /></View>
          <ScrollView>
            {audio.routes.map(route => <Pressable key={route.id} accessibilityRole="radio" accessibilityLabel={audioRouteLabel[route.kind]} accessibilityState={{ selected: route.selected, disabled: !!audio.pendingId }} disabled={!!audio.pendingId} onPress={() => void audio.select(route.id)} style={{ minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 12, opacity: audio.pendingId && audio.pendingId !== route.id ? 0.5 : 1 }}>
              <Icon name={route.selected ? 'radio-button-on' : 'radio-button-off'} color={colors.white} size={23} /><Text style={{ color: colors.white, flex: 1 }}>{audioRouteLabel[route.kind]}{audio.pendingId === route.id ? ' · подключаем…' : ''}</Text>
            </Pressable>)}
          </ScrollView>
          {!!audio.error && <Text accessibilityRole="alert" style={[styles.error, { marginTop: 8 }]}>{audio.error}</Text>}
        </View>
      </View>}
    </View>;
  // Android video must live in MainActivity's absolute view tree, never inside an RN Modal,
  // or the native PiP window has no video surface. The panel stays mounted while collapsed.
  if (Platform.OS === 'android' && call.session.callVideo) {
    return <>
      {banner}
      <View pointerEvents={collapsed ? 'none' : 'auto'} style={[{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, zIndex: 10000, elevation: 10000, backgroundColor: '#000' }, collapsed && { display: 'none' }]}>
        {panel}
      </View>
    </>;
  }
  return <>
    {banner}
    <Modal visible={!collapsed} animationType="slide" presentationStyle="fullScreen" supportedOrientations={['portrait', 'landscape']} statusBarTranslucent navigationBarTranslucent onRequestClose={() => void minimize()}>
      {panel}
    </Modal>
  </>;
}
