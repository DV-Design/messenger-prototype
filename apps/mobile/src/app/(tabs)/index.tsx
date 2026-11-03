import { useState } from 'react';
import { router } from 'expo-router';
import { FlatList, Pressable, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Avatar, Empty, Icon, IconButton, ScreenHeader, time } from '../../components/ui';
import { useMessenger } from '../../runtime';
import { colors, styles } from '../../styles';
import { chatTimeline } from '../../timeline-model';
import { mediaKind } from '../../media-model';
import { intlLocale, t } from '../../i18n';
export default function Chats() {
  const { snapshot, identity } = useMessenger();
  const [query, setQuery] = useState('');
  const conversations = [...snapshot.conversations].sort((a, b) => b.updatedAt - a.updatedAt).filter(item => item.title.toLocaleLowerCase(intlLocale).includes(query.toLocaleLowerCase(intlLocale)));
  return <SafeAreaView style={styles.whiteScreen} edges={['top']}>
    <ScreenHeader title={t('Chats')} subtitle={snapshot.status === 'online' ? undefined : snapshot.status === 'connecting' ? t('Connecting…') : t('Waiting for network…')} action={<IconButton name="create-outline" label={t('New chat')} onPress={() => router.push('/(tabs)/contacts')} />} />
    <View style={styles.search}><Icon name="search" color={colors.secondary} size={19} /><TextInput style={styles.searchInput} placeholder={t('Search')} placeholderTextColor={colors.secondary} value={query} onChangeText={setQuery} accessibilityLabel={t('Search chats')} /></View>
    <FlatList data={conversations} keyExtractor={item => item.id} keyboardShouldPersistTaps="handled" ItemSeparatorComponent={() => <View style={styles.separator} />}
      ListEmptyComponent={<Empty icon="chatbubbles-outline" title={query ? t('Nothing found') : t('Your conversations')} text={query ? t('Try another chat name.') : t('Find a friend by @username and start a conversation.')} />}
      renderItem={({ item }) => {
        const peer = snapshot.contacts.find(contact => item.memberIds.includes(contact.userId) && contact.userId !== identity?.userId);
        const latest = chatTimeline(item.messages, item.files).at(-1);
        const message = latest?.kind === 'message' ? latest.item : undefined;
        const file = latest?.kind === 'attachment' ? latest.item : undefined;
        const kind = file && mediaKind(file.name, file.mime);
        const preview = message ? `${message.from === identity?.userId ? t('You: ') : ''}${message.text}` : file ? `${file.senderId === identity?.userId ? t('You: ') : ''}${kind === 'voice' ? t('Voice message') : kind === 'circle' ? t('Video circle') : t('File: {name}', { name: file.name })}` : item.kind === 'group' ? t('Members: {count}', { count: item.memberIds.length }) : t('Start a conversation');
        return <Pressable accessibilityRole="button" accessibilityLabel={t('Chat {title}', { title: item.title })} onPress={() => router.push({ pathname: '/chat/[id]', params: { id: item.id } })} style={({ pressed }) => [styles.listRow, pressed && styles.pressed]}>
          <Avatar name={item.title} id={item.id} online={item.kind === 'direct' && peer?.online} group={item.kind === 'group'} />
          <View style={styles.rowBody}><Text numberOfLines={1} style={styles.rowName}>{item.title}</Text><Text numberOfLines={1} style={[styles.rowText, item.unread > 0 && { color: colors.text }]}>{preview}</Text></View>
          <View style={{ alignSelf: 'flex-start', paddingTop: 3 }}><Text style={styles.time}>{item.updatedAt ? time(item.updatedAt) : ''}</Text>{item.unread > 0 && <View style={styles.unread}><Text style={styles.unreadText}>{item.unread > 99 ? '99+' : item.unread}</Text></View>}</View>
        </Pressable>;
      }} />
  </SafeAreaView>;
}
