import { useState } from 'react';
import { router } from 'expo-router';
import { Text, View } from 'react-native';
import { Paths } from 'expo-file-system';
import { MAX_STORED_FILES, MAX_STORED_FILE_BYTES } from '@messenger/core';
import { ActionLink, MenuGroup, MenuRow, SettingsPage, fileSize } from '../../../components/ui';
import { errorText, useMessenger } from '../../../runtime';
import { deletionTargets, storageFolders, storageTotals } from '../../../storage-model';
import { confirmStoredDeletion, deleteStored } from '../../../storage-actions';
import { colors, styles } from '../../../styles';
import { t } from '../../../i18n';

/** One LastCall folder on this phone, with a sub-folder per chat. */
export default function Storage() {
  const { snapshot, identity } = useMessenger();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const folders = storageFolders(snapshot, identity?.userId);
  const totals = storageTotals(folders);
  const free = Paths.availableDiskSpace;
  const share = Math.min(1, Math.max(totals.bytes / MAX_STORED_FILE_BYTES, totals.files / MAX_STORED_FILES));
  function clearAll() {
    confirmStoredDeletion(t('Delete all files?'), folders.some(folder => folder.files.some(file => file.pending)), () => {
      setBusy(true); setError('');
      void deleteStored(deletionTargets(folders, {})).catch(cause => setError(errorText(cause))).finally(() => setBusy(false));
    });
  }
  return <SettingsPage title={t('Data and storage')}>
    <View style={[styles.section, styles.content, { gap: 10 }]}>
      <Text style={styles.rowName}>{t('{used} of {limit} · {files} of {maxFiles} files', { used: fileSize(totals.bytes), limit: fileSize(MAX_STORED_FILE_BYTES), files: totals.files, maxFiles: MAX_STORED_FILES })}</Text>
      <View style={{ height: 6, borderRadius: 3, backgroundColor: colors.line, overflow: 'hidden' }}><View style={{ width: `${Math.round(share * 100)}%`, height: 6, backgroundColor: share > 0.85 ? colors.danger : colors.accent }} /></View>
      {free > 0 && <Text style={styles.info}>{t('Free on the phone: {free}', { free: fileSize(free) })}</Text>}
      <Text style={styles.info}>{t('Files arrive directly from people and are kept only on this phone, encrypted inside LastCall. When the storage is full, new files cannot be received until you free space.')}</Text>
    </View>
    {folders.length === 0 ? <Text style={[styles.body, { textAlign: 'center', marginTop: 28, paddingHorizontal: 24 }]}>{t('No files are stored on this phone.')}</Text>
      : <MenuGroup title={t('FOLDERS')}>{folders.map(folder => <MenuRow key={folder.conversationId} icon={folder.group ? 'people-outline' : 'folder-outline'} title={folder.title}
        subtitle={t('Files: {count}', { count: folder.files.length })} value={fileSize(folder.bytes)} chevron
        onPress={() => router.push({ pathname: '/settings/storage/[id]', params: { id: folder.conversationId } })} />)}</MenuGroup>}
    {!!error && <Text accessibilityRole="alert" style={[styles.error, { marginHorizontal: 16, marginTop: 16 }]}>{error}</Text>}
    {folders.length > 0 && <View style={[styles.content, { paddingTop: 18 }]}>
      <ActionLink icon="trash-outline" danger busy={busy} title={t('Clear all data')} onPress={clearAll} />
      <Text style={styles.info}>{t('Deleted files disappear from the chats as well and cannot be restored.')}</Text>
    </View>}
  </SettingsPage>;
}
