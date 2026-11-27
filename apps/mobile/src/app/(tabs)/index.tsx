import { richPreview } from '../../sticker-model';
import { knownSticker } from '../../stickers';
import { memo, useEffect, useState } from 'react';
import { router } from 'expo-router';
import { ActivityIndicator, Alert, FlatList, Pressable, Text, TextInput, View } from 'react-native';
import type { MessengerSnapshot } from '@messenger/core';
import { SafeAreaView } from '../../components/SafeArea';
import { Avatar, Empty, Icon, IconButton, ScreenHeader, time } from '../../components/ui';
import { AccountMovedNotice } from '../../components/AccountMovedNotice';
import { shouldShowEmailReminder } from '../../email-flow-model';
import { client, dismissEmailReminder, errorText, refreshPhoneState, useMessenger } from '../../runtime';
import { colors, styles } from '../../styles';
import { latestEntry } from '../../timeline-model';
import { mediaKind } from '../../media-model';
import { intlLocale, t } from '../../i18n';

type MessengerConversation = MessengerSnapshot['conversations'][number];

function confirmDelete(id: string, title: string, group: boolean) {
  Alert.alert(t('Delete chat with {title}?', { title }), group ? t('The history is removed from this phone. New messages from members bring the chat back; leaving a group is not available yet.') : t('The history is removed from this phone. The chat stays on the other person\'s device.'), [
    { text: t('Cancel'), style: 'cancel' },
    { text: t('Delete'), style: 'destructive', onPress: () => void client().deleteChat(id).catch(cause => Alert.alert(t('Could not delete the chat'), errorText(cause))) },
  ]);
}

/** The list's last-message line, worked out again only when that chat's history changes. */
const previews = new WeakMap<object, { files: object; key: string; text: string }>();
function chatPreview(item: MessengerConversation, blockedKey: string, own: string | undefined): string {
  const key = `${blockedKey}|${own}|${item.kind}|${item.memberIds.length}`;
  const cached = previews.get(item.messages);
  if (cached && cached.files === item.files && cached.key === key) return cached.text;
  const blocked = new Set(blockedKey ? blockedKey.split(',') : []);
  const latest = latestEntry(item.messages.filter(message => !blocked.has(message.from)), item.files.filter(file => !blocked.has(file.senderId)));
  const message = latest?.kind === 'message' ? latest.item : undefined;
  const file = latest?.kind === 'attachment' ? latest.item : undefined;
  const kind = file && mediaKind(file.name, file.mime);
  const text = message ? `${message.from === own ? t('You: ') : ''}${richPreview(message.text, knownSticker, { sticker: t('Sticker'), gif: t('GIF') }) ?? message.text}` : file ? `${file.senderId === own ? t('You: ') : ''}${kind === 'voice' ? t('Voice message') : kind === 'circle' ? t('Video circle') : t('File: {name}', { name: file.name })}` : item.kind === 'group' ? t('Members: {count}', { count: item.memberIds.length }) : t('Start a conversation');
  previews.set(item.messages, { files: item.files, key, text });
  return text;
}

/** Plain values only, so a row redraws when what it shows changes, not on every update. */
const ChatListRow = memo(function ChatListRow({ id, title, group, online, unread, updatedAt, preview, draft }: { id: string; title: string; group: boolean; online: boolean; unread: number; updatedAt: number; preview: string; draft?: string }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={t('Chat {title}', { title })} accessibilityHint={t('Hold to delete the chat')} accessibilityActions={[{ name: 'longpress', label: t('Delete chat') }]} onAccessibilityAction={() => confirmDelete(id, title, group)} onLongPress={() => confirmDelete(id, title, group)} onPress={() => router.push({ pathname: '/chat/[id]', params: { id } })} style={({ pressed }) => [styles.listRow, pressed && styles.pressed]}>
    <Avatar name={title} id={id} online={!group && online} group={group} />
    <View style={styles.rowBody}><Text numberOfLines={1} style={styles.rowName}>{title}</Text><Text numberOfLines={1} style={[styles.rowText, unread > 0 && { color: colors.text }]}>{draft ? <><Text style={{ color: colors.danger }}>{t('Draft:')} </Text>{draft.replace(/\s+/g, ' ')}</> : preview}</Text></View>
    <View style={{ alignSelf: 'flex-start', paddingTop: 3 }}><Text style={styles.time}>{updatedAt ? time(updatedAt) : ''}</Text>{unread > 0 && <View style={styles.unread}><Text style={styles.unreadText}>{unread > 99 ? '99+' : unread}</Text></View>}</View>
  </Pressable>;
});

