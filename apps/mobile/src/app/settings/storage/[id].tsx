import { useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import { ActionLink, Icon, IconButton, SettingsPage, fileSize, type IconName } from '../../../components/ui';
import { errorText, useMessenger } from '../../../runtime';
import { shareFile } from '../../../attachments';
import { deletionTargets, storageFolders, type StoredFile, type StoredKind } from '../../../storage-model';
import { confirmStoredDeletion, deleteStored } from '../../../storage-actions';
import { colors, styles } from '../../../styles';
import { intlLocale, t } from '../../../i18n';

const ICONS: Record<StoredKind, IconName> = { photo: 'image-outline', video: 'film-outline', voice: 'mic-outline', circle: 'videocam-outline', file: 'document-outline' };
const LABELS: Partial<Record<StoredKind, string>> = { voice: 'Voice message', circle: 'Video circle' };

/** The files of one chat: open, delete one, or delete the whole folder. */
export default function StorageFolder() {
  const params = useLocalSearchParams<{ id: string }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  const { snapshot, identity } = useMessenger();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const folders = storageFolders(snapshot, identity?.userId);
  const folder = folders.find(item => item.conversationId === id);
  const title = folder?.title ?? snapshot.conversations.find(item => item.id === id)?.title ?? t('Folder');
  function remove(scope: { fileId?: string; senderId?: string }, heading: string, pending: boolean, after?: () => void) {
    confirmStoredDeletion(heading, pending, () => {
      setBusy(true); setError('');
      void deleteStored(deletionTargets(folders, { conversationId: id, ...scope })).then(after).catch(cause => setError(errorText(cause))).finally(() => setBusy(false));
    });
  }
  function open(file: StoredFile) {
    const item = snapshot.conversations.find(conversation => conversation.id === file.conversationId)?.files.find(entry => entry.id === file.id && entry.senderId === file.senderId);
    if (item) void shareFile(item).catch(cause => setError(errorText(cause)));
  }
  const sender = (file: StoredFile) => file.own ? t('you') : snapshot.contacts.find(contact => contact.userId === file.senderId)?.displayName ?? t('Member');
  return <SettingsPage title={title}>
    {!folder ? <Text style={[styles.body, { textAlign: 'center', marginTop: 28 }]}>{t('No files are stored on this phone.')}</Text> : <>
      <View style={[styles.section, { marginTop: 16 }]}>{folder.files.map((file, index) => <View key={`${file.senderId}:${file.id}`}>
        {index > 0 && <View style={styles.menuSeparator} />}
        <View style={[styles.menuRow, { paddingRight: 6 }]}>
          <Pressable accessibilityRole="button" accessibilityHint={t('Open or save the file')} disabled={busy} onPress={() => open(file)} style={({ pressed }) => [{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 15 }, pressed && styles.pressed]}>
            <Icon name={ICONS[file.kind]} size={23} />
            <View style={styles.rowBody}>
              <Text numberOfLines={1} style={styles.menuText}>{LABELS[file.kind] ? t(LABELS[file.kind]!) : file.name}</Text>
              <Text numberOfLines={1} style={styles.rowText}>{[fileSize(file.size), new Date(file.timestamp).toLocaleDateString(intlLocale, { day: 'numeric', month: 'short', year: 'numeric' }), sender(file), file.pending ? t('not delivered yet') : ''].filter(Boolean).join(' · ')}</Text>
            </View>
          </Pressable>
          <IconButton name="trash-outline" color={colors.danger} label={t('Delete file')} disabled={busy} onPress={() => remove({ fileId: file.id, senderId: file.senderId }, t('Delete file?'), file.pending)} />
        </View>
      </View>)}</View>
      {!!error && <Text accessibilityRole="alert" style={[styles.error, { marginHorizontal: 16, marginTop: 16 }]}>{error}</Text>}
      <View style={[styles.content, { paddingTop: 18 }]}>
        <ActionLink icon="trash-outline" danger busy={busy} title={t('Delete folder')} onPress={() => remove({}, t('Delete all files of {name}?', { name: title }), folder.files.some(file => file.pending), () => router.back())} />
        <Text style={styles.info}>{t('Deleted files disappear from the chats as well and cannot be restored.')}</Text>
      </View>
    </>}
  </SettingsPage>;
}
