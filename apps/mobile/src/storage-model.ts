import { mediaKind } from './media-model';

/**
 * Files kept on this phone, grouped into one folder per chat (the contact's or
 * group's name). Only records whose encrypted copy is still stored are listed.
 */
export type StoredKind = 'photo' | 'video' | 'voice' | 'circle' | 'file';
export interface StoredFile { id: string; senderId: string; conversationId: string; name: string; mime: string; size: number; timestamp: number; own: boolean; pending: boolean; kind: StoredKind }
export interface StorageFolder { conversationId: string; title: string; group: boolean; files: StoredFile[]; bytes: number }
interface SnapshotLike {
  conversations: readonly {
    id: string; title: string; kind: 'direct' | 'group';
    files: readonly { id: string; senderId: string; name: string; mime: string; size: number; timestamp: number; blobKey?: string; deliveryStatus?: string }[];
  }[];
}

export function storedKind(name: string, mime: string): StoredKind {
  const media = mediaKind(name, mime);
  if (media) return media;
  return mime.startsWith('image/') ? 'photo' : mime.startsWith('video/') ? 'video' : 'file';
}

export function storageFolders(snapshot: SnapshotLike, selfId: string | undefined): StorageFolder[] {
  return snapshot.conversations.map(conversation => {
    const files = conversation.files.filter(file => !!file.blobKey).map(file => ({
      id: file.id, senderId: file.senderId, conversationId: conversation.id, name: file.name, mime: file.mime, size: file.size, timestamp: file.timestamp,
      own: file.senderId === selfId, pending: file.senderId === selfId && file.deliveryStatus === 'pending', kind: storedKind(file.name, file.mime),
    })).sort((a, b) => b.timestamp - a.timestamp);
    return { conversationId: conversation.id, title: conversation.title, group: conversation.kind === 'group', files, bytes: files.reduce((sum, file) => sum + file.size, 0) };
  }).filter(folder => folder.files.length > 0).sort((a, b) => b.bytes - a.bytes || a.title.localeCompare(b.title));
}

export function storageTotals(folders: readonly StorageFolder[]) {
  return { bytes: folders.reduce((sum, folder) => sum + folder.bytes, 0), files: folders.reduce((sum, folder) => sum + folder.files.length, 0) };
}

/** Records to delete for a file, a folder or everything; pending sends are cancelled too, which the warning says. */
export function deletionTargets(folders: readonly StorageFolder[], scope: { conversationId?: string; fileId?: string; senderId?: string }) {
  return folders.filter(folder => !scope.conversationId || folder.conversationId === scope.conversationId)
    .flatMap(folder => folder.files.filter(file => !scope.fileId || (file.id === scope.fileId && file.senderId === scope.senderId))
      .map(file => ({ conversationId: folder.conversationId, record: { id: file.id, type: 'file' as const, author: file.senderId } })));
}
