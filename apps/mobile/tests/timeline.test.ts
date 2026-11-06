import assert from 'node:assert/strict';
import test from 'node:test';
import type { MessengerFile, MessengerMessage } from '@messenger/core';
import { chatTimeline, dayLabel, withDays } from '../src/timeline-model';
const message = (id: string, timestamp: number, from = 'alice'): MessengerMessage => ({ id, timestamp, from, text: id, status: 'received', conversationId: 'chat' });
const file = (id: string, timestamp: number, senderId = 'alice', name = id): MessengerFile => ({ id, timestamp, senderId, name, mime: '', size: 1, from: 'peer', status: 'receiving', receivedBytes: 0, conversationId: 'chat' });

test('text, voice, text, file, circle and photo share a chronological timeline', () => {
  const messages = [message('later text', 30), message('first text', 10)];
  const files = [file('circle', 50), file('voice', 20), file('photo', 60), file('document', 40)];
  const originals = JSON.stringify({ messages, files });
  assert.deepEqual(chatTimeline(messages, files).map(entry => entry.item.id), ['first text', 'voice', 'later text', 'document', 'circle', 'photo']);
  assert.equal(JSON.stringify({ messages, files }), originals);
  assert.equal(chatTimeline(messages, files)[0]!.item, messages[1]);
});

test('receipt, transfer progress and restart snapshots never move existing entries', () => {
  const messages = [message('before', 1), message('after', 3)];
  const files = [file('voice', 2)];
  const before = chatTimeline(messages, files).map(entry => entry.key);
  const restored = JSON.parse(JSON.stringify({ messages, files })) as { messages: MessengerMessage[]; files: MessengerFile[] };
  restored.files[0]!.status = 'complete'; restored.files[0]!.receivedBytes = 1; restored.files[0]!.deliveryStatus = 'delivered'; restored.files[0]!.readBy = ['bob'];
  restored.messages[0]!.status = 'delivered';
  assert.deepEqual(chatTimeline(restored.messages, restored.files).map(entry => entry.key), before);
});

test('equal IDs and times stay deterministic across types, group authors and input order', () => {
  const messages = [message('shared', 1, 'bob'), message('shared', 1, 'alice')];
  const files = [file('shared', 1, 'bob'), file('shared', 1, 'alice')];
  const entries = chatTimeline(messages, files);
  assert.equal(new Set(entries.map(entry => entry.key)).size, 4);
  assert.deepEqual(chatTimeline([...messages].reverse(), [...files].reverse()).map(entry => entry.key), entries.map(entry => entry.key));
});

test('empty and attachment-only chats work; latest mixed entry drives preview', () => {
  assert.deepEqual(chatTimeline([], []), []);
  assert.equal(chatTimeline([], [file('only', 1)]).at(-1)!.item.id, 'only');
  assert.equal(chatTimeline([message('text', 2)], [file('old', 1), file('new', 3)]).at(-1)!.item.id, 'new');
  assert.equal(chatTimeline([message('text', 4)], [file('old', 1), file('new', 3)]).at(-1)!.kind, 'message');
});

test('a date row opens each local day, labelled like Telegram', () => {
  const at = (day: number, hour: number, year = 2026, month = 10) => new Date(year, month, day, hour).getTime();
  const now = at(6, 12);
  const words = { today: 'Today', yesterday: 'Yesterday' };
  const entries = chatTimeline([message('old', at(5, 9, 2025)), message('a', at(4, 23)), message('b', at(5, 0)), message('c', at(5, 22)), message('d', at(6, 8))], []);
  const rows = withDays(entries, timestamp => dayLabel(timestamp, now, 'en-US', words));
  assert.deepEqual(rows.map(row => row.kind === 'day' ? `[${row.label}]` : row.item.id), ['[November 5, 2025]', 'old', '[November 4]', 'a', '[Yesterday]', 'b', 'c', '[Today]', 'd']);
  assert.equal(new Set(rows.map(row => row.key)).size, rows.length);
  assert.equal(dayLabel(at(4, 10), now, 'ru-RU', words), '4 ноября');
  assert.deepEqual(withDays([], () => ''), []);
});
