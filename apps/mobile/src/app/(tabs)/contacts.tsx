import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { router, useIsFocused } from 'expo-router';
import { ActivityIndicator, Alert, FlatList, Pressable, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { DirectoryUser } from '@messenger/core';
import { Avatar, Empty, Icon, IconButton, ScreenHeader, lastSeen } from '../../components/ui';
import { CatalogController, catalogQuery, searchable } from '../../catalog-model';
import { myContacts } from '../../message-actions-model';
import { client, errorText, useMessenger } from '../../runtime';
import { colors, styles } from '../../styles';
import { intlLocale, t } from '../../i18n';
/** The server returns at most this many matches; reaching it means the query is too broad. */
const DIRECTORY_SEARCH_SHOWN = 30;
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
  const [browsing, setBrowsing] = useState(false);
  const [opening, setOpening] = useState('');
  const [error, setError] = useState('');
  const focused = useIsFocused();
  const openingGuard = useRef(false);
  const normalized = catalogQuery(query);
  const searching = searchable(normalized);
  const online = snapshot.status === 'online';
  // The server directory is fetched only on request: a search, the button, a pull or the end of the list.
  const showsDirectory = searching || (browsing && !normalized);
  useEffect(() => {
    if (!focused || !online || !showsDirectory) { catalog.cancel(); return; }
    if (!searching && state.users.length) return;
    const timer = setTimeout(() => { void catalog.load(); }, searching ? 400 : 0);
    return () => { clearTimeout(timer); catalog.cancel(); };
    // state.users is read only to skip a reload of a list that is already on screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalog, focused, online, showsDirectory, searching, normalized]);
  async function open(user: DirectoryUser) {
    if (openingGuard.current) return;
    openingGuard.current = true; setOpening(user.userId); setError('');
    try { const id = await current.addContact(user); if (current === client()) router.push({ pathname: '/chat/[id]', params: { id } }); }
    catch (cause) { setError(errorText(cause)); } finally { openingGuard.current = false; setOpening(''); }
  }
  function confirmRemove(user: DirectoryUser) {
    Alert.alert(t('Delete {name} from contacts?', { name: user.displayName }), t('The chat and its history are removed from this phone. The chat stays on the other person\'s device, and they can still write to you. Block them to stop that.'), [
      { text: t('Cancel'), style: 'cancel' },
      { text: t('Delete'), style: 'destructive', onPress: () => { setError(''); void current.removeContact(user.userId).catch(cause => setError(errorText(cause))); } },
    ]);
  }
  const saved = new Set(myContacts(snapshot.contacts, snapshot.conversations).map(user => user.userId));
  const mine = myContacts(snapshot.contacts, snapshot.conversations, normalized);
  return <SafeAreaView style={styles.whiteScreen} edges={['top']}>
    <ScreenHeader title={t('Contacts')} action={showsDirectory ? <IconButton name="refresh" label={t('Refresh directory')} disabled={!online || state.busy} onPress={() => void catalog.load()} /> : undefined} />
    <View style={styles.search}><Icon name="search" color={colors.secondary} size={19} /><TextInput style={styles.searchInput} placeholder={t('Name or @username')} placeholderTextColor={colors.secondary} value={query} onChangeText={value => { setQuery(value); catalog.setQuery(value); setError(''); }} maxLength={49} autoCapitalize="none" autoCorrect={false} accessibilityLabel={t('Search by name or username')} />{state.busy && <ActivityIndicator color={colors.accent} />}</View>
    <Pressable style={styles.listRow} accessibilityRole="button" onPress={() => router.push('/new-group')}><View style={[styles.avatar, { backgroundColor: '#E2F2EB' }]}><Icon name="people-outline" /></View><Text style={[styles.rowName, { color: colors.accent }]}> {t('Create group')}</Text></Pressable>
    {!online && <Text style={[styles.info, { margin: 18 }]}> {t('No connection to the server. The directory is not updated; saved chats are available in the Chats tab.')}</Text>}
    {!!(error || state.error) && <Text style={[styles.error, { marginHorizontal: 16, marginVertical: 8 }]}>{error || state.error}</Text>}
    <FlatList data={showsDirectory ? state.users : []} keyExtractor={item => item.userId} keyboardShouldPersistTaps="handled" ItemSeparatorComponent={() => <View style={styles.separator} />}
      ListHeaderComponent={<>
        {mine.length > 0 && <><Text style={[styles.sectionTitle, { marginTop: 12 }]}>{t('MY CONTACTS')}</Text>
          {mine.map(user => <View key={user.userId} style={{ flexDirection: 'row', alignItems: 'center', paddingRight: 8 }}>
            <Pressable accessibilityRole="button" accessibilityLabel={t('Open chat with {name}, @{username}', { name: user.displayName, username: user.username })} disabled={!!opening} onPress={() => void open(user)} style={({ pressed }) => [styles.listRow, styles.flex, pressed && styles.pressed]}>
              <Avatar name={user.displayName} id={user.userId} online={user.online} /><View style={styles.rowBody}><Text numberOfLines={1} style={styles.rowName}>{user.displayName}</Text><Text numberOfLines={1} style={styles.rowText}>@{user.username}</Text></View>
            </Pressable>
            <IconButton name="trash-outline" label={t('Delete {name} from contacts', { name: user.displayName })} color="#A33535" onPress={() => confirmRemove(user)} />
          </View>)}</>}
        {!!normalized && !searching && <Text style={[styles.info, { marginHorizontal: 18, marginVertical: 12 }]}>{t('Type at least two characters to search.')}</Text>}
        {!normalized && <Pressable style={styles.listRow} accessibilityRole="button" accessibilityState={{ expanded: browsing }} disabled={!online && !browsing} onPress={() => setBrowsing(!browsing)}>
          <View style={[styles.avatar, { backgroundColor: '#E2F2EB' }]}><Icon name={browsing ? 'chevron-up' : 'globe-outline'} /></View><Text style={[styles.rowName, { color: colors.accent }]}> {browsing ? t('Hide server users') : t('All server users')}</Text>
        </Pressable>}
        {showsDirectory && <>
          <Text style={[styles.sectionTitle, { marginTop: 12 }]}>{searching ? t('SEARCH RESULTS') : t('SERVER USERS')}</Text>
          <Text style={[styles.info, { marginHorizontal: 18, marginBottom: 12 }]}> {t('The directory does not add people to your contacts automatically. Choose a person to open a chat.')}{state.updatedAt ? ` ${t('Updated {time}.', { time: new Date(state.updatedAt).toLocaleTimeString(intlLocale, { hour: '2-digit', minute: '2-digit' }) })}` : ''}</Text>
        </>}
        {!showsDirectory && !normalized && mine.length === 0 && <Text style={[styles.info, { marginHorizontal: 18, marginVertical: 12 }]}>{t('Find people by name or @username, or open the list of server users.')}</Text>}
      </>}
      refreshing={showsDirectory && state.busy} onRefresh={showsDirectory ? () => { if (online) void catalog.load(); } : undefined}
      onEndReachedThreshold={0.5} onEndReached={() => { if (browsing && !normalized && online && !state.busy && state.nextCursor) void catalog.load(true); }}
      ListEmptyComponent={showsDirectory && !state.busy ? <Empty icon="people-outline" title={searching ? t('User not found') : online ? t('The directory is empty') : t('Directory unavailable')} text={searching ? t('Check the name or username. Display names may repeat; verify the @username.') : t('Registered server users will appear here after you connect.')} /> : undefined}
      ListFooterComponent={showsDirectory && state.users.length > 0 ? <View style={styles.content}>
        {state.busy && !!state.nextCursor && <ActivityIndicator color={colors.accent} />}
        {searching && state.users.length >= DIRECTORY_SEARCH_SHOWN && <Text style={[styles.info, { textAlign: 'center' }]}>{t('Showing the first {count} matches. Type more to narrow the search.', { count: state.users.length })}</Text>}
      </View> : undefined}
      renderItem={({ item }) => <Pressable accessibilityRole="button" accessibilityLabel={t('Open chat with {name}, @{username}', { name: item.displayName, username: item.username })} disabled={!!opening} onPress={() => void open(item)} style={({ pressed }) => [styles.listRow, pressed && styles.pressed]}>
        <Avatar name={item.displayName} id={item.userId} online={item.online} /><View style={styles.rowBody}><Text style={styles.rowName}>{item.displayName}</Text><Text style={[styles.rowText, item.online && online && { color: colors.accent }]}>@{item.username} · {online ? lastSeen(item.online, item.lastSeen) : t('status not updated')}{saved.has(item.userId) ? ` · ${t('your contact')}` : ''}</Text></View>
        {opening === item.userId ? <ActivityIndicator color={colors.accent} /> : <Icon name="chatbubble-outline" size={21} color={colors.secondary} />}
      </Pressable>} />
  </SafeAreaView>;
}
