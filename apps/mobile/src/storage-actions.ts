import { Alert } from 'react-native';
import { attachmentKey } from '@messenger/core';
import { pruneBulkFiles } from './bulk-files';
import { client } from './runtime';
import { t } from './i18n';
import type { deletionTargets } from './storage-model';

/** Deletes for this phone only: the record leaves the chat and its encrypted copy is erased. */
export async function deleteStored(targets: ReturnType<typeof deletionTargets>): Promise<void> {
  const current = client();
  for (const target of targets) await current.deleteMessage(target.conversationId, target.record, 'me');
}

/** "Clear all data": every stored file, then any large-file folder left without a record. */
export async function deleteAllStored(targets: ReturnType<typeof deletionTargets>): Promise<void> {
  await deleteStored(targets);
  const keep = new Set(client().getSnapshot().conversations.flatMap(c => c.files.filter(f => f.large).map(f => attachmentKey(f.senderId, f.id, c.id))));
  pruneBulkFiles(keep);
}

/** The irreversible-deletion warning shared by a file, a folder and "Clear all". */
export function confirmStoredDeletion(title: string, pending: boolean, onConfirm: () => void) {
  Alert.alert(title, [
    t('The files are erased from this phone and disappear from the chats. They cannot be restored. Other people keep their copies.'),
    pending ? t('Files that have not been delivered yet will not be sent.') : '',
  ].filter(Boolean).join('\n\n'), [
    { text: t('Cancel'), style: 'cancel' },
    { text: t('Delete'), style: 'destructive', onPress: onConfirm },
  ]);
}
