import assert from 'node:assert/strict';
import test from 'node:test';
import { NotificationNavigationQueue, parseNotificationDestination } from '../src/notification-navigation-model';
const scope = 'a'.repeat(64), userId = 'b'.repeat(64), dm = 'dm:' + 'c'.repeat(64), group = 'group:' + 'd'.repeat(32);
test('cold text/file taps wait for boot and restored conversation then open actual DM/group once', () => {
  for (const id of [dm, group]) {
    const queue = new NotificationNavigationQueue();
    assert.equal(queue.offer({ conversationId: id, scope }), true);
    assert.equal(queue.take({ ready: false, scope, userId, conversations: [] }), null);
    assert.equal(queue.take({ ready: true, scope, userId, conversations: [] }), null);
    assert.equal(queue.take({ ready: true, scope, userId, conversations: [{ id, memberIds: [userId] }] }), id);
    assert.equal(queue.take({ ready: true, scope, userId, conversations: [{ id, memberIds: [userId] }] }), null);
  }
});
test('warm taps select latest actual conversation; invalid/foreign scope or membership never navigates', () => {
  const queue = new NotificationNavigationQueue();
  queue.offer({ conversationId: dm, scope }); queue.offer({ conversationId: group, scope });
  assert.equal(queue.take({ ready: true, scope, userId, conversations: [{ id: group, memberIds: [userId] }] }), group);
  queue.offer({ conversationId: dm, scope });
  assert.equal(queue.take({ ready: true, scope: 'f'.repeat(64), userId, conversations: [{ id: dm, memberIds: [userId] }] }), null);
  assert.equal(queue.take({ ready: true, scope, userId, conversations: [{ id: dm, memberIds: [userId] }] }), null);
  queue.offer({ conversationId: group, scope });
  assert.equal(queue.take({ ready: true, scope, userId, conversations: [{ id: group, memberIds: ['other'] }] }), null);
  for (const bad of [null, { conversationId: 'https://evil.test', scope }, { conversationId: '../settings', scope }, { conversationId: dm, scope, url: 'https://evil.test' }, { conversationId: dm, scope: 'bad' }]) assert.equal(parseNotificationDestination(bad), null);
});
test('stale taps cannot open a conversation added long after the tap', () => {
  let now = 10; const queue = new NotificationNavigationQueue(() => now);
  queue.offer({ conversationId: dm, scope }); now += 60_000;
  assert.equal(queue.take({ ready: true, scope, userId, conversations: [{ id: dm, memberIds: [userId] }] }), null);
});
