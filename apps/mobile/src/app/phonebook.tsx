import { useCallback, useEffect, useRef, useState } from 'react';
import { router } from 'expo-router';
import { ActivityIndicator, Alert, AppState, FlatList, Linking, Modal, Platform, Pressable, Share, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Contacts from 'expo-contacts';
import type { DirectoryUser } from '@messenger/core';
import { useDiscovery } from '../discovery';
import { Avatar, Button, Empty, Icon, IconButton } from '../components/ui';
import { getContactLink, readDeviceContacts, saveContactLink } from '../phonebook';
import type { DeviceContact } from '../phonebook-model';
import { UNKNOWN_ACCESS, hasAccess, type Access } from '../permission-model';
import { expandContactAccess, readPermission, requestPermission } from '../permissions';
import { client, errorText, useMessenger } from '../runtime';
import { colors, styles } from '../styles';

export default function Phonebook() {
  const { snapshot, profile, identity } = useMessenger();
  const discovery = useDiscovery();
  const [access, setAccess] = useState<Access>(UNKNOWN_ACCESS);
  const [rows, setRows] = useState<DeviceContact[]>([]);
  const [query, setQuery] = useState('');
  const [more, setMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<DeviceContact | null>(null);
  const [linkedId, setLinkedId] = useState<string | null>(null);
  const [directoryQuery, setDirectoryQuery] = useState('');
  const [results, setResults] = useState<DirectoryUser[]>([]);
  const [linking, setLinking] = useState(false);
  const loadEpoch = useRef(0);
  const selectedId = useRef<string | null>(null);
  const searchEpoch = useRef(0);
  const invalidate = useCallback(() => { loadEpoch.current += 1; }, []);
  const load = useCallback(async (offset = 0) => {
    const epoch = ++loadEpoch.current;
    setLoading(true); setError('');
    try {
      const permission = await readPermission('contacts');
      if (epoch !== loadEpoch.current) return;
      setAccess(permission);
      if (!hasAccess(permission)) { setRows([]); setMore(false); selectedId.current = null; searchEpoch.current += 1; setSelected(null); return; }
      const page = await readDeviceContacts(offset, query);
      if (epoch !== loadEpoch.current) return;
      setRows(current => offset ? [...current, ...page.contacts.filter(item => !current.some(known => known.id === item.id))] : page.contacts);
      setMore(page.hasMore);
    } catch (cause) { if (epoch === loadEpoch.current) setError(errorText(cause)); }
    finally { if (epoch === loadEpoch.current) setLoading(false); }
  }, [query]);
  useEffect(() => {
    const timer = setTimeout(() => { void load(); }, 250);
    const app = AppState.addEventListener('change', value => { if (value === 'active') void load(); });
    return () => { clearTimeout(timer); app.remove(); invalidate(); };
  }, [load, invalidate]);
  const readable = hasAccess(access);
  useEffect(() => {
    if (!readable) return;
    const changes = Contacts.addContactsChangeListener(() => { void load(); });
    return () => changes.remove();
  }, [readable, load]);
  async function allow() {
    try { setAccess(await requestPermission('contacts')); await load(); }
    catch (cause) { setError(errorText(cause)); }
  }
  async function expand() {
    try { await expandContactAccess(); await load(); } catch (cause) { setError(errorText(cause)); }
  }
  async function choose(contact: DeviceContact) {
    searchEpoch.current += 1;
    selectedId.current = contact.id;
    setSelected(contact); setLinkedId(null); setDirectoryQuery(''); setResults([]); setError(''); setLinking(false);
    if (!profile || !identity) return;
    try { const linked = await getContactLink(profile.serverUrl, identity.userId, contact.id); if (selectedId.current === contact.id) setLinkedId(linked); }
    catch (cause) { if (selectedId.current === contact.id) setError(errorText(cause)); }
  }
  async function search(value = directoryQuery) {
    if (!value.trim()) { setResults([]); return; }
    const epoch = ++searchEpoch.current;
    const contactId = selectedId.current;
    setLinking(true); setError('');
    try { const found = await client().search(value.trim().replace(/^@/, '').toLowerCase()); if (epoch === searchEpoch.current && contactId === selectedId.current) setResults(found.filter(user => user.userId !== identity?.userId)); }
    catch (cause) { if (epoch === searchEpoch.current && contactId === selectedId.current) setError(errorText(cause)); } finally { if (epoch === searchEpoch.current) setLinking(false); }
  }
  async function link(user: DirectoryUser) {
    if (!selected || !profile || !identity) return;
    const contactId = selected.id;
    const epoch = ++searchEpoch.current;
    setLinking(true); setError('');
    try {
      await client().addContact(user);
      await saveContactLink(profile.serverUrl, identity.userId, selected.id, user.userId);
      if (epoch === searchEpoch.current && selectedId.current === contactId) { setLinkedId(user.userId); setResults([]); }
    } catch (cause) { if (epoch === searchEpoch.current && selectedId.current === contactId) setError(errorText(cause)); } finally { if (epoch === searchEpoch.current) setLinking(false); }
  }
  function confirmLink(user: DirectoryUser) {
    Alert.alert('Связать контакт с профилем?', `«${selected?.name}» → ${user.displayName} (@${user.username}). Ручная связь не проверяет совпадение номера. Убедитесь, что выбрали нужного человека.`,
      [{ text: 'Отмена', style: 'cancel' }, { text: 'Связать', onPress: () => { void link(user); } }]);
  }
  async function openLinked(user: DirectoryUser) {
    const contactId = selectedId.current;
    const epoch = ++searchEpoch.current;
    setLinking(true);
    try { const id = await client().addContact(user); if (epoch === searchEpoch.current && selectedId.current === contactId) { selectedId.current = null; setSelected(null); router.push({ pathname: '/chat/[id]', params: { id } }); } }
    catch (cause) { if (epoch === searchEpoch.current && selectedId.current === contactId) setError(errorText(cause)); }
    finally { if (epoch === searchEpoch.current) setLinking(false); }
  }
  async function invite() {
    const contactId = selectedId.current;
    try { await Share.share({ title: 'Приглашение в LastCall', message: `Давайте общаться в LastCall. Найдите меня по @${profile?.username ?? ''}. Установка: https://lienad.ru/messenger/` }); }
    catch (cause) { if (selectedId.current === contactId) setError(errorText(cause)); }
  }
  const linked = snapshot.contacts.find(user => user.userId === linkedId) ?? discovery.matches.find(match => match.user.userId === linkedId)?.user;
  const options = directoryQuery.trim() ? results : snapshot.contacts;
  return <SafeAreaView style={styles.whiteScreen}>
    <View style={styles.header}><IconButton name="chevron-back" label="Назад" onPress={() => router.back()} /><View style={styles.flex}><Text style={[styles.title, { fontSize: 23 }]}>Контакты телефона</Text><Text style={styles.subtitle}>Ручное связывание</Text></View><IconButton name="refresh" label="Обновить контакты" disabled={loading} onPress={() => void load()} /></View>
    <View style={styles.search}><Icon name="search" size={19} color={colors.secondary} /><TextInput style={styles.searchInput} value={query} onChangeText={setQuery} maxLength={100} placeholder="Поиск в телефоне" placeholderTextColor={colors.secondary} accessibilityLabel="Локальный поиск контактов телефона" /></View>
    <Text style={[styles.info, { marginHorizontal: 18, marginBottom: 12 }]}>В ручном режиме профиль выбираете вы. Автопоиск по хешам номеров включается отдельно, после подтверждения своего номера.</Text>
    <View style={{ paddingHorizontal: 18, marginBottom: 12 }}><Button title="Номер и автопоиск контактов" secondary onPress={() => router.push('/phone')} /></View>
    {access.status === 'limited' && <View style={{ paddingHorizontal: 17, gap: 9, marginBottom: 12 }}><Text style={styles.info}>Доступ только к выбранным контактам.</Text>{Platform.OS === 'ios' && <Button title="Выбрать ещё контакты" secondary onPress={() => void expand()} />}</View>}
    {!hasAccess(access) && access.status !== 'unknown' && <View style={styles.content}><Button title={access.canAskAgain ? 'Разрешить чтение контактов' : 'Открыть настройки телефона'} onPress={() => { if (access.canAskAgain) void allow(); else void Linking.openSettings().catch(cause => setError(errorText(cause))); }} /><Text style={styles.info}>Можно продолжать пользоваться LastCall без доступа к телефонной книге.</Text></View>}
    {!!error && !selected && <Text style={[styles.error, { margin: 16 }]}>{error}</Text>}
    <FlatList data={rows} keyExtractor={item => item.id} keyboardShouldPersistTaps="handled" ItemSeparatorComponent={() => <View style={styles.separator} />}
      ListEmptyComponent={hasAccess(access) && !loading ? <Empty icon="people-outline" title="Контактов не найдено" text={query ? 'Попробуйте другое имя.' : 'Проверьте выбранные контакты или нажмите «Обновить».'} /> : undefined}
      ListFooterComponent={<View style={styles.content}>{loading ? <ActivityIndicator color={colors.accent} /> : more ? <Button title="Загрузить ещё" secondary onPress={() => void load(rows.length)} /> : hasAccess(access) && <Text style={styles.info}>Показано: {rows.length}</Text>}</View>}
      renderItem={({ item }) => <Pressable style={styles.listRow} accessibilityRole="button" onPress={() => void choose(item)}><Avatar name={item.name} id={item.id} /><View style={styles.rowBody}><Text style={styles.rowName}>{item.name}</Text><Text style={styles.rowText}>{item.phones[0] ?? 'Без номера'}{item.phones.length > 1 ? ` · ещё ${item.phones.length - 1}` : ''}</Text></View><Icon name="chevron-forward" size={18} color={colors.secondary} /></Pressable>} />
    <Modal visible={!!selected} animationType="slide" onRequestClose={() => { selectedId.current = null; setSelected(null); }}>
      <SafeAreaView style={styles.screen}><View style={styles.header}><IconButton name="close" label="Закрыть контакт" onPress={() => { selectedId.current = null; setSelected(null); }} /><Text style={[styles.rowName, styles.flex]} numberOfLines={1}>{selected?.name}</Text></View>
        <View style={styles.content}><Text selectable style={styles.body}>{selected?.phones.join('\n') || 'Номер не указан'}</Text>{linked ? <><Text style={styles.rowName}>Связан с @{linked.username}</Text><Button title={`Открыть чат с ${linked.displayName}`} onPress={() => void openLinked(linked)} /></> : <Text style={styles.info}>Выберите профиль LastCall и подтвердите связь. Имя и номер контакта остаются на устройстве.</Text>}
          {(selected?.usernames ?? []).map(name => <Button key={name} title={`Найти @${name} из карточки`} secondary disabled={linking || snapshot.status !== 'online'} onPress={() => { setDirectoryQuery(name); void search(name); }} />)}
          <View style={styles.row}><TextInput style={[styles.input, styles.flex]} value={directoryQuery} onChangeText={value => { setDirectoryQuery(value); setResults([]); }} autoCapitalize="none" autoCorrect={false} maxLength={25} placeholder="@username в LastCall" placeholderTextColor={colors.secondary} accessibilityLabel="Имя профиля для связи с контактом" /><IconButton name="search" label="Найти профиль LastCall" disabled={linking || snapshot.status !== 'online' || !directoryQuery.trim()} onPress={() => void search()} /></View>
          {snapshot.status !== 'online' && <Text style={styles.info}>Чтобы искать профили, дождитесь соединения с сервером.</Text>}
          <Button title="Пригласить в LastCall…" secondary disabled={linking} onPress={() => void invite()} />
          {!!error && <Text style={styles.error}>{error}</Text>}
        </View>
        <FlatList data={options.filter(user => user.userId !== identity?.userId)} keyExtractor={item => item.userId} keyboardShouldPersistTaps="handled" ListHeaderComponent={<Text style={[styles.sectionTitle, { marginTop: 0 }]}>{directoryQuery.trim() ? 'НАЙДЕННЫЕ ПРОФИЛИ' : 'ВАШИ КОНТАКТЫ LASTCALL'}</Text>}
          ListEmptyComponent={linking ? <ActivityIndicator color={colors.accent} /> : directoryQuery.trim() ? <Text style={[styles.info, { marginHorizontal: 20 }]}>Нажмите поиск. Если профиля нет, уточните @username у человека.</Text> : undefined}
          renderItem={({ item }) => <Pressable style={styles.listRow} disabled={linking} accessibilityRole="button" onPress={() => confirmLink(item)}><Avatar name={item.displayName} id={item.userId} /><View style={styles.rowBody}><Text style={styles.rowName}>{item.displayName}</Text><Text style={styles.rowText}>@{item.username}</Text></View><Icon name="link-outline" /></Pressable>} />
      </SafeAreaView>
    </Modal>
  </SafeAreaView>;
}
