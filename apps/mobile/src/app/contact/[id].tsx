import { useState } from 'react';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { safetyEmoji, type MessengerFile } from '@messenger/core';
import { SafeAreaView } from '../../components/SafeArea';
import { Avatar, Icon, IconButton, MenuRow, fileSize, lastSeen, time } from '../../components/ui';
import { SafetyCode } from '../../components/SafetyCode';
import { client, errorText, useMessenger } from '../../runtime';
import { colors, styles } from '../../styles';
import { intlLocale, t } from '../../i18n';
import { shareFile } from '../../attachments';
import { groupsInCommon, sharedFiles } from '../../contact-info-model';
import { mediaKind } from '../../media-model';

const fileTitle = (file: MessengerFile) => { const kind = mediaKind(file.name, file.mime); return kind === 'voice' ? t('Voice message') : kind === 'circle' ? t('Video circle') : file.name; };

const MAX_FILES_SHOWN = 20;

/**
 * Telegram-style profile of the person in a direct chat (tap the avatar or name in the chat
 * header): who they are, quick actions, the safety code, groups in common, what was shared, and
 * blocking or removing the contact at the bottom.
 */
export default function ContactInfo() {
  const params = useLocalSearchParams<{ id: string }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  const { profile, snapshot, identity } = useMessenger();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [safetyOpen, setSafetyOpen] = useState(false);
  if (!profile) return <Redirect href="/onboarding" />;
  const conversation = snapshot.conversations.find(item => item.id === id && item.kind === 'direct');
  const peer = conversation && snapshot.contacts.find(item => conversation.memberIds.includes(item.userId) && item.userId !== identity?.userId);
  if (!conversation || !peer || !identity) return <SafeAreaView style={styles.whiteScreen}><View style={styles.chatHeader}><IconButton name="chevron-back" label={t('Back')} onPress={() => router.back()} /></View></SafeAreaView>;
  const contact = peer;
  const chat = conversation;
  const blocked = snapshot.blockedContacts.includes(contact.userId);
  const verified = snapshot.verifiedContacts.includes(contact.userId);
  const canCall = !blocked && !snapshot.activeCall && (snapshot.status === 'online' || chat.session?.status === 'connected');
  const groups = groupsInCommon(snapshot.conversations, contact.userId, identity.userId);
  const files = sharedFiles(chat.files);

  async function action(work: () => Promise<void>) {
    if (busy) return;
    setBusy(true); setError('');
    try { await work(); } catch (cause) { setError(errorText(cause)); } finally { setBusy(false); }
  }
  function call(video: boolean) { void action(async () => { await client().startCall(chat.id, video); router.back(); }); }
  function confirmDelete() {
    Alert.alert(t('Delete {name} from contacts?', { name: contact.displayName }), t('The chat and its history are removed from this phone. The chat stays on the other person\'s device, and they can still write to you. Block them to stop that.'), [
      { text: t('Cancel'), style: 'cancel' },
      { text: t('Delete'), style: 'destructive', onPress: () => void action(async () => { await client().removeContact(contact.userId); router.replace('/(tabs)'); }) },
    ]);
  }
  const fileDate = (file: MessengerFile) => `${new Date(file.timestamp).toLocaleDateString(intlLocale, { day: 'numeric', month: 'short' })}, ${time(file.timestamp)}`;

  return <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
    <View style={[styles.chatHeader, { backgroundColor: colors.white }]}>
      <IconButton name="chevron-back" label={t('Back')} onPress={() => router.back()} />
      <Text style={[styles.chatName, { flex: 1 }]}>{t('Info')}</Text>
    </View>
    <ScrollView contentContainerStyle={{ paddingBottom: 30 }}>
      <View style={{ alignItems: 'center', gap: 6, paddingTop: 22, paddingBottom: 16, backgroundColor: colors.white }}>
        <Avatar name={contact.displayName} id={contact.userId} size={96} online={contact.online} />
        <Text style={[styles.title, { fontSize: 22, textAlign: 'center', paddingHorizontal: 20 }]} numberOfLines={2}>{contact.displayName}</Text>
        <Text style={[styles.rowText, contact.online && { color: colors.accent }]}>{blocked ? t('blocked') : lastSeen(contact.online, contact.lastSeen)}</Text>
        <View style={{ flexDirection: 'row', gap: 10, paddingTop: 12, paddingHorizontal: 16 }}>
          {([
            { icon: 'chatbubble', label: t('Write a message'), onPress: () => router.back(), disabled: false },
            { icon: 'call', label: t('Audio call'), onPress: () => call(false), disabled: !canCall || busy },
            { icon: 'videocam', label: t('Video call'), onPress: () => call(true), disabled: !canCall || busy },
          ] as const).map(item => <Pressable key={item.icon} accessibilityRole="button" accessibilityLabel={item.label} disabled={item.disabled} onPress={item.onPress}
            style={({ pressed }) => [{ flex: 1, alignItems: 'center', gap: 5, paddingVertical: 10, borderRadius: 14, backgroundColor: '#EEF3F1' }, pressed && styles.pressed, item.disabled && styles.disabled]}>
            <Icon name={item.icon} size={22} color={colors.accent} />
            <Text numberOfLines={1} style={{ color: colors.accent, fontSize: 12.5, fontWeight: '600' }}>{item.label}</Text>
          </Pressable>)}
        </View>
      </View>
      {!!error && <Pressable accessibilityRole="button" onPress={() => setError('')}><Text style={[styles.error, { margin: 16 }]}>{error}</Text></Pressable>}
      {!!notice && <Text style={[styles.info, { textAlign: 'center', paddingTop: 10 }]}>{notice}</Text>}
      <View style={styles.section}>
        <MenuRow icon="at" title={`@${contact.username}`} subtitle={t('Username · tap to copy')} onPress={() => {
          void Clipboard.setStringAsync(`@${contact.username}`).then(() => setNotice(t('Username copied'))).catch(() => setError(t('Could not copy.')));
        }} />
        <MenuRow icon={verified ? 'shield-checkmark' : 'shield-outline'} title={t('Safety code')} subtitle={verified ? t('Verified') : t('Not verified · compare it with {name}', { name: contact.displayName })} chevron onPress={() => setSafetyOpen(true)} />
      </View>
      {groups.length > 0 && <>
        <Text style={styles.sectionTitle}>{t('Groups in common: {count}', { count: groups.length })}</Text>
        <View style={styles.section}>
          {groups.map(group => <Pressable key={group.id} accessibilityRole="button" onPress={() => router.push({ pathname: '/chat/[id]', params: { id: group.id } })} style={({ pressed }) => [styles.listRow, pressed && { backgroundColor: '#EEF3F1' }]}>
            <Avatar name={group.title} id={group.id} group size={40} />
            <View style={styles.rowBody}><Text numberOfLines={1} style={styles.rowName}>{group.title}</Text><Text style={styles.rowText}>{t('Members: {count}', { count: group.memberIds.length })}</Text></View>
          </Pressable>)}
        </View>
      </>}
      {files.length > 0 && <>
        <Text style={styles.sectionTitle}>{t('Media and files: {count}', { count: files.length })}</Text>
        <View style={styles.section}>
          {files.slice(0, MAX_FILES_SHOWN).map(file => <Pressable key={`${file.senderId}:${file.id}`} accessibilityRole="button" onPress={() => void action(() => shareFile(file))} style={({ pressed }) => [styles.listRow, pressed && { backgroundColor: '#EEF3F1' }]}>
            <Icon name={file.mime.startsWith('image/') ? 'image-outline' : file.mime.startsWith('video/') ? 'videocam-outline' : file.mime.startsWith('audio/') ? 'mic-outline' : 'document-text-outline'} size={24} color={colors.accent} />
            <View style={styles.rowBody}><Text numberOfLines={1} style={styles.rowName}>{fileTitle(file)}</Text><Text style={styles.rowText}>{fileSize(file.size)} · {fileDate(file)}</Text></View>
          </Pressable>)}
        </View>
      </>}
      <View style={styles.section}>
        <MenuRow icon={blocked ? 'lock-open-outline' : 'ban-outline'} danger={!blocked} busy={busy}
          title={blocked ? t('Unblock {name}', { name: contact.displayName }) : t('Block {name}', { name: contact.displayName })}
          onPress={() => void action(() => blocked ? client().unblockContact(contact.userId) : client().blockContact(contact.userId))} />
        <MenuRow icon="person-remove-outline" danger title={t('Delete contact')} disabled={busy} onPress={confirmDelete} />
      </View>
    </ScrollView>
    <SafetyCode visible={safetyOpen} title={contact.displayName} code={safetyEmoji(identity.publicKey, contact.publicKey)} verified={verified} sessionReady={!!chat.session?.contentE2E}
      onClose={() => setSafetyOpen(false)} onVerify={() => void action(async () => { await client().markContactVerified(contact.userId); setSafetyOpen(false); })} />
  </SafeAreaView>;
}