const Separator = () => <View style={styles.separator} />;

export default function Chats() {
  const { snapshot, identity, profile, boundEmail, emailReminderDismissed, retired, phone } = useMessenger();
  // A number linked through Telegram restores the account too, so the email reminder is not needed then.
  useEffect(() => { if (snapshot.status === 'online' && phone === undefined) void refreshPhoneState(); }, [snapshot.status, phone]);
  const [query, setQuery] = useState('');
  const blockedKey = snapshot.blockedContacts.join(',');
  const blocked = new Set(snapshot.blockedContacts);
  const conversations = [...snapshot.conversations].filter(item => !item.hidden).sort((a, b) => b.updatedAt - a.updatedAt)
    .filter(item => item.kind === 'group' || !item.memberIds.some(id => id !== identity?.userId && blocked.has(id)))
    .filter(item => item.title.toLocaleLowerCase(intlLocale).includes(query.toLocaleLowerCase(intlLocale)));
  return <SafeAreaView style={styles.whiteScreen} edges={['top']}>
    <ScreenHeader title={t('Chats')} subtitle={retired ? undefined : snapshot.status === 'online' ? undefined : snapshot.status === 'connecting' ? t('Connecting…') : t('Waiting for network…')} action={<IconButton name="create-outline" label={t('New chat')} onPress={() => router.push('/(tabs)/contacts')} />} />
    {retired && <AccountMovedNotice />}
    {phone !== undefined && !phone?.phone && shouldShowEmailReminder({ bound: boundEmail, serverUrl: profile?.serverUrl, dismissed: emailReminderDismissed, status: snapshot.status, retired }) && <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingLeft: 15, paddingRight: 4, paddingVertical: 4, backgroundColor: '#FFF6E4' }}>
      <Pressable accessibilityRole="button" accessibilityLabel={t('Add an email in settings')} onPress={() => router.push('/(tabs)/settings')} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 }}><Icon name="mail-outline" size={17} color="#7B5924" /><Text style={[styles.info, { flex: 1, color: '#7B5924' }]}>{t('Add an email: without it you lose this account if you reinstall the app.')}</Text></Pressable>
      <IconButton name="close" label={t('Not now')} onPress={dismissEmailReminder} />
    </View>}
    {!!snapshot.messageRequests?.length && <Pressable accessibilityRole="button" accessibilityLabel={t('Message requests: {count}', { count: snapshot.messageRequests.length })} onPress={() => router.push('/requests')}
      style={({ pressed }) => [styles.listRow, pressed && { backgroundColor: '#EEF3F1' }]}>
      <Icon name="mail-unread-outline" size={26} />
      <View style={styles.rowBody}><Text style={styles.rowName}>{t('Message requests')}</Text><Text style={styles.rowText}>{t('People who are not in your contacts wrote to you')}</Text></View>
      <View style={{ minWidth: 24, paddingHorizontal: 7, height: 24, borderRadius: 12, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: colors.white, fontWeight: '700' }}>{snapshot.messageRequests.length}</Text></View>
    </Pressable>}
    <View style={styles.search}><Icon name="search" color={colors.secondary} size={19} /><TextInput style={styles.searchInput} placeholder={t('Search')} placeholderTextColor={colors.secondary} value={query} onChangeText={setQuery} accessibilityLabel={t('Search chats')} /></View>
    <FlatList data={conversations} keyExtractor={item => item.id} keyboardShouldPersistTaps="handled" ItemSeparatorComponent={Separator}
      // Until the encrypted history is read, an empty list is "loading", not "no chats yet".
      ListEmptyComponent={!query && snapshot.restored === false ? <ActivityIndicator color={colors.accent} style={{ marginTop: 48 }} /> : <Empty icon="chatbubbles-outline" title={query ? t('Nothing found') : t('Your conversations')} text={query ? t('Try another chat name.') : t('Find a friend by @username and start a conversation.')} />}
      renderItem={({ item }) => {
        const peer = item.kind === 'direct' ? snapshot.contacts.find(contact => item.memberIds.includes(contact.userId) && contact.userId !== identity?.userId) : undefined;
        return <ChatListRow id={item.id} title={item.title} group={item.kind === 'group'} online={!!peer?.online} unread={item.unread} updatedAt={item.updatedAt}
          preview={chatPreview(item, blockedKey, identity?.userId)} draft={item.draft} />;
      }} />
  </SafeAreaView>;
}
