import { useCallback, useEffect, useRef, useState, type ComponentRef } from 'react';
import { Redirect, router, useIsFocused, useLocalSearchParams } from 'expo-router';
import { Alert, AppState, FlatList, KeyboardAvoidingView, Linking, Platform, Pressable, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from '../../components/SafeArea';
import { safetyEmoji, type MessengerFile, type MessengerMessage, type ReactionEmoji, type ReactionView } from '@messenger/core';
import { intlLocale, t } from '../../i18n';
import { pickDocument, pickMedia, shareFile } from '../../attachments';
import { MessageActions, type MessageTarget } from '../../components/MessageActions';
import { myReaction } from '../../reaction-model';
import { SafetyCode } from '../../components/SafetyCode';
import { SafetyMenu } from '../../components/SafetyMenu';
import { Avatar, Button, Empty, Icon, IconButton, lastSeen } from '../../components/ui';
import { client, errorText, useMessenger } from '../../runtime';
import { colors, styles } from '../../styles';
import { transportNotice } from '../../transport-notice';
import { canMarkRead, readContentVersion, waitingForDelivery } from '../../delivery-model';
import { MediaComposer } from '../../components/MediaComposer';
import type { MediaKind } from '../../media-model';
import { chatTimeline, dayLabel, withDays, type ChatTimelineRow } from '../../timeline-model';
import { haptic, messageSent, setOpenChat } from '../../feedback';
import { chatTranslationSupported, setChatTranslated, useChatTranslated, useTranslations } from '../../chat-translation';
import { useMyLanguage } from '../../my-language';
import { PermissionNotice } from '../../components/PermissionNotice';
import { AccessDenied } from '../../permission-notice-model';
import { LocationPicker } from '../../components/LocationPicker';
import { LocationViewer } from '../../components/LocationContactCard';
import { formatContactText, formatLocationText, parseContactText, parseLocationText } from '../../location-contact';
import { isLiveLocationMessage, startLiveLocation, stopLiveLocation } from '../../live-location';
import { ContactPicker } from '../../components/ContactPicker';
import type { PhoneContact } from '../../contacts-model';
import type { LiveDurationMin } from '../../live-location-model';
import { ReplyChip } from '../../components/ReplyChip';
import { ChatRowHandlers, FileRow, MessageRow, rowVersion } from '../../components/ChatRow';
import { TransitionGate } from '../../after-transition';
import { formatReplyText, parseReplyText, quotedMessageSnippet, replyBody, type ParsedReply } from '../../reply';
import { mediaKind } from '../../media-model';

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
  const [locationOpen, setLocationOpen] = useState(false);
  const [viewingLocation, setViewingLocation] = useState<string>();
  const [contactsOpen, setContactsOpen] = useState(false);
  const [rowHandlers] = useState(() => new ChatRowHandlers());
  const closeContacts = useCallback(() => setContactsOpen(false), []);
  const [safetyOpen, setSafetyOpen] = useState(false);
  const [safetyMenuOpen, setSafetyMenuOpen] = useState(false);
  const [selected, setSelected] = useState<MessageTarget>();
  const [editing, setEditing] = useState<string>();
  const [replying, setReplying] = useState<MessageTarget>();
  const unsentDraft = useRef('');
  const list = useRef<ComponentRef<typeof FlatList<ChatTimelineRow>>>(null);
  // Like Telegram: while the history scrolls, the date of the topmost message floats above it.
  const [floatingDate, setFloatingDate] = useState('');
  const [scrolling, setScrolling] = useState(false);
  const scrollIdle = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const now = useToday();
  // FlatList requires a handler that never changes; the label is computed when it runs.
  // The list is inverted (newest message at the bottom, loaded first, like Telegram); the
  // topmost ON SCREEN row is therefore the highest-index visible item, not viewableItems[0].
  const onViewable = useCallback(({ viewableItems }: { viewableItems: { item: ChatTimelineRow | null; index: number | undefined }[] }) => {
    const top = viewableItems.reduce<{ item: ChatTimelineRow | null; index: number | undefined } | undefined>((highest, token) => !highest || (token.index ?? -1) > (highest.index ?? -1) ? token : highest, undefined)?.item;
    if (top) setFloatingDate(dayLabel(top.timestamp, Date.now(), intlLocale, { today: t('Today'), yesterday: t('Yesterday') }));
  }, []);
  const scrollStarted = useCallback(() => { clearTimeout(scrollIdle.current); setScrolling(true); }, []);
  const scrollStopped = useCallback(() => { clearTimeout(scrollIdle.current); scrollIdle.current = setTimeout(() => setScrolling(false), FLOATING_DATE_MS); }, []);
  useEffect(() => () => clearTimeout(scrollIdle.current), []);
  const unread = conversation?.unread ?? 0;
  const focused = useIsFocused();
  const myLanguage = useMyLanguage();
  const translated = useChatTranslated(id);
  // Coordinates and phone numbers never go to the translation backend; they would not translate sensibly, and would leak location/contact data to it.
  // A reply's own quote marker line is never sent either — only the typed body is translated.
  const translations = useTranslations(translated && chatTranslationSupported,
    (conversation?.messages ?? [])
      .map(item => ({ ...item, text: replyBody(item.text) }))
      .filter(item => !!item.text && !parseLocationText(item.text) && !parseContactText(item.text)),
    myLanguage.code);
  useEffect(() => focused && id ? setOpenChat(id) : undefined, [focused, id]);
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
  // Reversed for an inverted FlatList: newest first, so the chat opens already showing the
  // latest messages instead of rendering the whole history from the start, like Telegram.
  const reversedTimeline = [...timeline].reverse();
  const peer = snapshot.contacts.find(item => conversation.memberIds.includes(item.userId) && item.userId !== identity?.userId);
  const group = conversation.kind === 'group';
  const blockedPeer = !group && !!peer && blocked.has(peer.userId);
  const hiddenBlocked = group && conversation.memberIds.some(id => id !== identity?.userId && blocked.has(id));
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
    try { await operation(); } catch (cause) { haptic('reject'); if (!(cause instanceof AccessDenied)) setError(errorText(cause)); } finally { setBusy(false); }
  }
  function send() {
    const text = draft;
    const edited = editing;
    const replyTarget = replying;
    void action(async () => {
      if (edited) {
        // An edit keeps whatever quote the message already carried; only the typed body changes.
        const original = conversation!.messages.find(m => m.id === edited);
        const quote = original ? parseReplyText(original.text) : undefined;
        await client().editMessage(conversation!.id, edited, quote ? formatReplyText(quote, text) : text);
      } else if (replyTarget) {
        await client().sendText(conversation!.id, formatReplyText({ type: replyTarget.type, author: replyTarget.author, id: replyTarget.id }, text));
        messageSent();
      } else { await client().sendText(conversation!.id, text); messageSent(); }
      setEditing(undefined); setReplying(undefined); setDraft(edited ? unsentDraft.current : '');
    });
  }
  function cancelReply() { setReplying(undefined); }
  function attach(kind: 'media' | 'document') {
    // The manager establishes recipient sessions on demand, including group
    // members without a separate DM. Chat-list rows are not transport state.
    setAttachments(false);
    void action(async () => { if (await (kind === 'media' ? pickMedia(conversation!.id) : pickDocument(conversation!.id))) messageSent(); });
  }
  function record(kind: MediaKind) { if (busy || snapshot.activeCall) return; setAttachments(false); setRecording(kind); }
  function openLocation() { setAttachments(false); setLocationOpen(true); }
  function sendLocation(lat: number, lng: number, label?: string) {
    setLocationOpen(false);
    // A picked place or the address under the pin travels as the message's first line, like Telegram's venue title.
    void action(async () => { await client().sendText(conversation!.id, formatLocationText(label?.trim() || t('Location'), lat, lng, false)); messageSent(); });
  }
  function shareLiveLocation(lat: number, lng: number, minutes: LiveDurationMin) {
    setLocationOpen(false);
    void action(async () => { await startLiveLocation(conversation!.id, identity!.userId, lat, lng, minutes); messageSent(); });
  }
  function sendContact() { setAttachments(false); setContactsOpen(true); }
  function sendPickedContact(contact: PhoneContact) {
    setContactsOpen(false);
    void action(async () => { await client().sendText(conversation!.id, formatContactText(contact.name, contact.phones)); messageSent(); });
  }
  function fileLabel(file: MessengerFile): string {
    const kind = mediaKind(file.name, file.mime);
    return kind === 'voice' ? t('Voice message') : kind === 'circle' ? t('Video circle') : file.name;
  }
  const messageTarget = (item: MessengerMessage): MessageTarget => ({ id: item.id, type: 'message', author: item.from, own: item.from === identity?.userId, expired: item.status === 'expired', text: item.text, reaction: myReaction(item.reactions, identity?.userId) });
  const fileTarget = (file: MessengerFile): MessageTarget => ({ id: file.id, type: 'file', author: file.senderId, own: file.senderId === identity?.userId, expired: file.deliveryStatus === 'expired', text: fileLabel(file), reaction: myReaction(file.reactions, identity?.userId) });
  function selectMessage(item: MessengerMessage) { haptic('longPress'); setSelected(messageTarget(item)); }
  function selectFile(file: MessengerFile) { haptic('longPress'); setSelected(fileTarget(file)); }
  function startReply(target: MessageTarget) { setEditing(undefined); setAttachments(false); setReplying(target); }
  function authorName(userId: string): string { return userId === identity?.userId ? t('You') : snapshot.contacts.find(contact => contact.userId === userId)?.displayName ?? t('Member'); }
  /** Looks the quoted record up live, so an edit or a later rename of the author shows through; a missing record (expired, deleted) falls back to a plain notice. */
  function quotedPreview(reply: ParsedReply): { authorName: string; text: string } {
    if (reply.type === 'file') {
      const file = conversation!.files.find(item => item.id === reply.id && item.senderId === reply.author);
      return { authorName: authorName(reply.author), text: file ? fileLabel(file) : t('Original message not found') };
    }
    const message = conversation!.messages.find(item => item.id === reply.id && item.from === reply.author);
    return { authorName: authorName(reply.author), text: message ? quotedMessageSnippet(message.text) : t('Original message not found') };
  }
  function scrollToQuoted(reply: ParsedReply) {
    const key = JSON.stringify([reply.type === 'file' ? 'attachment' : 'message', reply.author, reply.id]);
    const index = reversedTimeline.findIndex(entry => entry.key === key);
    if (index >= 0) list.current?.scrollToIndex({ index, animated: true, viewPosition: 0.5 });
  }
  function react(record: { id: string; type: 'message' | 'file'; author: string }, emoji: ReactionEmoji | undefined) {
    // Not through action(): a reaction must not wait behind, or block, a send in progress.
    setError(''); haptic('tick');
    void client().react(conversation!.id, record, emoji).catch(cause => setError(errorText(cause)));
  }
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
  /** Looks the message up on every render, so a live share's pin moves as the sender's edits arrive. */
  function locationViewer() {
    const message = viewingLocation ? conversation?.messages.find(m => m.id === viewingLocation) : undefined;
    const parsed = message ? parseLocationText(parseReplyText(message.text)?.text ?? message.text) : undefined;
    const own = !!message && message.from === identity?.userId;
    const author = own ? t('You') : snapshot.contacts.find(contact => contact.userId === message?.from)?.displayName ?? conversation?.title ?? '';
    return <LocationViewer location={parsed} updatedAt={message ? message.editedAt ?? message.timestamp : 0} title={author}
      canStop={own && !!parsed?.live && !!message && isLiveLocationMessage(message.id)}
      onStop={() => void stopLiveLocation()} onClose={() => setViewingLocation(undefined)} onError={setError} />;
  }
  // Rows are memoized on a version string; the handlers object is stable and always holds today's closures.
  const nameOf = (userId: string) => userId === identity?.userId ? t('You') : snapshot.contacts.find(contact => contact.userId === userId)?.displayName ?? t('Member');
  const reactorNames = (reactions: ReactionView[] | undefined) => Object.fromEntries((reactions ?? []).map(reaction => [reaction.userId, nameOf(reaction.userId)]));
  // The closures read refs (the list, for scrolling) but only run from row events, never during render.
  // eslint-disable-next-line react-hooks/refs
  rowHandlers.update({
    selectMessage, selectFile,
    replyToMessage: item => startReply(messageTarget(item)), replyToFile: file => startReply(fileTarget(file)),
    react, openLocation: setViewingLocation, scrollToQuoted,
    openLink: url => void Linking.openURL(url).catch(() => setError(t('Could not open the link.'))),
    openFile: file => void action(() => shareFile(file)),
  });
  const swipe = !blockedPeer && !editing && !conversation.removed;
  const blockedKey = snapshot.blockedContacts.join();
  const mediaDisabled = !focused || !!snapshot.activeCall || !!recording;
  function renderRow(entry: ChatTimelineRow) {
    if (entry.kind === 'day') return <DayPill label={entry.label} />;
    if (entry.kind === 'message') {
      const item = entry.item;
      const reply = parseReplyText(item.text);
      const quote = reply ? quotedPreview(reply) : undefined;
      const translation = translations.texts[item.id];
      const sender = nameOf(item.from);
      const names = reactorNames(item.reactions);
      return <MessageRow item={item} sender={sender} quote={quote} translation={translation} handlers={rowHandlers} selfId={identity?.userId} group={group} blocked={blocked} swipe={swipe} names={names}
        version={rowVersion(item, [sender, quote, translation, group, swipe, blockedKey, names])} />;
    }
    const file = entry.item;
    const sender = group ? nameOf(file.senderId) : undefined;
    const names = reactorNames(file.reactions);
    return <FileRow file={file} sender={sender} mediaDisabled={mediaDisabled} handlers={rowHandlers} selfId={identity?.userId} group={group} blocked={blocked} swipe={swipe} names={names}
      version={rowVersion(file, [sender, mediaDisabled, group, swipe, blockedKey, names])} />;
  }
  return <SafeAreaView style={styles.whiteScreen} edges={['top', 'bottom']}>
    <View style={styles.chatHeader}><IconButton name="chevron-back" label={t('Back to chats')} onPress={() => router.canGoBack() ? router.back() : router.replace('/(tabs)')} />
      <Pressable accessibilityRole={group ? 'button' : 'header'} accessibilityHint={group ? t('Opens group info') : undefined} disabled={!group} onPress={() => router.push({ pathname: '/group/[id]', params: { id: conversation.id } })} style={{ flexDirection: 'row', alignItems: 'center', flex: 1, minWidth: 0 }}>
        <Avatar name={conversation.title} id={conversation.id} group={group} size={41} /><View style={[styles.flex, { marginLeft: 7 }]}><Text numberOfLines={1} style={styles.chatName}>{conversation.title}</Text><Text numberOfLines={1} style={[styles.chatStatus, !group && peer?.online && { color: colors.accent }]}>{group ? (conversation.removed ? t('You are no longer a member') : t('Members: {count}', { count: conversation.memberIds.length })) : lastSeen(!!peer?.online, peer?.lastSeen ?? 0)}</Text></View>
      </Pressable>
      {chatTranslationSupported && <IconButton name="language-outline" color={translated ? colors.white : undefined} label={translated ? t('Show original') : t('Translate to {language}', { language: myLanguage.label })} onPress={() => void setChatTranslated(conversation.id, !translated)} active={translated} />}
      <IconButton name="call-outline" label={group ? t('Group calls unavailable') : t('Audio call')} disabled={!canCall || busy} onPress={() => void action(() => client().startCall(conversation.id, false))} />
      <IconButton name="videocam-outline" label={group ? t('Group video calls unavailable') : t('Video call')} disabled={!canCall || busy} onPress={() => void action(() => client().startCall(conversation.id, true))} />
      <IconButton name="ellipsis-horizontal" label={t('Safety options')} onPress={() => setSafetyMenuOpen(true)} />
    </View>
    {blockedPeer && <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 15, paddingVertical: 9, backgroundColor: '#FDECEF' }}><Icon name="ban-outline" size={17} color="#A22D3B" /><Text style={[styles.info, { flex: 1, color: '#A22D3B' }]}> {t('You blocked this contact. Unblock to see messages and calls.')}</Text></View>}
    {hiddenBlocked && <Text style={[styles.info, { textAlign: 'center', paddingVertical: 8, paddingHorizontal: 15 }]}> {t('Messages from blocked users are hidden.')}</Text>}
    <Pressable accessibilityRole="button" accessibilityLabel={t('Delivery status. Open connection settings')} onPress={() => router.push('/(tabs)/settings')} style={{ paddingHorizontal: 15, paddingVertical: 9, backgroundColor: notice.warning ? '#FFF2D8' : '#EDF5F1' }}><Text style={[styles.info, { color: notice.warning ? '#7B5924' : '#4E7161' }]}>{notice.text}</Text></Pressable>
    {translated && chatTranslationSupported && <Pressable accessibilityRole="button" accessibilityLabel={t('Show original')} onPress={() => void setChatTranslated(conversation.id, false)} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 15, paddingVertical: 8, backgroundColor: '#EAF3FA' }}>
      <Icon name="language-outline" size={17} color={colors.blue} /><Text style={[styles.info, { flex: 1, color: '#2A5F82' }]}>{translations.error || (translations.busy ? t('Translating to {language}…', { language: myLanguage.label }) : t('Translated to {language}', { language: myLanguage.label }))}</Text>
      <Text style={{ color: colors.blue, fontSize: 13, fontWeight: '600' }}>{t('Show original')}</Text>
    </Pressable>}
    {moved && peer && !blockedPeer && <View accessibilityRole="alert" style={{ gap: 9, paddingHorizontal: 15, paddingVertical: 10, backgroundColor: '#FFF2D8' }}>
      <Text style={[styles.info, { color: '#7B5924' }]}>{t('{name} restored the account on a new key. This is not confirmed to be the same person until you compare the safety code in the new chat. Messages not yet delivered here will not reach the new key and expire after 7 days. This chat stays as history.', { name: peer.displayName })}</Text>
      <Button secondary busy={busy} title={t('Open new chat')} onPress={() => void action(async () => { const next = await client().acceptMovedContact(peer.userId); router.push({ pathname: '/chat/[id]', params: { id: next } }); })} />
    </View>}
    <TransitionGate><KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <View style={styles.conversation}>
        {group && <Text style={[styles.info, { textAlign: 'center', paddingVertical: 8, paddingHorizontal: 15 }]}> {t('Group up to 8 members · group calls are not available yet')}</Text>}
        {reversedTimeline.length === 0
          // An inverted FlatList's own ListEmptyComponent renders upside down (a known RN
          // quirk); rendering the empty state as a plain sibling instead of a FlatList prop
          // sidesteps it entirely rather than fighting the list's transform.
          ? <Empty icon="chatbubble-ellipses-outline" title={t('Start a conversation')} text={group ? t('Data syncs between participants’ phones.') : t('Send the first message. If your contact is offline, it waits on your device for up to 7 days.')} />
          : <FlatList ref={list} inverted data={reversedTimeline} keyExtractor={entry => entry.key} contentContainerStyle={styles.messages} keyboardShouldPersistTaps="handled"
          initialNumToRender={12} maxToRenderPerBatch={8} windowSize={9}
          onViewableItemsChanged={onViewable} viewabilityConfig={VIEWABILITY} onScrollBeginDrag={scrollStarted} onMomentumScrollBegin={scrollStarted} onScrollEndDrag={scrollStopped} onMomentumScrollEnd={scrollStopped}
          onScrollToIndexFailed={info => { list.current?.scrollToOffset({ offset: info.averageItemLength * info.index, animated: false }); setTimeout(() => list.current?.scrollToIndex({ index: info.index, animated: true, viewPosition: 0.5 }), 60); }}
          renderItem={({ item: entry }) => renderRow(entry)} />}
        {scrolling && !!floatingDate && <View pointerEvents="none" style={{ position: 'absolute', top: 8, left: 0, right: 0, alignItems: 'center' }}><DayPill label={floatingDate} /></View>}
      </View>
      <PermissionNotice />
      {!!error && <Pressable accessibilityRole="button" accessibilityLabel={t('Hide error')} onPress={() => setError('')}><Text style={[styles.error, { borderRadius: 0 }]}>{error}</Text></Pressable>}
      {!blockedPeer && !!editing && <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 15, paddingRight: 4, paddingVertical: 4, backgroundColor: '#EDF5F1' }}><Icon name="create-outline" size={17} /><Text style={[styles.info, { flex: 1 }]}>{t('Editing message')}</Text><IconButton name="close" label={t('Cancel editing')} disabled={busy} onPress={cancelEdit} /></View>}
      {!blockedPeer && !editing && !!replying && <View style={{ paddingLeft: 15, paddingRight: 4, backgroundColor: '#EDF5F1' }}><ReplyChip authorName={authorName(replying.author)} text={quotedMessageSnippet(replying.text ?? '')} onClose={cancelReply} /></View>}
      {!blockedPeer && attachments && !editing && <View><View style={styles.attachmentMenu}>
        <Pressable style={styles.attachment} accessibilityRole="button" onPress={() => attach('media')}><Icon name="images-outline" size={27} /><Text style={styles.rowText}> {t('Photos and video')}</Text></Pressable>
        <Pressable style={styles.attachment} accessibilityRole="button" onPress={() => attach('document')}><Icon name="document-outline" size={27} /><Text style={styles.rowText}> {t('File up to 1 GB')}</Text></Pressable>
      </View><View style={styles.attachmentMenu}>
        <Pressable style={[styles.attachment, !!snapshot.activeCall && styles.disabled]} disabled={busy || !!snapshot.activeCall} accessibilityRole="button" onPress={() => record('voice')}><Icon name="mic-outline" size={27} /><Text style={styles.rowText}> {t('Voice message')}</Text></Pressable>
        <Pressable style={[styles.attachment, !!snapshot.activeCall && styles.disabled]} disabled={busy || !!snapshot.activeCall} accessibilityRole="button" onPress={() => record('circle')}><Icon name="videocam-outline" size={27} /><Text style={styles.rowText}> {t('Video circle')}</Text></Pressable>
      </View><View style={styles.attachmentMenu}>
        <Pressable style={styles.attachment} accessibilityRole="button" onPress={openLocation}><Icon name="location-outline" size={27} /><Text style={styles.rowText}> {t('Location')}</Text></Pressable>
        <Pressable style={styles.attachment} accessibilityRole="button" onPress={sendContact}><Icon name="person-outline" size={27} /><Text style={styles.rowText}> {t('Share contact')}</Text></Pressable>
      </View></View>}
      {conversation.removed && <Text style={[styles.info, { textAlign: 'center', padding: 14, backgroundColor: '#F3F5F6' }]}>{t('You were removed from this group. The history stays on this phone.')}</Text>}
      {!blockedPeer && !conversation.removed && <View style={styles.composer}>{!editing && <IconButton name={attachments ? 'close' : 'attach'} label={t('Attach file')} disabled={busy} onPress={() => setAttachments(!attachments)} />}
        <TextInput style={styles.composerInput} value={draft} onChangeText={setDraft} multiline maxLength={4000} placeholder={t('Message')} placeholderTextColor={colors.secondary} accessibilityLabel={t('Message text')} />
         {!draft.trim() && !editing && <IconButton name="mic-outline" label={t('Record voice message')} disabled={busy || !!snapshot.activeCall} onPress={() => record('voice')} />}
        {!!draft.trim() && <Pressable style={[styles.send, busy && styles.disabled]} accessibilityRole="button" accessibilityLabel={editing ? t('Save changes') : t('Send message')} disabled={busy} onPress={send}><Icon name={editing ? 'checkmark' : 'arrow-up'} color={colors.white} size={25} /></Pressable>}
      </View>}
    </KeyboardAvoidingView></TransitionGate>
    {!!recording && focused && <MediaComposer key={`${id}:${recording}`} kind={recording} conversationId={conversation.id} blocked={!!snapshot.activeCall} onClose={() => setRecording(undefined)} />}
    {locationViewer()}
    <ContactPicker visible={contactsOpen} onClose={closeContacts} onPick={sendPickedContact} />
    <LocationPicker visible={locationOpen} busy={busy} onClose={() => setLocationOpen(false)} onSendPoint={sendLocation} onStartLive={shareLiveLocation} />
    {!group && peer && identity && <SafetyCode visible={safetyOpen} title={peer.displayName} code={safety} verified={peerVerified} sessionReady={!!conversation.session?.contentE2E} onClose={() => setSafetyOpen(false)} onVerify={() => void action(async () => { await client().markContactVerified(peer.userId); setSafetyOpen(false); })} />}
    <MessageActions target={selected} onClose={() => setSelected(undefined)} onError={setError} onDelete={deleteMessage} onReact={blockedPeer ? undefined : (target, emoji) => react(target, emoji)}
      onReply={startReply}
      onEdit={target => { if (!editing) unsentDraft.current = draft; setAttachments(false); setReplying(undefined); setEditing(target.id); setDraft(replyBody(target.text ?? '')); }} />
    {identity && <SafetyMenu visible={safetyMenuOpen} group={group} title={conversation.title} targetId={conversation.id}
      peer={!group && peer ? { userId: peer.userId, displayName: peer.displayName } : undefined} blocked={snapshot.blockedContacts}
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
