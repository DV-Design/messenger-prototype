import assert from 'node:assert/strict';
import test from 'node:test';
import type { MessengerFile } from '@messenger/core';
import { groupsInCommon, sharedFiles } from '../src/contact-info-model';

test('groups in common include only groups with both people, newest first, never one I was removed from', () => {
  const list = groupsInCommon([
    { id: 'g1', kind: 'group', title: 'Old', memberIds: ['me', 'p'], updatedAt: 1 },
    { id: 'g2', kind: 'group', title: 'New', memberIds: ['me', 'p', 'x'], updatedAt: 5 },
    { id: 'g3', kind: 'group', title: 'Not theirs', memberIds: ['me', 'x'], updatedAt: 9 },
    { id: 'g4', kind: 'group', title: 'Left', memberIds: ['me'], updatedAt: 9, removed: true },
    { id: 'dm', kind: 'direct', title: 'Direct', memberIds: ['me', 'p'], updatedAt: 9 },
  ], 'p', 'me');
  assert.deepEqual(list.map(item => item.id), ['g2', 'g1']);
});

test('shared files are the ones still openable, newest first', () => {
  const file = (id: string, timestamp: number, extra: Partial<MessengerFile>): MessengerFile => ({ id, name: id, mime: '', size: 1, from: 'peer', status: 'complete', receivedBytes: 1, timestamp, senderId: 's', conversationId: 'c', ...extra });
  const list = sharedFiles([
    file('a', 1, { blobKey: 'k' }),
    file('b', 3, { blobKey: 'k', deliveryStatus: 'expired' }),
    file('c', 2, { large: true, status: 'receiving' }),
    file('d', 4, { large: true }),
    file('e', 5, {}),
  ]);
  assert.deepEqual(list.map(item => item.id), ['d', 'a']);
});
