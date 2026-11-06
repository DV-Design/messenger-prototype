import { useState } from 'react';
import { router } from 'expo-router';
import { Alert, FlatList, Pressable, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from '../../components/SafeArea';
import { Avatar, Empty, Icon, IconButton, ScreenHeader, time } from '../../components/ui';
import { AccountMovedNotice } from '../../components/AccountMovedNotice';
import { shouldShowEmailReminder } from '../../email-flow-model';
import { client, dismissEmailReminder, errorText, useMessenger } from '../../runtime';
import { colors, styles } from '../../styles';
import { chatTimeline } from '../../timeline-model';
import { mediaKind } from '../../media-model';
import { intlLocale, t } from '../../i18n';
export default function Chats() {
  const { snapshot, identity, profile, boundEmail, emailReminderDismissed, retired } = useMessenger();
  const [query, setQuery] = useState('');
  const blocked = new Set(snapshot.blockedContacts);
  const conversations = [...snapshot.conversations].filter(item => !item.hidden).sort((a, b) => b.updatedAt - a.updatedAt)
    .filter(item => item.kind === 'group' || !item.memberIds.some(id => id !== identity?.userId && blocked.has(id)))
    .filter(item => item.title.toLocaleLowerCase(intlLocale).includes(query.toLocaleLowerCase(intlLocale)));
  function confirmDelete(id: string, title: string, group: boolean) {
    Alert.alert(t('Delete chat with {title}?', { title }), group ? t('The history is removed from this phone. New messages from members bring the chat back; leaving a group is not available yet.') : t('The history is removed from this phone. The chat stays on the other person\'s device.'), [
      { text: t('Cancel'), style: 'cancel' },
      { text: t('Delete'), style: 'destructive', onPress: () => void client().deleteChat(id).catch(cause => Alert.alert(t('Could not delete the chat'), errorText(cause))) },
    ]);
  }
  return <SafeAreaView style={styles.whiteScreen} edges={['top']}>
    <ScreenHeader title={t('Chats')} subtitle={retired ? undefined : snapshot.status === 'online' ? undefined : snapshot.status === 'connecting' ? t('Connecting…') : t('Waiting for network…')} action={<IconButton name="create-outline" label={t('New chat')} onPress={() => router.push('/(tabs)/contacts')} />} />
    {retired && <AccountMovedNotice />}
    {shouldShowEmailReminder({ bound: boundEmail, serverUrl: profile?.serverUrl, dismissed: emailReminderDismissed, status: snapshot.status, retired }) && <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingLeft: 15, paddingRight: 4, paddingVertical: 4, backgroundColor: '#FFF6E4' }}>
      <Pressable accessibilityRole="button" accessibilityLabel={t('Add an email in settings')} onPress={() => router.push('/(tabs)/settings')} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 }}><Icon name="mail-outline" size={17} color="#7B5924" /><Text style={[styles.info, { flex: 1, color: '#7B5924' }]}>{t('Add an email: without it you lose this account if you reinstall the app.')}</Text></Pressable>
      <IconButton name="close" label={t('Not now')} onPress={dismissEmailReminder} />
    </View>}
    <View style={styles.search}><Icon name="search" color={colors.secondary} size={19} /><TextInput style={styles.searchInput} placeholder={t('Search')} placeholderTextColor={colors.secondary} value={query} onChangeText={setQuery} accessibilityLabel={t('Search chats')} /></View>
    <FlatList data={conversations} keyExtractor={item => item.id} keyboardShouldPersistTaps="handled" ItemSeparatorComponent={() => <View style={styles.separator} />}
      ListEmptyComponent={<Empty icon="chatbubbles-outline" title={query ? t('Nothing found') : t('Your conversations')} text={query ? t('Try another chat name.') : t('Find a friend by @username and start a conversation.')} />}
      renderItem={({ item }) => {
        const peer = snapshot.contacts.find(contact => item.memberIds.includes(contact.userId) && contact.userId !== identity?.userId);
        const latest = chatTimeline(item.messages.filter(message => !blocked.has(message.from)), item.files.filter(file => !blocked.has(file.senderId))).at(-1);
        const message = latest?.kind === 'message' ? latest.item : undefined;
        const file = latest?.kind === 'attachment' ? latest.item : undefined;
        const kind = file && mediaKind(file.name, file.mime);
        const preview = message ? `${message.from === identity?.userId ? t('You: ') : ''}${message.text}` : file ? `${file.senderId === identity?.userId ? t('You: ') : ''}${kind === 'voice' ? t('Voice message') : kind === 'circle' ? t('Video circle') : t('File: {name}', { name: file.name })}` : item.kind === 'group' ? t('Members: {count}', { count: item.memberIds.length }) : t('Start a conversation');
        return <Pressable accessibilityRole="button" accessibilityLabel={t('Chat {title}', { title: item.title })} accessibilityHint={t('Hold to delete the chat')} accessibilityActions={[{ name: 'longpress', label: t('Delete chat') }]} onAccessibilityAction={() => confirmDelete(item.id, item.title, item.kind === 'group')} onLongPress={() => confirmDelete(item.id, item.title, item.kind === 'group')} onPress={() => router.push({ pathname: '/chat/[id]', params: { id: item.id } })} style={({ pressed }) => [styles.listRow, pressed && styles.pressed]}>
          <Avatar name={item.title} id={item.id} online={item.kind === 'direct' && peer?.online} group={item.kind === 'group'} />
          <View style={styles.rowBody}><Text numberOfLines={1} style={styles.rowName}>{item.title}</Text><Text numberOfLines={1} style={[styles.rowText, item.unread > 0 && { color: colors.text }]}>{preview}</Text></View>
          <View style={{ alignSelf: 'flex-start', paddingTop: 3 }}><Text style={styles.time}>{item.updatedAt ? time(item.updatedAt) : ''}</Text>{item.unread > 0 && <View style={styles.unread}><Text style={styles.unreadText}>{item.unread > 99 ? '99+' : item.unread}</Text></View>}</View>
        </Pressable>;
      }} />
  </SafeAreaView>;
}
