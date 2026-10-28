import { useEffect, useState } from 'react';
import { router } from 'expo-router';
import { ActivityIndicator, FlatList, Pressable, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { DirectoryUser } from '@messenger/core';
import { Avatar, Empty, Icon, IconButton, ScreenHeader, lastSeen } from '../../components/ui';
import { client, errorText, useMessenger } from '../../runtime';
import { colors, styles } from '../../styles';
export default function Contacts() {
  const { snapshot, identity } = useMessenger();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<DirectoryUser[]>([]);
  const [searching, setSearching] = useState(false);
  const [opening, setOpening] = useState('');
  const [error, setError] = useState('');
  const normalized = query.trim().replace(/^@/, '').toLowerCase();
  useEffect(() => {
    let valid = true;
    if (!normalized || snapshot.status !== 'online') return;
    const timer = setTimeout(() => {
      setSearching(true); setError('');
      void Promise.resolve().then(() => client().search(normalized)).then(users => { if (valid) setResults(users.filter(user => user.userId !== identity?.userId)); })
        .catch(cause => { if (valid) setError(errorText(cause)); }).finally(() => { if (valid) setSearching(false); });
    }, 350);
    return () => { valid = false; clearTimeout(timer); };
  }, [normalized, snapshot.status, identity?.userId]);
  async function open(user: DirectoryUser) {
    if (opening) return;
    setOpening(user.userId); setError('');
    try { const id = await client().addContact(user); router.push({ pathname: '/chat/[id]', params: { id } }); }
    catch (cause) { setError(errorText(cause)); } finally { setOpening(''); }
  }
  const users = normalized ? results : [...snapshot.contacts].sort((a, b) => a.displayName.localeCompare(b.displayName, 'ru'));
  return <SafeAreaView style={styles.whiteScreen} edges={['top']}>
    <ScreenHeader title="Контакты" action={<IconButton name="people-circle-outline" label="Создать группу" onPress={() => router.push('/new-group')} />} />
    <View style={styles.search}><Icon name="search" color={colors.secondary} size={19} /><TextInput style={styles.searchInput} placeholder="Найти по @username" placeholderTextColor={colors.secondary} value={query} onChangeText={value => { setQuery(value); setResults([]); setSearching(!!value.trim()); setError(''); }} maxLength={25} autoCapitalize="none" autoCorrect={false} accessibilityLabel="Поиск по имени пользователя" />{searching && snapshot.status === 'online' && <ActivityIndicator color={colors.accent} />}</View>
    <Pressable style={styles.listRow} accessibilityRole="button" onPress={() => router.push('/new-group')}><View style={[styles.avatar, { backgroundColor: '#E2F2EB' }]}><Icon name="people-outline" /></View><Text style={[styles.rowName, { color: colors.accent }]}>Создать группу</Text></Pressable>
    <Pressable style={styles.listRow} accessibilityRole="button" onPress={() => router.push('/phone')}><View style={[styles.avatar, { backgroundColor: '#E2F2EB' }]}><Icon name="call-outline" /></View><View style={styles.rowBody}><Text style={styles.rowName}>Найти по номерам телефона</Text><Text style={styles.rowText}>Подтвердить номер и включить автопоиск</Text></View><Icon name="chevron-forward" size={18} color={colors.secondary} /></Pressable>
    <Pressable style={styles.listRow} accessibilityRole="button" onPress={() => router.push('/phonebook')}><View style={[styles.avatar, { backgroundColor: '#E9F1F7' }]}><Icon name="book-outline" /></View><View style={styles.rowBody}><Text style={styles.rowName}>Контакты телефона</Text><Text style={styles.rowText}>Обновить и связать с профилями LastCall</Text></View><Icon name="chevron-forward" size={18} color={colors.secondary} /></Pressable>
    {!!error && <Text style={[styles.error, { marginHorizontal: 16, marginVertical: 8 }]}>{error}</Text>}
    {!!normalized && snapshot.status !== 'online' && <Text style={[styles.info, { marginHorizontal: 18 }]}>Поиск заработает после подключения к серверу.</Text>}
    <Text style={[styles.sectionTitle, { marginTop: 12 }]}>{normalized ? 'РЕЗУЛЬТАТЫ ПОИСКА' : 'ВАШИ КОНТАКТЫ'}</Text>
    <FlatList data={users} keyExtractor={item => item.userId} keyboardShouldPersistTaps="handled" ItemSeparatorComponent={() => <View style={styles.separator} />}
      ListEmptyComponent={!searching ? <Empty icon="person-add-outline" title={normalized ? 'Пользователь не найден' : 'Добавьте друзей'} text={normalized ? 'Проверьте имя пользователя или попросите друга создать профиль.' : 'Введите имя пользователя друга в поиск. Затем откройте чат — контакт сохранится.'} /> : undefined}
      renderItem={({ item }) => <Pressable accessibilityRole="button" accessibilityLabel={`Открыть чат с ${item.displayName}`} disabled={!!opening} onPress={() => void open(item)} style={({ pressed }) => [styles.listRow, pressed && styles.pressed]}>
        <Avatar name={item.displayName} id={item.userId} online={item.online} /><View style={styles.rowBody}><Text style={styles.rowName}>{item.displayName}</Text><Text style={[styles.rowText, item.online && { color: colors.accent }]}>@{item.username} · {lastSeen(item.online, item.lastSeen)}</Text></View>
        {opening === item.userId ? <ActivityIndicator color={colors.accent} /> : <Icon name="chatbubble-outline" size={21} color={colors.secondary} />}
      </Pressable>} />
  </SafeAreaView>;
}
