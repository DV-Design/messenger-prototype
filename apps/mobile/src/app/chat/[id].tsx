import { useCallback, useEffect, useRef, useState, type ComponentRef } from 'react';
import { Redirect, router, useIsFocused, useLocalSearchParams } from 'expo-router';
import { Alert, AppState, FlatList, KeyboardAvoidingView, Linking, Platform, Pressable, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { safetyEmoji, type MessengerFile, type MessengerMessage } from '@messenger/core';
import { intlLocale, t } from '../../i18n';
import { messageParts } from '../../message-links';
import { pickDocument, pickMedia, shareFile } from '../../attachments';
import { AttachmentCard } from '../../components/AttachmentCard';
import { MessageActions, type MessageTarget } from '../../components/MessageActions';
import { SafetyCode } from '../../components/SafetyCode';
import { SafetyMenu } from '../../components/SafetyMenu';
import { Avatar, Button, Empty, Icon, IconButton, lastSeen, time } from '../../components/ui';
import { client, errorText, useMessenger } from '../../runtime';
import { colors, styles } from '../../styles';
import { transportNotice } from '../../transport-notice';
import { canMarkRead, deliveryIcon, deliveryLabel, deliveryStage, readContentVersion, waitingForDelivery } from '../../delivery-model';
import { MediaComposer } from '../../components/MediaComposer';
import type { MediaKind } from '../../media-model';
import { chatTimeline, dayLabel, withDays, type ChatTimelineRow } from '../../timeline-model';

const FLOATING_DATE_MS = 1200;

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
  const [selected, setSelected] = useState<MessageTarget>();
  const [editing, setEditing] = useState<string>();
  const unsentDraft = useRef('');
  const list = useRef<ComponentRef<typeof FlatList<ChatTimelineRow>>>(null);
  // Like Telegram: while the history scrolls, the date of the topmost message floats above it.
  const [floatingDate, setFloatingDate] = useState('');
  const [scrolling, setScrolling] = useState(false);
  const scrollIdle = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const now = useToday();
  // FlatList requires a handler that never changes; the label is computed when it runs.
  const onViewable = useCallback(({ viewableItems }: { viewableItems: { item: ChatTimelineRow | null }[] }) => {
    const top = viewableItems.find(token => token.item)?.item;
    if (top) setFloatingDate(dayLabel(top.timestamp, Date.now(), intlLocale, { today: t('Today'), yesterday: t('Yesterday') }));
  }, []);
  const scrollStarted = useCallback(() => { clearTimeout(scrollIdle.current); setScrolling(true); }, []);
  const scrollStopped = useCallback(() => { clearTimeout(scrollIdle.current); scrollIdle.current = setTimeout(() => setScrolling(false), FLOATING_DATE_MS); }, []);
  useEffect(() => () => clearTimeout(scrollIdle.current), []);
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
  const timeline = withDays(chatTimeline(conversation.messages.filter(item => !blocked.has(item.from)), conversation.files.filter(item => !blocked.has(item.senderId))),
    timestamp => dayLabel(timestamp, now, intlLocale, { today: t('Today'), yesterday: t('Yesterday') }));
  const peer = snapshot.contacts.find(item => conversation.memberIds.includes(item.userId) && item.userId !== identity?.userId);
  const group = conversation.kind === 'group';
  const blockedPeer = !group && !!peer && blocked.has(peer.userId);
  const hiddenBlocked = group && conversation.memberIds.some(id => id !== identity?.userId && blocked.has(id));
  const groupMembers = group ? conversation.memberIds.filter(id => id !== identity?.userId).map(id => ({ userId: id, displayName: snapshot.contacts.find(contact => contact.userId === id)?.displayName ?? t('Member') })) : [];
  const safety = peer && identity ? safetyEmoji(identity.publicKey, peer.publicKey) : '';
  const peerVerified = !!peer && snapshot.verifiedContacts.includes(peer.userId);
  const moved = !group && peer ? snapshot.movedContacts?.[peer.userId] : undefined;
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
    const edited = editing;
    void action(async () => {
      if (edited) await client().editMessage(conversation!.id, edited, text);
      else await client().sendText(conversation!.id, text);
      setEditing(undefined); setDraft(edited ? unsentDraft.current : '');
    });
  }
  function attach(kind: 'media' | 'document') {
    // The manager establishes recipient sessions on demand, including group
    // members without a separate DM. Chat-list rows are not transport state.
    setAttachments(false);
    void action(() => kind === 'media' ? pickMedia(conversation!.id) : pickDocument(conversation!.id));
  }
  function record(kind: MediaKind) { if (busy || snapshot.activeCall) return; setAttachments(false); setRecording(kind); }
  function selectMessage(item: MessengerMessage) { setSelected({ id: item.id, type: 'message', author: item.from, own: item.from === identity?.userId, expired: item.status === 'expired', text: item.text }); }
  function selectFile(file: MessengerFile) { setSelected({ id: file.id, type: 'file', author: file.senderId, own: file.senderId === identity?.userId, expired: file.deliveryStatus === 'expired' }); }
  function cancelEdit() { setEditing(undefined); setDraft(unsentDraft.current); }
  function deleteMessage(target: MessageTarget, scope: 'me' | 'everyone') {
    if (editing === target.id) cancelEdit();
    void action(() => client().deleteMessage(conversation!.id, { id: target.id, type: target.type, author: target.author }, scope));
  }
  function confirmDeleteChat() {
    Alert.alert(t('Delete chat?'), group ? t('The history is removed from this phone. New messages from members bring the chat back; leaving a group is not available yet.') : t('The history is removed from this phone. The chat stays on the other person\'s device.'), [
      { text: t('Cancel'), style: 'cancel' },
      { text: t('Delete'), style: 'destructive', onPress: () => void action(async () => { await client().deleteChat(conversation!.id); router.replace('/(tabs)'); }) },
    ]);
  }
  function confirmDeleteContact(userId: string, name: string) {
    Alert.alert(t('Delete {name} from contacts?', { name }), t('The chat and its history are removed from this phone. The chat stays on the other person\'s device, and they can still write to you. Block them to stop that.'), [
      { text: t('Cancel'), style: 'cancel' },
      { text: t('Delete'), style: 'destructive', onPress: () => void action(async () => { await client().removeContact(userId); router.replace('/(tabs)'); }) },
    ]);
  }
  function renderMessage(item: MessengerMessage) {
    const own = item.from === identity?.userId;
    const sender = snapshot.contacts.find(contact => contact.userId === item.from)?.displayName ?? t('Member');
    const read = deliveryStage(item) === 'read';
    const expired = item.status === 'expired';
    const label = deliveryLabel(item, group);
    return <Pressable accessibilityHint={t('Hold to edit, copy or delete')} accessibilityActions={[{ name: 'longpress', label: t('Message actions') }]} onAccessibilityAction={() => selectMessage(item)} onLongPress={() => selectMessage(item)} style={[styles.bubble, own && styles.bubbleSelf]}>
      {group && !own && <Text style={styles.senderName}>{sender}</Text>}<Text style={styles.message}>{messageParts(item.text).map((part, index) => part.url
        ? <Text key={index} accessibilityRole="link" style={{ color: colors.blue, textDecorationLine: 'underline' }} onLongPress={() => selectMessage(item)}
          onPress={() => { const url = part.url!; void Linking.openURL(url).catch(() => setError(t('Could not open the link.'))); }}>{part.text}</Text>
        : part.text)}</Text>
      {own && (group || expired) && <Text style={[styles.fileMeta, expired && { color: '#A33535' }]}>{label}</Text>}
      <View style={styles.messageMeta}>{!!item.editedAt && <Text style={styles.messageTime}>{t('edited')}</Text>}<Text style={styles.messageTime}>{time(item.timestamp)}</Text>{own && <View accessibilityLabel={label}><Icon name={deliveryIcon(item)} size={15} color={expired ? '#A33535' : read ? colors.accent : '#70877D'} /></View>}</View>
    </Pressable>;
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
    {moved && peer && !blockedPeer && <View accessibilityRole="alert" style={{ gap: 9, paddingHorizontal: 15, paddingVertical: 10, backgroundColor: '#FFF2D8' }}>
      <Text style={[styles.info, { color: '#7B5924' }]}>{t('{name} restored the account on a new key. This is not confirmed to be the same person until you compare the safety code in the new chat. Messages not yet delivered here will not reach the new key and expire after 7 days. This chat stays as history.', { name: peer.displayName })}</Text>
      <Button secondary busy={busy} title={t('Open new chat')} onPress={() => void action(async () => { const next = await client().acceptMovedContact(peer.userId); router.push({ pathname: '/chat/[id]', params: { id: next } }); })} />
    </View>}
    {!group && peer && !peerVerified && !moved && <Pressable accessibilityRole="button" accessibilityLabel={t('Verify contact safety code')} onPress={() => setSafetyOpen(true)} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 15, paddingVertical: 8, backgroundColor: '#FFF6E4' }}><Icon name="shield-outline" size={17} color="#7B5924" /><Text style={[styles.info, { flex: 1, color: '#7B5924' }]}> {t('Contact key is not verified. Compare the safety code.')}</Text><Icon name="chevron-forward" size={17} color="#7B5924" /></Pressable>}
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <View style={styles.conversation}>
        {group && <Text style={[styles.info, { textAlign: 'center', paddingVertical: 8, paddingHorizontal: 15 }]}> {t('Group up to 8 members · group calls are not available yet')}</Text>}
        <FlatList ref={list} data={timeline} keyExtractor={entry => entry.key} contentContainerStyle={styles.messages} keyboardShouldPersistTaps="handled" onContentSizeChange={() => list.current?.scrollToEnd({ animated: true })}
          onViewableItemsChanged={onViewable} viewabilityConfig={VIEWABILITY} onScrollBeginDrag={scrollStarted} onMomentumScrollBegin={scrollStarted} onScrollEndDrag={scrollStopped} onMomentumScrollEnd={scrollStopped}
          renderItem={({ item: entry }) => {
            if (entry.kind === 'day') return <DayPill label={entry.label} />;
            if (entry.kind === 'message') return renderMessage(entry.item);
            const file = entry.item;
            return <View style={{ marginTop: 9 }}><AttachmentCard file={file} self={file.senderId === identity?.userId} group={group} sender={group ? snapshot.contacts.find(contact => contact.userId === file.senderId)?.displayName : undefined} mediaDisabled={!focused || !!snapshot.activeCall || !!recording} onOpen={() => void action(() => shareFile(file))} onLongPress={() => selectFile(file)} /></View>;
          }}
          ListEmptyComponent={<Empty icon="chatbubble-ellipses-outline" title={t('Start a conversation')} text={group ? t('Data syncs between participants’ phones.') : t('Send the first message. If your contact is offline, it waits on your device for up to 7 days.')} />} />
        {scrolling && !!floatingDate && <View pointerEvents="none" style={{ position: 'absolute', top: 8, left: 0, right: 0, alignItems: 'center' }}><DayPill label={floatingDate} /></View>}
      </View>
      {!!error && <Pressable accessibilityRole="button" accessibilityLabel={t('Hide error')} onPress={() => setError('')}><Text style={[styles.error, { borderRadius: 0 }]}>{error}</Text></Pressable>}
      {!blockedPeer && !!editing && <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 15, paddingRight: 4, paddingVertical: 4, backgroundColor: '#EDF5F1' }}><Icon name="create-outline" size={17} /><Text style={[styles.info, { flex: 1 }]}>{t('Editing message')}</Text><IconButton name="close" label={t('Cancel editing')} disabled={busy} onPress={cancelEdit} /></View>}
      {!blockedPeer && attachments && !editing && <View><View style={styles.attachmentMenu}>
        <Pressable style={styles.attachment} accessibilityRole="button" onPress={() => attach('media')}><Icon name="images-outline" size={27} /><Text style={styles.rowText}> {t('Photos and video')}</Text></Pressable>
        <Pressable style={styles.attachment} accessibilityRole="button" onPress={() => attach('document')}><Icon name="document-outline" size={27} /><Text style={styles.rowText}> {t('File up to 5 MiB')}</Text></Pressable>
      </View><View style={styles.attachmentMenu}>
        <Pressable style={[styles.attachment, !!snapshot.activeCall && styles.disabled]} disabled={busy || !!snapshot.activeCall} accessibilityRole="button" onPress={() => record('voice')}><Icon name="mic-outline" size={27} /><Text style={styles.rowText}> {t('Voice message')}</Text></Pressable>
        <Pressable style={[styles.attachment, !!snapshot.activeCall && styles.disabled]} disabled={busy || !!snapshot.activeCall} accessibilityRole="button" onPress={() => record('circle')}><Icon name="videocam-outline" size={27} /><Text style={styles.rowText}> {t('Video circle')}</Text></Pressable>
      </View></View>}
      {!blockedPeer && <View style={styles.composer}>{!editing && <IconButton name={attachments ? 'close' : 'attach'} label={t('Attach file')} disabled={busy} onPress={() => setAttachments(!attachments)} />}
        <TextInput style={styles.composerInput} value={draft} onChangeText={setDraft} multiline maxLength={4000} placeholder={t('Message')} placeholderTextColor={colors.secondary} accessibilityLabel={t('Message text')} />
         {!draft.trim() && !editing && <IconButton name="mic-outline" label={t('Record voice message')} disabled={busy || !!snapshot.activeCall} onPress={() => record('voice')} />}
        {!!draft.trim() && <Pressable style={[styles.send, busy && styles.disabled]} accessibilityRole="button" accessibilityLabel={editing ? t('Save changes') : t('Send message')} disabled={busy} onPress={send}><Icon name={editing ? 'checkmark' : 'arrow-up'} color={colors.white} size={25} /></Pressable>}
      </View>}
    </KeyboardAvoidingView>
    {!!recording && focused && <MediaComposer key={`${id}:${recording}`} kind={recording} conversationId={conversation.id} blocked={!!snapshot.activeCall} onClose={() => setRecording(undefined)} />}
    {!group && peer && identity && <SafetyCode visible={safetyOpen} title={peer.displayName} code={safety} verified={peerVerified} sessionReady={!!conversation.session?.contentE2E} onClose={() => setSafetyOpen(false)} onVerify={() => void action(async () => { await client().markContactVerified(peer.userId); setSafetyOpen(false); })} />}
    <MessageActions target={selected} onClose={() => setSelected(undefined)} onError={setError} onDelete={deleteMessage} onEdit={target => { if (!editing) unsentDraft.current = draft; setAttachments(false); setEditing(target.id); setDraft(target.text ?? ''); }} />
    {identity && <SafetyMenu visible={safetyMenuOpen} group={group} title={conversation.title} targetId={conversation.id}
      peer={!group && peer ? { userId: peer.userId, displayName: peer.displayName } : undefined} members={groupMembers} blocked={snapshot.blockedContacts}
      onClose={() => setSafetyMenuOpen(false)}
      onBlock={userId => client().blockContact(userId)} onUnblock={userId => client().unblockContact(userId)}
      onSafetyCode={!group && peer ? () => setSafetyOpen(true) : undefined}
      onDeleteChat={confirmDeleteChat} onDeleteContact={!group && peer ? () => confirmDeleteContact(peer.userId, peer.displayName) : undefined}
      onReport={async ({ reason, details }) => {
        if (group) await client().reportContent({ targetId: conversation.id, targetKind: 'group', conversationId: conversation.id, reason, details: details || undefined });
        else if (peer) await client().reportContent({ targetId: peer.userId, targetKind: 'user', conversationId: conversation.id, reason, details: details || undefined });
      }} />}
  </SafeAreaView>;
}

const VIEWABILITY = { itemVisiblePercentThreshold: 1 };
function DayPill({ label }: { label: string }) {
  return <View accessibilityRole="header" style={{ alignSelf: 'center', marginVertical: 4, paddingHorizontal: 11, paddingVertical: 4, borderRadius: 12, backgroundColor: 'rgba(43, 74, 62, 0.42)' }}>
    <Text style={{ color: colors.white, fontSize: 13, fontWeight: '600' }}>{label}</Text>
  </View>;
}

/** The current time, refreshed at local midnight so "Today" and "Yesterday" move while a chat stays open. */
function useToday() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const midnight = new Date(now); midnight.setHours(24, 0, 1, 0);
    const timer = setTimeout(() => setNow(Date.now()), midnight.getTime() - now);
    return () => clearTimeout(timer);
  }, [now]);
  return now;
}
