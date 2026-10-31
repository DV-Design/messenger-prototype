import type { MessengerFile, MessengerMessage } from '@messenger/core';

export type ChatTimelineEntry =
  | { kind: 'message'; key: string; timestamp: number; item: MessengerMessage }
  | { kind: 'attachment'; key: string; timestamp: number; item: MessengerFile };

/** Creation time and author identity survive transfer, receipt and restart updates. */
export function chatTimeline(messages: readonly MessengerMessage[], files: readonly MessengerFile[]): ChatTimelineEntry[] {
  const entries: ChatTimelineEntry[] = [
    ...messages.map(item => ({ kind: 'message' as const, key: JSON.stringify(['message', item.from, item.id]), timestamp: item.timestamp, item })),
    ...files.map(item => ({ kind: 'attachment' as const, key: JSON.stringify(['attachment', item.senderId, item.id]), timestamp: item.timestamp, item })),
  ];
  return entries.sort((a, b) => a.timestamp - b.timestamp || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}
