import { useState } from 'react';
import { router } from 'expo-router';
import { FlatList, Pressable, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Avatar, Empty, Icon, IconButton, ScreenHeader, time } from '../../components/ui';
import { useMessenger } from '../../runtime';
import { colors, styles } from '../../styles';
import { chatTimeline } from '../../timeline-model';
import { mediaKind } from '../../media-model';
export default function Chats() {
  const { snapshot, identity } = useMessenger();
  const [query, setQuery] = useState('');
  const conversations = [...snapshot.conversations].sort((a, b) => b.updatedAt - a.updatedAt).filter(item => item.title.toLocaleLowerCase('ru-RU').includes(query.toLocaleLowerCase('ru-RU')));
  return <SafeAreaView style={styles.whiteScreen} edges={['top']}>
    <ScreenHeader title="Чаты" subtitle={snapshot.status === 'online' ? undefined : snapshot.status === 'connecting' ? 'Соединяемся…' : 'Ожидание сети…'} action={<IconButton name="create-outline" label="Новый чат" onPress={() => router.push('/(tabs)/contacts')} />} />
    <View style={styles.search}><Icon name="search" color={colors.secondary} size={19} /><TextInput style={styles.searchInput} placeholder="Поиск" placeholderTextColor={colors.secondary} value={query} onChangeText={setQuery} accessibilityLabel="Поиск по чатам" /></View>
    <FlatList data={conversations} keyExtractor={item => item.id} keyboardShouldPersistTaps="handled" ItemSeparatorComponent={() => <View style={styles.separator} />}
      ListEmptyComponent={<Empty icon="chatbubbles-outline" title={query ? 'Ничего не найдено' : 'Ваши разговоры'} text={query ? 'Попробуйте другое название чата.' : 'Найдите друга по @username и начните переписку.'} />}
      renderItem={({ item }) => {
        const peer = snapshot.contacts.find(contact => item.memberIds.includes(contact.userId) && contact.userId !== identity?.userId);
        const latest = chatTimeline(item.messages, item.files).at(-1);
        const message = latest?.kind === 'message' ? latest.item : undefined;
        const file = latest?.kind === 'attachment' ? latest.item : undefined;
        const kind = file && mediaKind(file.name, file.mime);
        const preview = message ? `${message.from === identity?.userId ? 'Вы: ' : ''}${message.text}` : file ? `${file.senderId === identity?.userId ? 'Вы: ' : ''}${kind === 'voice' ? 'Голосовое сообщение' : kind === 'circle' ? 'Видеокружок' : `Файл: ${file.name}`}` : item.kind === 'group' ? `${item.memberIds.length} участников` : 'Начните разговор';
        return <Pressable accessibilityRole="button" accessibilityLabel={`Чат ${item.title}`} onPress={() => router.push({ pathname: '/chat/[id]', params: { id: item.id } })} style={({ pressed }) => [styles.listRow, pressed && styles.pressed]}>
          <Avatar name={item.title} id={item.id} online={item.kind === 'direct' && peer?.online} group={item.kind === 'group'} />
          <View style={styles.rowBody}><Text numberOfLines={1} style={styles.rowName}>{item.title}</Text><Text numberOfLines={1} style={[styles.rowText, item.unread > 0 && { color: colors.text }]}>{preview}</Text></View>
          <View style={{ alignSelf: 'flex-start', paddingTop: 3 }}><Text style={styles.time}>{item.updatedAt ? time(item.updatedAt) : ''}</Text>{item.unread > 0 && <View style={styles.unread}><Text style={styles.unreadText}>{item.unread > 99 ? '99+' : item.unread}</Text></View>}</View>
        </Pressable>;
      }} />
  </SafeAreaView>;
}
