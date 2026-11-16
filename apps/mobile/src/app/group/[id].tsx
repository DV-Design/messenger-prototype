import { useState } from 'react';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { Alert, FlatList, Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { DirectoryUser } from '@messenger/core';
import { SafeAreaView } from '../../components/SafeArea';
import { Avatar, Button, Icon, IconButton, MenuRow } from '../../components/ui';
import { client, errorText, useMessenger } from '../../runtime';
import { colors, styles } from '../../styles';
import { t } from '../../i18n';
import { groupMembersView, MAX_GROUP_MEMBERS } from '../../group-model';

/**
 * WhatsApp-style group info: who is in the group, and for the owner, rename, add and remove.
 * Every change is a new roster the owner signs and members pass on phone to phone; there is no
 * server copy, so a member who is offline learns about it the next time they connect.
 */
export default function GroupInfo() {
  const params = useLocalSearchParams<{ id: string }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  const { profile, snapshot, identity } = useMessenger();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [renaming, setRenaming] = useState<string>();
  const [adding, setAdding] = useState(false);
  const [member, setMember] = useState<DirectoryUser>();
  const conversation = snapshot.conversations.find(item => item.id === id && item.kind === 'group');
  if (!profile) return <Redirect href="/onboarding" />;
  if (!conversation || !identity) return <SafeAreaView style={styles.whiteScreen}><View style={styles.chatHeader}><IconButton name="chevron-back" label={t('Back')} onPress={() => router.back()} /></View></SafeAreaView>;
  const group = conversation;
  const own = identity.userId;
  const owner = group.creatorId === own && !group.removed;
  const members = groupMembersView(group, snapshot.contacts, own, profile.displayName, t('Member'));
  const blocked = new Set(snapshot.blockedContacts);

  async function action(work: () => Promise<void>) {
    if (busy) return;
    setBusy(true); setError('');
    try { await work(); } catch (cause) { setError(errorText(cause)); } finally { setBusy(false); }
  }
  function confirmRemove(user: DirectoryUser) {
    setMember(undefined);
    Alert.alert(t('Remove {name} from the group?', { name: user.displayName }), t('They keep the messages they already have, but stop receiving new ones. Members learn about it when their phones connect.'), [
      { text: t('Cancel'), style: 'cancel' },
      { text: t('Remove'), style: 'destructive', onPress: () => void action(() => client().updateGroup(group.id, { remove: [user.userId] })) },
    ]);
  }
  function confirmDelete() {
    Alert.alert(t('Delete chat "{title}"?', { title: group.title }), owner
      ? t('The group and its history are removed from this phone. Members keep their copy and can still write to each other.')
      : t('The group and its history are removed from this phone. The owner still lists you as a member until they remove you.'), [
      { text: t('Cancel'), style: 'cancel' },
      { text: t('Delete'), style: 'destructive', onPress: () => void action(async () => { await client().deleteChat(group.id); router.replace('/(tabs)'); }) },
    ]);
  }

  return <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
    <View style={[styles.chatHeader, { backgroundColor: colors.white }]}>
      <IconButton name="chevron-back" label={t('Back')} onPress={() => router.back()} />
      <Text style={[styles.chatName, { flex: 1 }]}>{t('Group info')}</Text>
    </View>
    <ScrollView contentContainerStyle={{ paddingBottom: 30 }} keyboardShouldPersistTaps="handled">
      <View style={{ alignItems: 'center', gap: 8, paddingVertical: 22, backgroundColor: colors.white }}>
        <Avatar name={group.title} id={group.id} group size={92} />
        {renaming === undefined ? <Pressable accessibilityRole={owner ? 'button' : 'text'} accessibilityHint={owner ? t('Rename the group') : undefined} disabled={!owner} onPress={() => setRenaming(group.title)} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 20 }}>
          <Text style={[styles.title, { fontSize: 22, textAlign: 'center' }]} numberOfLines={2}>{group.title}</Text>
          {owner && <Icon name="pencil" size={17} color={colors.secondary} />}
        </Pressable> : <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 20, alignSelf: 'stretch' }}>
          <TextInput autoFocus value={renaming} onChangeText={setRenaming} maxLength={64} style={[styles.input, { flex: 1 }]} accessibilityLabel={t('Group name')} />
          <IconButton name="checkmark" label={t('Save')} disabled={busy || !renaming.trim() || renaming.trim() === group.title}
            onPress={() => void action(async () => { await client().updateGroup(group.id, { title: renaming }); setRenaming(undefined); })} />
          <IconButton name="close" label={t('Cancel')} onPress={() => setRenaming(undefined)} />
        </View>}
        <Text style={styles.rowText}>{t('Group · {count} members', { count: group.memberIds.length })}</Text>
      </View>
      {group.removed && <Text style={[styles.error, { margin: 16 }]}>{t('You were removed from this group. The history stays on this phone.')}</Text>}
      {!!error && <Pressable accessibilityRole="button" onPress={() => setError('')}><Text style={[styles.error, { margin: 16 }]}>{error}</Text></Pressable>}
      {!group.removed && <>
        <Text style={styles.sectionTitle}>{t('{count} of {max} members', { count: group.memberIds.length, max: MAX_GROUP_MEMBERS })}</Text>
        <View style={styles.section}>
          {owner && group.memberIds.length < MAX_GROUP_MEMBERS && <MenuRow icon="person-add-outline" title={t('Add members')} disabled={busy || snapshot.status !== 'online'} onPress={() => setAdding(true)} />}
          {members.map(item => <Pressable key={item.user.userId} accessibilityRole="button" disabled={item.self} onPress={() => setMember(item.user)}
            style={({ pressed }) => [styles.listRow, pressed && { backgroundColor: '#EEF3F1' }]}>
            <Avatar name={item.user.displayName} id={item.user.userId} size={44} online={!item.self && item.user.online} />
            <View style={styles.rowBody}>
              <Text numberOfLines={1} style={styles.rowName}>{item.self ? t('You') : item.user.displayName}</Text>
              <Text numberOfLines={1} style={styles.rowText}>{item.self ? `@${profile.username}` : item.user.username ? `@${item.user.username}` : ''}{blocked.has(item.user.userId) ? ` · ${t('blocked')}` : ''}</Text>
            </View>
            {item.owner && <Text style={{ color: colors.accent, fontSize: 12, fontWeight: '600', backgroundColor: '#E3F3EC', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 }}>{t('Owner')}</Text>}
          </Pressable>)}
        </View>
        <Text style={[styles.info, { paddingHorizontal: 20, paddingTop: 10 }]}>{owner
          ? t('You own this group: only you can add or remove people. Changes travel from phone to phone, so a member who is offline sees them when they next connect.')
          : t('Only the owner can add or remove people.')}</Text>
      </>}
      <View style={styles.section}>
        <MenuRow icon="trash-outline" danger title={t('Delete chat')} disabled={busy} onPress={confirmDelete} />
      </View>
    </ScrollView>
    <MemberSheet user={member} owner={owner} blocked={!!member && blocked.has(member.userId)} busy={busy} onClose={() => setMember(undefined)}
      onMessage={user => { setMember(undefined); void action(async () => { const chat = await client().addContact(user); router.push({ pathname: '/chat/[id]', params: { id: chat } }); }); }}
      onBlock={user => { setMember(undefined); void action(() => blocked.has(user.userId) ? client().unblockContact(user.userId) : client().blockContact(user.userId)); }}
      onRemove={confirmRemove} />
    <AddMembers visible={adding} candidates={snapshot.contacts.filter(contact => !group.memberIds.includes(contact.userId) && !blocked.has(contact.userId))}
      room={MAX_GROUP_MEMBERS - group.memberIds.length} busy={busy} onClose={() => setAdding(false)}
      onAdd={ids => void action(async () => { await client().updateGroup(group.id, { add: ids }); setAdding(false); })} />
  </SafeAreaView>;
}

