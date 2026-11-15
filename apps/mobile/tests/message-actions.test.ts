import assert from 'node:assert/strict';
import test from 'node:test';
import type { Conversation, DirectoryUser } from '@messenger/core';
import { messageActions, myContacts } from '../src/message-actions-model';

test('only the author edits or deletes for everyone; anything can be replied to', () => {
  assert.deepEqual(messageActions({ own: true, type: 'message', expired: false }), ['reply', 'edit', 'copy', 'deleteForEveryone', 'deleteForMe']);
  assert.deepEqual(messageActions({ own: false, type: 'message', expired: false }), ['reply', 'copy', 'deleteForMe']);
});
test('an expired message and a file cannot be edited', () => {
  assert.deepEqual(messageActions({ own: true, type: 'message', expired: true }), ['reply', 'copy', 'deleteForEveryone', 'deleteForMe']);
  assert.deepEqual(messageActions({ own: true, type: 'file', expired: false }), ['reply', 'deleteForEveryone', 'deleteForMe']);
  assert.deepEqual(messageActions({ own: false, type: 'file', expired: false }), ['reply', 'deleteForMe']);
});
test('a location or contact card cannot be edited even by its author', () => {
  const location = '📍 Location\nhttps://maps.google.com/?q=1,2';
  assert.deepEqual(messageActions({ own: true, type: 'message', expired: false, text: location }), ['reply', 'copy', 'deleteForEveryone', 'deleteForMe']);
});
const user = (userId: string, displayName: string, username: string): DirectoryUser => ({ userId, publicKey: 'k', username, displayName, online: false, lastSeen: 0 });
const direct = (member: string, extra: Partial<Conversation> = {}): Conversation => ({ id: member, kind: 'direct', title: member, memberIds: ['me', member], messages: [], files: [], unread: 0, updatedAt: 0, ...extra });
test('my contacts have a direct chat I chose, and a deleted chat keeps the contact', () => {
  const people = [user('b', 'Боря', 'boris'), user('a', 'Аня', 'anya'), user('g', 'Group member', 'grp'), user('i', 'Inbound', 'inb')];
  const chats = [direct('a', { hidden: true }), direct('b'), direct('i', { hidden: true, implicit: true }), { ...direct('group'), kind: 'group' as const, memberIds: ['me', 'g'] }];
  assert.deepEqual(myContacts(people, chats).map(item => item.userId), ['a', 'b']);
});
test('my contacts search by name or @username', () => {
  const people = [user('b', 'Боря', 'boris'), user('a', 'Аня', 'anya')];
  const chats = [direct('a'), direct('b')];
  assert.deepEqual(myContacts(people, chats, '@BOR').map(item => item.userId), ['b']);
  assert.deepEqual(myContacts(people, chats, 'ан').map(item => item.userId), ['a']);
});
