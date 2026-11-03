import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { router, useIsFocused } from 'expo-router';
import { ActivityIndicator, AppState, FlatList, Pressable, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { DirectoryUser } from '@messenger/core';
import { Avatar, Button, Empty, Icon, IconButton, ScreenHeader, lastSeen } from '../../components/ui';
import { CatalogController, catalogQuery } from '../../catalog-model';
import { client, errorText, useMessenger } from '../../runtime';
import { colors, styles } from '../../styles';
import { intlLocale, t } from '../../i18n';
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
    <ScreenHeader title={t('Contacts')} action={<IconButton name="refresh" label={t('Refresh directory')} disabled={!online || state.busy} onPress={() => void catalog.load()} />} />
    <View style={styles.search}><Icon name="search" color={colors.secondary} size={19} /><TextInput style={styles.searchInput} placeholder={t('Name or @username')} placeholderTextColor={colors.secondary} value={query} onChangeText={value => { setQuery(value); catalog.setQuery(value); setError(''); }} maxLength={49} autoCapitalize="none" autoCorrect={false} accessibilityLabel={t('Search by name or username')} />{state.busy && <ActivityIndicator color={colors.accent} />}</View>
    <Pressable style={styles.listRow} accessibilityRole="button" onPress={() => router.push('/new-group')}><View style={[styles.avatar, { backgroundColor: '#E2F2EB' }]}><Icon name="people-outline" /></View><Text style={[styles.rowName, { color: colors.accent }]}> {t('Create group')}</Text></Pressable>
    {!online && <Text style={[styles.info, { margin: 18 }]}> {t('No connection to the server. The directory is not updated; saved chats are available in the Chats tab.')}</Text>}
    {!!(error || state.error) && <Text style={[styles.error, { marginHorizontal: 16, marginVertical: 8 }]}>{error || state.error}</Text>}
    <Text style={[styles.sectionTitle, { marginTop: 12 }]}>{normalized ? t('SEARCH RESULTS') : t('SERVER USERS')}</Text>
    <Text style={[styles.info, { marginHorizontal: 18, marginBottom: 12 }]}> {t('The directory does not add people to your contacts automatically. Choose a person to open a chat.')}{state.updatedAt ? ` ${t('Updated {time}.', { time: new Date(state.updatedAt).toLocaleTimeString(intlLocale, { hour: '2-digit', minute: '2-digit' }) })}` : ''}</Text>
    <FlatList data={state.users} keyExtractor={item => item.userId} keyboardShouldPersistTaps="handled" ItemSeparatorComponent={() => <View style={styles.separator} />}
      refreshing={state.busy} onRefresh={() => { if (online) void catalog.load(); }}
      ListEmptyComponent={!state.busy ? <Empty icon="people-outline" title={normalized ? t('User not found') : online ? t('The directory is empty') : t('Directory unavailable')} text={normalized ? t('Check the name or username. Display names may repeat; verify the @username.') : t('Registered server users will appear here after you connect.')} /> : undefined}
      ListFooterComponent={state.nextCursor && !normalized ? <View style={styles.content}><Button title={t('Load more')} secondary busy={state.busy} disabled={!online} onPress={() => void catalog.load(true)} /></View> : undefined}
      renderItem={({ item }) => <Pressable accessibilityRole="button" accessibilityLabel={t('Open chat with {name}, @{username}', { name: item.displayName, username: item.username })} disabled={!!opening} onPress={() => void open(item)} style={({ pressed }) => [styles.listRow, pressed && styles.pressed]}>
        <Avatar name={item.displayName} id={item.userId} online={item.online} /><View style={styles.rowBody}><Text style={styles.rowName}>{item.displayName}</Text><Text style={[styles.rowText, item.online && online && { color: colors.accent }]}>@{item.username} · {online ? lastSeen(item.online, item.lastSeen) : t('status not updated')}{saved.has(item.userId) ? ` · ${t('your contact')}` : ''}</Text></View>
        {opening === item.userId ? <ActivityIndicator color={colors.accent} /> : <Icon name="chatbubble-outline" size={21} color={colors.secondary} />}
      </Pressable>} />
  </SafeAreaView>;
}
