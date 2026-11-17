import type { Conversation, MessengerFile } from '@messenger/core';

/** Groups this person and I are both in, most recently active first (Telegram's "Groups in common"). */
export function groupsInCommon(conversations: readonly Pick<Conversation, 'id' | 'kind' | 'title' | 'memberIds' | 'updatedAt' | 'removed'>[], peerId: string, ownId: string) {
  return conversations
    .filter(item => item.kind === 'group' && !item.removed && item.memberIds.includes(peerId) && item.memberIds.includes(ownId))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

/** Shared files that can still be opened, newest first. */
export function sharedFiles(files: readonly MessengerFile[]): MessengerFile[] {
  return files.filter(file => file.deliveryStatus !== 'expired' && (file.large ? file.status === 'complete' || file.from === 'self' : !!(file.blobKey || file.data)))
    .sort((a, b) => b.timestamp - a.timestamp);
}
