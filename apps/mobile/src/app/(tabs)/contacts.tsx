import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { router, useIsFocused } from 'expo-router';
import { ActivityIndicator, AppState, FlatList, Pressable, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { DirectoryUser } from '@messenger/core';
import { Avatar, Button, Empty, Icon, IconButton, ScreenHeader, lastSeen } from '../../components/ui';
import { CatalogController, catalogQuery } from '../../catalog-model';
import { client, errorText, useMessenger } from '../../runtime';
import { colors, styles } from '../../styles';
export default function Contacts() {
  const { profile, identity } = useMessenger();
  return <ContactDirectory key={`${profile?.serverUrl}:${identity?.userId}`} />;
}
function ContactDirectory() {
  const { snapshot, identity } = useMessenger();
  const current = client();
  const catalog = useMemo(() => new CatalogController(current, identity?.userId ?? ''), [current, identity?.userId]);
  const state = useSyncExternalStore(catalog.subscribe, catalog.snapshot);
  const [query, setQuery] = useState('');
  const [opening, setOpening] = useState('');
  const [error, setError] = useState('');
  const focused = useIsFocused();
  const openingGuard = useRef(false);
  const normalized = catalogQuery(query);
  const online = snapshot.status === 'online';
  useEffect(() => {
    if (!focused || !online) { catalog.cancel(); return; }
    let timer: ReturnType<typeof setTimeout> | undefined;
    let interval: ReturnType<typeof setInterval> | undefined;
    const stop = () => { clearTimeout(timer); clearInterval(interval); catalog.cancel(); };
    const start = (debounced: boolean) => {
      stop();
      if (AppState.currentState !== 'active') return;
      timer = setTimeout(() => { void catalog.load(); }, debounced && !!normalized ? 350 : 0);
      interval = setInterval(() => { if (AppState.currentState === 'active') void catalog.load(); }, 30_000);
    };
    start(true);
    const resume = AppState.addEventListener('change', value => { if (value === 'active') start(false); else stop(); });
    return () => { resume.remove(); stop(); };
  }, [catalog, focused, online, normalized]);
  async function open(user: DirectoryUser) {
    if (openingGuard.current) return;
    openingGuard.current = true; setOpening(user.userId); setError('');
    try { const id = await current.addContact(user); if (current === client()) router.push({ pathname: '/chat/[id]', params: { id } }); }
    catch (cause) { setError(errorText(cause)); } finally { openingGuard.current = false; setOpening(''); }
  }
  const saved = new Set(snapshot.contacts.map(user => user.userId));
  return <SafeAreaView style={styles.whiteScreen} edges={['top']}>
    <ScreenHeader title="Контакты" action={<IconButton name="refresh" label="Обновить каталог" disabled={!online || state.busy} onPress={() => void catalog.load()} />} />
    <View style={styles.search}><Icon name="search" color={colors.secondary} size={19} /><TextInput style={styles.searchInput} placeholder="Имя или @логин" placeholderTextColor={colors.secondary} value={query} onChangeText={value => { setQuery(value); catalog.setQuery(value); setError(''); }} maxLength={49} autoCapitalize="none" autoCorrect={false} accessibilityLabel="Поиск по имени или логину" />{state.busy && <ActivityIndicator color={colors.accent} />}</View>
    <Pressable style={styles.listRow} accessibilityRole="button" onPress={() => router.push('/new-group')}><View style={[styles.avatar, { backgroundColor: '#E2F2EB' }]}><Icon name="people-outline" /></View><Text style={[styles.rowName, { color: colors.accent }]}>Создать группу</Text></Pressable>
    {!online && <Text style={[styles.info, { margin: 18 }]}>Нет связи с сервером. Каталог не обновляется; сохранённые чаты доступны на вкладке «Чаты».</Text>}
    {!!(error || state.error) && <Text style={[styles.error, { marginHorizontal: 16, marginVertical: 8 }]}>{error || state.error}</Text>}
    <Text style={[styles.sectionTitle, { marginTop: 12 }]}>{normalized ? 'РЕЗУЛЬТАТЫ ПОИСКА' : 'ПОЛЬЗОВАТЕЛИ СЕРВЕРА'}</Text>
    <Text style={[styles.info, { marginHorizontal: 18, marginBottom: 12 }]}>Каталог не добавляет людей в ваши контакты автоматически. Выберите человека, чтобы открыть чат.{state.updatedAt ? ` Обновлено ${new Date(state.updatedAt).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' })}.` : ''}</Text>
    <FlatList data={state.users} keyExtractor={item => item.userId} keyboardShouldPersistTaps="handled" ItemSeparatorComponent={() => <View style={styles.separator} />}
      refreshing={state.busy} onRefresh={() => { if (online) void catalog.load(); }}
      ListEmptyComponent={!state.busy ? <Empty icon="people-outline" title={normalized ? 'Пользователь не найден' : online ? 'Каталог пока пуст' : 'Каталог недоступен'} text={normalized ? 'Проверьте имя или логин. Имена могут повторяться — сверяйте @логин.' : 'После подключения здесь появятся зарегистрированные пользователи сервера.'} /> : undefined}
      ListFooterComponent={state.nextCursor && !normalized ? <View style={styles.content}><Button title="Загрузить ещё" secondary busy={state.busy} disabled={!online} onPress={() => void catalog.load(true)} /></View> : undefined}
      renderItem={({ item }) => <Pressable accessibilityRole="button" accessibilityLabel={`Открыть чат с ${item.displayName}, @${item.username}`} disabled={!!opening} onPress={() => void open(item)} style={({ pressed }) => [styles.listRow, pressed && styles.pressed]}>
        <Avatar name={item.displayName} id={item.userId} online={item.online} /><View style={styles.rowBody}><Text style={styles.rowName}>{item.displayName}</Text><Text style={[styles.rowText, item.online && online && { color: colors.accent }]}>@{item.username} · {online ? lastSeen(item.online, item.lastSeen) : 'статус не обновлён'}{saved.has(item.userId) ? ' · ваш контакт' : ''}</Text></View>
        {opening === item.userId ? <ActivityIndicator color={colors.accent} /> : <Icon name="chatbubble-outline" size={21} color={colors.secondary} />}
      </Pressable>} />
  </SafeAreaView>;
}
