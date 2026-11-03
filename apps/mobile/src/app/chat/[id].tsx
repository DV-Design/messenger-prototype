import { useEffect, useRef, useState, type ComponentRef } from 'react';
import { Redirect, router, useIsFocused, useLocalSearchParams } from 'expo-router';
import { AppState, FlatList, KeyboardAvoidingView, Platform, Pressable, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { safetyEmoji, type MessengerMessage } from '@messenger/core';
import { t } from '../../i18n';
import { pickDocument, pickMedia, shareFile } from '../../attachments';
import { AttachmentCard } from '../../components/AttachmentCard';
import { SafetyCode } from '../../components/SafetyCode';
import { SafetyMenu } from '../../components/SafetyMenu';
import { Avatar, Empty, Icon, IconButton, lastSeen, time } from '../../components/ui';
import { client, errorText, useMessenger } from '../../runtime';
import { colors, styles } from '../../styles';
import { transportNotice } from '../../transport-notice';
import { canMarkRead, deliveryIcon, deliveryLabel, deliveryStage, readContentVersion, waitingForDelivery } from '../../delivery-model';
import { MediaComposer } from '../../components/MediaComposer';
import type { MediaKind } from '../../media-model';
import { chatTimeline, type ChatTimelineEntry } from '../../timeline-model';

export default function Chat() {
  const params = useLocalSearchParams<{ id: string }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  const { snapshot, identity, profile } = useMessenger();
  const conversation = snapshot.conversations.find(item => item.id === id);
  const [draft, setDraft] = useState('');
  const [attachments, setAttachments] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [recording, setRecording] = useState<MediaKind>();
  const [safetyOpen, setSafetyOpen] = useState(false);
  const [safetyMenuOpen, setSafetyMenuOpen] = useState(false);
  const list = useRef<ComponentRef<typeof FlatList<ChatTimelineEntry>>>(null);
  const unread = conversation?.unread ?? 0;
  const focused = useIsFocused();
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  const [interacting, setInteracting] = useState(true);
  useEffect(() => {
    const change = AppState.addEventListener('change', state => setForeground(state === 'active'));
    const blur = AppState.addEventListener('blur', () => setInteracting(false));
    const focus = AppState.addEventListener('focus', () => setInteracting(true));
    return () => { change.remove(); blur.remove(); focus.remove(); };
  }, []);
  const contentVersion = readContentVersion(conversation?.messages ?? [], conversation?.files ?? []);
  useEffect(() => {
    if (id && canMarkRead(focused, foreground ? 'active' : 'background', interacting)) {
      void client().markRead(id).catch(cause => setError(errorText(cause)));
    }
  }, [focused, foreground, interacting, id, unread, contentVersion]);
  if (!profile) return <Redirect href="/onboarding" />;
  if (!conversation) return <SafeAreaView style={styles.whiteScreen}><View style={styles.chatHeader}><IconButton name="chevron-back" label={t('Back')} onPress={() => router.back()} /></View><Empty icon="chatbubble-outline" title={t('Chat not found')} text={t('It may belong to another server. Return to the chat list.')} /></SafeAreaView>;
  const blocked = new Set(snapshot.blockedContacts);
  const timeline = chatTimeline(conversation.messages.filter(item => !blocked.has(item.from)), conversation.files.filter(item => !blocked.has(item.senderId)));
  const peer = snapshot.contacts.find(item => conversation.memberIds.includes(item.userId) && item.userId !== identity?.userId);
  const group = conversation.kind === 'group';
  const blockedPeer = !group && !!peer && blocked.has(peer.userId);
  const hiddenBlocked = group && conversation.memberIds.some(id => id !== identity?.userId && blocked.has(id));
  const groupMembers = group ? conversation.memberIds.filter(id => id !== identity?.userId).map(id => ({ userId: id, displayName: snapshot.contacts.find(contact => contact.userId === id)?.displayName ?? t('Member') })) : [];
  const safety = peer && identity ? safetyEmoji(identity.publicKey, peer.publicKey) : '';
  const peerVerified = !!peer && snapshot.verifiedContacts.includes(peer.userId);
  const canCall = !group && !blockedPeer && !snapshot.activeCall && !recording && (snapshot.status === 'online' || conversation.session?.status === 'connected');
  const notice = transportNotice({ directory: snapshot.status, group, peerOnline: peer?.online, session: conversation.session,
    pending: conversation.messages.filter(item => item.from === identity?.userId && waitingForDelivery(item)).length
      + conversation.files.filter(item => item.senderId === identity?.userId && waitingForDelivery(item)).length });
  async function action(operation: () => Promise<void>) {
    if (busy) return;
    setBusy(true); setError('');
    try { await operation(); } catch (cause) { setError(errorText(cause)); } finally { setBusy(false); }
  }
  function send() {
    const text = draft;
    void action(async () => { await client().sendText(conversation!.id, text); setDraft(''); });
  }
  function attach(kind: 'media' | 'document') {
    // The manager establishes recipient sessions on demand, including group
    // members without a separate DM. Chat-list rows are not transport state.
    setAttachments(false);
    void action(() => kind === 'media' ? pickMedia(conversation!.id) : pickDocument(conversation!.id));
  }
  function record(kind: MediaKind) { if (busy || snapshot.activeCall) return; setAttachments(false); setRecording(kind); }
  function renderMessage(item: MessengerMessage) {
    const own = item.from === identity?.userId;
    const sender = snapshot.contacts.find(contact => contact.userId === item.from)?.displayName ?? t('Member');
    const read = deliveryStage(item) === 'read';
    const expired = item.status === 'expired';
    const label = deliveryLabel(item, group);
    return <View style={[styles.bubble, own && styles.bubbleSelf]}>
      {group && !own && <Text style={styles.senderName}>{sender}</Text>}<Text selectable style={styles.message}>{item.text}</Text>
      {own && (group || expired) && <Text style={[styles.fileMeta, expired && { color: '#A33535' }]}>{label}</Text>}
      <View style={styles.messageMeta}><Text style={styles.messageTime}>{time(item.timestamp)}</Text>{own && <View accessibilityLabel={label}><Icon name={deliveryIcon(item)} size={15} color={expired ? '#A33535' : read ? colors.accent : '#70877D'} /></View>}</View>
    </View>;
  }
  return <SafeAreaView style={styles.whiteScreen} edges={['top', 'bottom']}>
    <View style={styles.chatHeader}><IconButton name="chevron-back" label={t('Back to chats')} onPress={() => router.canGoBack() ? router.back() : router.replace('/(tabs)')} />
      <Avatar name={conversation.title} id={conversation.id} group={group} size={41} /><View style={[styles.flex, { marginLeft: 7 }]}><Text numberOfLines={1} style={styles.chatName}>{conversation.title}</Text><Text numberOfLines={1} style={[styles.chatStatus, !group && peer?.online && { color: colors.accent }]}>{group ? t('Members: {count}', { count: conversation.memberIds.length }) : lastSeen(!!peer?.online, peer?.lastSeen ?? 0)}</Text></View>
      <IconButton name="call-outline" label={group ? t('Group calls unavailable') : t('Audio call')} disabled={!canCall || busy} onPress={() => void action(() => client().startCall(conversation.id, false))} />
      <IconButton name="videocam-outline" label={group ? t('Group video calls unavailable') : t('Video call')} disabled={!canCall || busy} onPress={() => void action(() => client().startCall(conversation.id, true))} />
      <IconButton name="ellipsis-horizontal" label={t('Safety options')} onPress={() => setSafetyMenuOpen(true)} />
    </View>
    {blockedPeer && <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 15, paddingVertical: 9, backgroundColor: '#FDECEF' }}><Icon name="ban-outline" size={17} color="#A22D3B" /><Text style={[styles.info, { flex: 1, color: '#A22D3B' }]}> {t('You blocked this contact. Unblock to see messages and calls.')}</Text></View>}
    {hiddenBlocked && <Text style={[styles.info, { textAlign: 'center', paddingVertical: 8, paddingHorizontal: 15 }]}> {t('Messages from blocked users are hidden.')}</Text>}
    <Pressable accessibilityRole="button" accessibilityLabel={t('Delivery status. Open connection settings')} onPress={() => router.push('/(tabs)/settings')} style={{ paddingHorizontal: 15, paddingVertical: 9, backgroundColor: notice.warning ? '#FFF2D8' : '#EDF5F1' }}><Text style={[styles.info, { color: notice.warning ? '#7B5924' : '#4E7161' }]}>{notice.text}</Text></Pressable>
    {!group && peer && !peerVerified && <Pressable accessibilityRole="button" accessibilityLabel={t('Verify contact safety code')} onPress={() => setSafetyOpen(true)} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 15, paddingVertical: 8, backgroundColor: '#FFF6E4' }}><Icon name="shield-outline" size={17} color="#7B5924" /><Text style={[styles.info, { flex: 1, color: '#7B5924' }]}> {t('Contact key is not verified. Compare the safety code.')}</Text><Icon name="chevron-forward" size={17} color="#7B5924" /></Pressable>}
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <View style={styles.conversation}>
        {group && <Text style={[styles.info, { textAlign: 'center', paddingVertical: 8, paddingHorizontal: 15 }]}> {t('Group up to 8 members · group calls are not available yet')}</Text>}
        <FlatList ref={list} data={timeline} keyExtractor={entry => entry.key} contentContainerStyle={styles.messages} keyboardShouldPersistTaps="handled" onContentSizeChange={() => list.current?.scrollToEnd({ animated: true })}
          renderItem={({ item: entry }) => {
            if (entry.kind === 'message') return renderMessage(entry.item);
            const file = entry.item;
            return <View style={{ marginTop: 9 }}><AttachmentCard file={file} self={file.senderId === identity?.userId} group={group} sender={group ? snapshot.contacts.find(contact => contact.userId === file.senderId)?.displayName : undefined} mediaDisabled={!focused || !!snapshot.activeCall || !!recording} onOpen={() => void action(() => shareFile(file))} /></View>;
          }}
          ListEmptyComponent={<Empty icon="chatbubble-ellipses-outline" title={t('Start a conversation')} text={group ? t('Data syncs between participants’ phones.') : t('Send the first message. If your contact is offline, it waits on your device for up to 7 days.')} />} />
      </View>
      {!!error && <Pressable accessibilityRole="button" accessibilityLabel={t('Hide error')} onPress={() => setError('')}><Text style={[styles.error, { borderRadius: 0 }]}>{error}</Text></Pressable>}
      {!blockedPeer && attachments && <View><View style={styles.attachmentMenu}>
        <Pressable style={styles.attachment} accessibilityRole="button" onPress={() => attach('media')}><Icon name="images-outline" size={27} /><Text style={styles.rowText}> {t('Photos and video')}</Text></Pressable>
        <Pressable style={styles.attachment} accessibilityRole="button" onPress={() => attach('document')}><Icon name="document-outline" size={27} /><Text style={styles.rowText}> {t('File up to 5 MiB')}</Text></Pressable>
      </View><View style={styles.attachmentMenu}>
        <Pressable style={[styles.attachment, !!snapshot.activeCall && styles.disabled]} disabled={busy || !!snapshot.activeCall} accessibilityRole="button" onPress={() => record('voice')}><Icon name="mic-outline" size={27} /><Text style={styles.rowText}> {t('Voice message')}</Text></Pressable>
        <Pressable style={[styles.attachment, !!snapshot.activeCall && styles.disabled]} disabled={busy || !!snapshot.activeCall} accessibilityRole="button" onPress={() => record('circle')}><Icon name="videocam-outline" size={27} /><Text style={styles.rowText}> {t('Video circle')}</Text></Pressable>
      </View></View>}
      {!blockedPeer && <View style={styles.composer}><IconButton name={attachments ? 'close' : 'attach'} label={t('Attach file')} disabled={busy} onPress={() => setAttachments(!attachments)} />
        <TextInput style={styles.composerInput} value={draft} onChangeText={setDraft} multiline maxLength={4000} placeholder={t('Message')} placeholderTextColor={colors.secondary} accessibilityLabel={t('Message text')} />
        {!draft.trim() && <IconButton name="mic-outline" label={t('Record voice message')} disabled={busy || !!snapshot.activeCall} onPress={() => record('voice')} />}
        {!!draft.trim() && <Pressable style={[styles.send, busy && styles.disabled]} accessibilityRole="button" accessibilityLabel={t('Send message')} disabled={busy} onPress={send}><Icon name="arrow-up" color={colors.white} size={25} /></Pressable>}
      </View>}
    </KeyboardAvoidingView>
    {!!recording && focused && <MediaComposer key={`${id}:${recording}`} kind={recording} conversationId={conversation.id} blocked={!!snapshot.activeCall} onClose={() => setRecording(undefined)} />}
    {!group && peer && identity && <SafetyCode visible={safetyOpen} title={peer.displayName} code={safety} verified={peerVerified} sessionReady={!!conversation.session?.contentE2E} onClose={() => setSafetyOpen(false)} onVerify={() => void action(async () => { await client().markContactVerified(peer.userId); setSafetyOpen(false); })} />}
    {identity && <SafetyMenu visible={safetyMenuOpen} group={group} title={conversation.title} targetId={conversation.id}
      peer={!group && peer ? { userId: peer.userId, displayName: peer.displayName } : undefined} members={groupMembers} blocked={snapshot.blockedContacts}
      onClose={() => setSafetyMenuOpen(false)}
      onBlock={userId => client().blockContact(userId)} onUnblock={userId => client().unblockContact(userId)}
      onSafetyCode={!group && peer ? () => setSafetyOpen(true) : undefined}
      onReport={async ({ reason, details }) => {
        if (group) await client().reportContent({ targetId: conversation.id, targetKind: 'group', conversationId: conversation.id, reason, details: details || undefined });
        else if (peer) await client().reportContent({ targetId: peer.userId, targetKind: 'user', conversationId: conversation.id, reason, details: details || undefined });
      }} />}
  </SafeAreaView>;
}
