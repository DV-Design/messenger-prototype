import { useState } from 'react';
import { Modal, Pressable, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { RTCView, type MediaStream as NativeMediaStream } from 'react-native-webrtc';
import { client, errorText, useMessenger } from '../runtime';
import { answerCurrentSystemCall } from '../system-calls';
import { colors, styles } from '../styles';
import { Avatar, Icon, IconButton } from './ui';

export function CallOverlay() {
  const { snapshot } = useMessenger();
  const call = snapshot.activeCall;
  if (!call || call.session.callState === 'idle') return null;
  return <CallPanel key={`${call.conversationId}:${call.session.callState}`} />;
}
function CallPanel() {
  const { snapshot } = useMessenger();
  const call = snapshot.activeCall;
  const [collapsed, setCollapsed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const callState = call?.session.callState;
  if (!call || callState === 'idle') return null;
  const contact = snapshot.contacts.find(item => item.userId === call.peerId);
  const conversation = snapshot.conversations.find(item => item.id === call.conversationId);
  const name = contact?.displayName ?? conversation?.title ?? 'Собеседник';
  const status = callState === 'incoming' ? (call.session.callVideo ? 'Входящий видеозвонок' : 'Входящий вызов') : callState === 'outgoing' ? 'Вызов…' : 'Разговор';
  const local = call.session.localStream;
  const remote = call.session.remoteStream;
  const remoteVideo = !!remote?.getVideoTracks().some(track => track.readyState !== 'ended');
  const localVideo = !!local?.getVideoTracks().some(track => track.readyState !== 'ended');
  const video = remoteVideo || localVideo;
  const landscape = width > height;
  async function accept() {
    setBusy(true); setError('');
    try { if (!(await answerCurrentSystemCall())) await client().acceptCall(); } catch (cause) { setError(errorText(cause)); }
    finally { setBusy(false); }
  }
  const controls = <View style={styles.callControls}>
          {callState === 'incoming' ? <>
            <Pressable accessibilityRole="button" accessibilityLabel="Отклонить вызов" style={styles.callControl} onPress={() => client().rejectCall()}><View style={[styles.callCircle, { backgroundColor: colors.danger }]}><Icon name="call" color={colors.white} size={28} /></View><Text style={styles.callControlLabel}>Отклонить</Text></Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="Принять вызов" disabled={busy} style={[styles.callControl, busy && styles.disabled]} onPress={() => void accept()}><View style={[styles.callCircle, { backgroundColor: colors.accent }]}><Icon name="call" color={colors.white} size={28} /></View><Text style={styles.callControlLabel}>{busy ? 'Подключаем…' : 'Принять'}</Text></Pressable>
          </> : <>
            <Pressable accessibilityRole="button" accessibilityLabel={call.session.muted ? 'Включить микрофон' : 'Выключить микрофон'} style={styles.callControl} onPress={() => client().setMuted(!call.session.muted)}><View style={styles.callCircle}><Icon name={call.session.muted ? 'mic-off' : 'mic'} color={colors.white} size={28} /></View><Text style={styles.callControlLabel}>{call.session.muted ? 'Включить' : 'Микрофон'}</Text></Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="Завершить звонок" style={styles.callControl} onPress={() => client().endCall()}><View style={[styles.callCircle, { backgroundColor: colors.danger }]}><Icon name="call" color={colors.white} size={28} /></View><Text style={styles.callControlLabel}>Завершить</Text></Pressable>
          </>}
        </View>;
  return <>
    {collapsed && <Pressable style={[styles.callBanner, { top: insets.top + 4 }]} onPress={() => setCollapsed(false)} accessibilityRole="button" accessibilityLabel="Вернуться к звонку">
      <Icon name="call" color={colors.white} size={19} /><Text style={styles.callBannerText}>{name} · {status.toLowerCase()}</Text><Icon name="chevron-forward" color={colors.white} size={19} /></Pressable>}
    <Modal visible={!collapsed} animationType="slide" presentationStyle="fullScreen" supportedOrientations={['portrait', 'landscape']} statusBarTranslucent navigationBarTranslucent onRequestClose={() => setCollapsed(true)}>
      {video ? <View style={styles.callVideoStage}>
        <RTCView style={styles.callVideoFill} objectFit="cover" zOrder={0} mirror={!remoteVideo} pointerEvents="none" streamURL={((remoteVideo ? remote : local) as unknown as NativeMediaStream).toURL()} />
        {remoteVideo && localVideo && <View pointerEvents="none" style={[styles.callVideoPip, { top: insets.top + (landscape ? 72 : 100), right: insets.right + 16, width: landscape ? 84 : 108, height: landscape ? 116 : 152 }]}>
          <RTCView style={styles.flex} objectFit="cover" zOrder={1} mirror streamURL={(local as unknown as NativeMediaStream).toURL()} />
        </View>}
        <View style={[styles.callVideoHeader, { paddingTop: insets.top + 12, paddingLeft: insets.left + 20, paddingRight: insets.right + 12 }]}>
          <View style={styles.callVideoHeading}><Text numberOfLines={1} style={styles.callVideoName}>{name}</Text><Text style={styles.callSubtitle}>{status}</Text></View>
          <IconButton name="chevron-down" label="Свернуть звонок" color={colors.white} onPress={() => setCollapsed(true)} />
        </View>
        <View style={[styles.callVideoFooter, { paddingBottom: insets.bottom + 16, paddingLeft: insets.left + 16, paddingRight: insets.right + 16 }]}>
          {!!error && <Text style={styles.error}>{error}</Text>}{controls}
        </View>
      </View> : <SafeAreaView style={styles.callScreen}>
        <View style={{ position: 'absolute', right: 15, top: insets.top + 10 }}><IconButton name="chevron-down" label="Свернуть звонок" color={colors.white} onPress={() => setCollapsed(true)} /></View>
        <Avatar name={name} id={call.peerId} size={94} /><Text style={styles.callName}>{name}</Text><Text style={styles.callSubtitle}>{status}</Text>
        {!!error && <Text style={styles.error}>{error}</Text>}{controls}
      </SafeAreaView>}
    </Modal>
  </>;
}
