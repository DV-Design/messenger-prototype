import { useState } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { RTCView, type MediaStream as NativeMediaStream } from 'react-native-webrtc';
import { client, errorText, useMessenger } from '../runtime';
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
  const callState = call?.session.callState;
  if (!call || callState === 'idle') return null;
  const contact = snapshot.contacts.find(item => item.userId === call.peerId);
  const conversation = snapshot.conversations.find(item => item.id === call.conversationId);
  const name = contact?.displayName ?? conversation?.title ?? 'Собеседник';
  const status = callState === 'incoming' ? 'Входящий вызов' : callState === 'outgoing' ? 'Вызов…' : 'Разговор';
  const local = call.session.localStream;
  const remote = call.session.remoteStream;
  async function accept() {
    setBusy(true); setError('');
    try { await client().acceptCall(); } catch (cause) { setError(errorText(cause)); }
    finally { setBusy(false); }
  }
  return <>
    {collapsed && <Pressable style={[styles.callBanner, { top: insets.top + 4 }]} onPress={() => setCollapsed(false)} accessibilityRole="button" accessibilityLabel="Вернуться к звонку">
      <Icon name="call" color={colors.white} size={19} /><Text style={styles.callBannerText}>{name} · {status.toLowerCase()}</Text><Icon name="chevron-forward" color={colors.white} size={19} /></Pressable>}
    <Modal visible={!collapsed} animationType="slide" statusBarTranslucent onRequestClose={() => setCollapsed(true)}>
      <SafeAreaView style={styles.callScreen}>
        <View style={{ position: 'absolute', right: 15, top: insets.top + 10 }}><IconButton name="chevron-down" label="Свернуть звонок" color={colors.white} onPress={() => setCollapsed(true)} /></View>
        <Avatar name={name} id={call.peerId} size={94} /><Text style={styles.callName}>{name}</Text><Text style={styles.callSubtitle}>{status}</Text>
        {!!remote?.getVideoTracks().length && <View style={styles.video}><RTCView style={styles.flex} objectFit="cover" streamURL={(remote as unknown as NativeMediaStream).toURL()} />
          {!!local?.getVideoTracks().length && <View style={styles.localVideo}><RTCView style={styles.flex} objectFit="cover" mirror streamURL={(local as unknown as NativeMediaStream).toURL()} /></View>}</View>}
        {!remote?.getVideoTracks().length && !!local?.getVideoTracks().length && <View style={styles.video}><RTCView style={styles.flex} objectFit="cover" mirror streamURL={(local as unknown as NativeMediaStream).toURL()} /></View>}
        {!!error && <Text style={styles.error}>{error}</Text>}
        <View style={styles.callControls}>
          {callState === 'incoming' ? <>
            <Pressable accessibilityRole="button" accessibilityLabel="Отклонить вызов" style={styles.callControl} onPress={() => client().rejectCall()}><View style={[styles.callCircle, { backgroundColor: colors.danger }]}><Icon name="call" color={colors.white} size={28} /></View><Text style={styles.callControlLabel}>Отклонить</Text></Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="Принять вызов" disabled={busy} style={[styles.callControl, busy && styles.disabled]} onPress={() => void accept()}><View style={[styles.callCircle, { backgroundColor: colors.accent }]}><Icon name="call" color={colors.white} size={28} /></View><Text style={styles.callControlLabel}>{busy ? 'Подключаем…' : 'Принять'}</Text></Pressable>
          </> : <>
            <Pressable accessibilityRole="button" accessibilityLabel={call.session.muted ? 'Включить микрофон' : 'Выключить микрофон'} style={styles.callControl} onPress={() => client().setMuted(!call.session.muted)}><View style={styles.callCircle}><Icon name={call.session.muted ? 'mic-off' : 'mic'} color={colors.white} size={28} /></View><Text style={styles.callControlLabel}>{call.session.muted ? 'Включить' : 'Микрофон'}</Text></Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="Завершить звонок" style={styles.callControl} onPress={() => client().endCall()}><View style={[styles.callCircle, { backgroundColor: colors.danger }]}><Icon name="call" color={colors.white} size={28} /></View><Text style={styles.callControlLabel}>Завершить</Text></Pressable>
          </>}
        </View>
      </SafeAreaView>
    </Modal>
  </>;
}