function MemberSheet({ user, owner, blocked, busy, onClose, onMessage, onBlock, onRemove }: {
  user: DirectoryUser | undefined; owner: boolean; blocked: boolean; busy: boolean;
  onClose: () => void; onMessage: (user: DirectoryUser) => void; onBlock: (user: DirectoryUser) => void; onRemove: (user: DirectoryUser) => void;
}) {
  const insets = useSafeAreaInsets();
  return <Modal visible={!!user} transparent animationType="fade" onRequestClose={onClose}>
    <View style={{ flex: 1, justifyContent: 'flex-end' }}>
      <Pressable accessibilityRole="button" accessibilityLabel={t('Close')} onPress={onClose} style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: 'rgba(12, 24, 30, 0.45)' }} />
      {user && <View style={{ backgroundColor: colors.white, borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingTop: 16, paddingBottom: 12 + insets.bottom }}>
        <Text numberOfLines={1} style={[styles.chatName, { paddingHorizontal: 20, paddingBottom: 6 }]}>{user.displayName}</Text>
        <MenuRow icon="chatbubble-outline" title={t('Message {name}', { name: user.displayName })} disabled={busy} onPress={() => onMessage(user)} />
        <MenuRow icon={blocked ? 'lock-open-outline' : 'ban-outline'} danger={!blocked} disabled={busy}
          title={blocked ? t('Unblock {name}', { name: user.displayName }) : t('Block {name}', { name: user.displayName })} onPress={() => onBlock(user)} />
        {owner && <MenuRow icon="person-remove-outline" danger disabled={busy} title={t('Remove from group')} onPress={() => onRemove(user)} />}
      </View>}
    </View>
  </Modal>;
}

