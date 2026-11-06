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

export type ChatTimelineRow = ChatTimelineEntry | { kind: 'day'; key: string; timestamp: number; label: string };
const dayKey = (date: Date) => `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
const startOfDay = (timestamp: number) => { const date = new Date(timestamp); date.setHours(0, 0, 0, 0); return date.getTime(); };

/** Like Telegram: Today, Yesterday, "5 November", and the year only for another year. Local time. */
export function dayLabel(timestamp: number, now: number, locale: string, words: { today: string; yesterday: string }): string {
  const day = startOfDay(timestamp), today = startOfDay(now);
  if (day === today) return words.today;
  // Calendar days, not 24 h spans, so a daylight-saving change cannot skip "Yesterday".
  const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);
  if (day === yesterday.getTime()) return words.yesterday;
  const sameYear = new Date(timestamp).getFullYear() === new Date(now).getFullYear();
  return new Date(timestamp).toLocaleDateString(locale, sameYear ? { day: 'numeric', month: 'long' } : { day: 'numeric', month: 'long', year: 'numeric' });
}

/** Inserts a date row before the first entry of each local day. Entries must already be in time order. */
export function withDays(entries: readonly ChatTimelineEntry[], label: (timestamp: number) => string): ChatTimelineRow[] {
  const rows: ChatTimelineRow[] = []; let previous = '';
  for (const entry of entries) {
    const key = dayKey(new Date(entry.timestamp));
    if (key !== previous) { rows.push({ kind: 'day', key: `day:${key}`, timestamp: entry.timestamp, label: label(entry.timestamp) }); previous = key; }
    rows.push(entry);
  }
  return rows;
}
