import assert from 'node:assert/strict';
import test from 'node:test';
import type { DirectoryUser } from '@messenger/core';
import { groupMembersView } from '../src/group-model';

const person = (userId: string, displayName: string): DirectoryUser => ({ userId, publicKey: 'k', username: displayName.toLowerCase(), displayName, online: false, lastSeen: 0 });

test('you come first, the rest by name, and the owner is marked where they are', () => {
  const view = groupMembersView({ memberIds: ['c', 'me', 'a', 'z'], creatorId: 'z' }, [person('a', 'Boris'), person('c', 'Anna'), person('z', 'Zoe')], 'me', 'Me');
  assert.deepEqual(view.map(item => item.user.displayName), ['Me', 'Anna', 'Boris', 'Zoe']);
  assert.deepEqual(view.map(item => item.owner), [false, false, false, true]);
  assert.equal(view[0]!.self, true);
});

test('a member without a known profile is still listed', () => {
  const view = groupMembersView({ memberIds: ['me', 'x'], creatorId: 'me' }, [], 'me', 'Me', 'Участник');
  assert.deepEqual(view.map(item => item.user.displayName), ['Me', 'Участник']);
});