function AddMembers({ visible, candidates, room, busy, onClose, onAdd }: {
  visible: boolean; candidates: DirectoryUser[]; room: number; busy: boolean; onClose: () => void; onAdd: (ids: string[]) => void;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  function close() { setSelected([]); onClose(); }
  return <Modal visible={visible} animationType="slide" onRequestClose={close}>
    <SafeAreaView style={styles.whiteScreen} edges={['top', 'bottom']}>
      <View style={styles.chatHeader}>
        <IconButton name="close" label={t('Close')} onPress={close} />
        <View style={styles.flex}><Text style={styles.chatName}>{t('Add members')}</Text><Text style={styles.chatStatus}>{t('{count} more can join', { count: room - selected.length })}</Text></View>
      </View>
      <FlatList data={candidates} keyExtractor={item => item.userId} ItemSeparatorComponent={() => <View style={styles.separator} />}
        ListEmptyComponent={<Text style={[styles.info, { padding: 20, textAlign: 'center' }]}>{t('Everyone in your contacts is already in this group.')}</Text>}
        renderItem={({ item }) => { const checked = selected.includes(item.userId); return <Pressable accessibilityRole="checkbox" accessibilityState={{ checked }} disabled={busy || (!checked && selected.length >= room)} style={styles.listRow}
          onPress={() => setSelected(value => checked ? value.filter(userId => userId !== item.userId) : [...value, item.userId])}>
          <Avatar name={item.displayName} id={item.userId} online={item.online} /><View style={styles.rowBody}><Text style={styles.rowName}>{item.displayName}</Text><Text style={styles.rowText}>@{item.username}</Text></View>
          <View style={[styles.selectionCircle, checked && styles.selectionActive]}>{checked && <Icon name="checkmark" size={17} color={colors.white} />}</View>
        </Pressable>; }} />
      <View style={styles.content}><Button title={t('Add')} busy={busy} disabled={!selected.length} onPress={() => { onAdd(selected); setSelected([]); }} /></View>
    </SafeAreaView>
  </Modal>;
}
