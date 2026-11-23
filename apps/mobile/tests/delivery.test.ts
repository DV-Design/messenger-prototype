import assert from 'node:assert/strict';
import test from 'node:test';
import { canMarkRead, deliveryColor, deliveryIcon, deliveryLabel, deliveryStage, readContentVersion, waitingForDelivery } from '../src/delivery-model';
import { transportNotice } from '../src/transport-notice';

test('only final recipient receipts contribute to group delivery progress', () => {
  const item = { status: 'sent', recipientIds: ['alice', 'bob', 'alice'], deliveredTo: ['alice', 'alice', 'relay'] };
  assert.equal(deliveryLabel(item, true), 'Delivered 1 of 2 · Read 0 of 2');
  assert.equal(deliveryLabel({ status: 'sent' }, false), 'Awaiting delivery · up to 7 days');
  assert.equal(waitingForDelivery(item), true);
  assert.equal(deliveryLabel({ deliveryStatus: 'expired', recipientIds: ['alice'], deliveredTo: [] }, true), 'Not delivered within 7 days');
  assert.equal(waitingForDelivery({ deliveryStatus: 'expired', status: 'complete' }), false);
  assert.equal(deliveryLabel({ deliveryStatus: 'delivered', status: 'complete' }, false), 'Delivered');
});
test('offline copy says messages arrive later and files need both phones, without promising more than 7 days', () => {
  assert.match(transportNotice({ directory: 'online', group: false, peerOnline: false, pending: 1 }).text, /files once both phones are online\. Waiting up to 7 days/);
  assert.match(transportNotice({ directory: 'offline', group: false, peerOnline: false, pending: 1 }).text, /wait on this device for up to 7 days/);
  assert.match(transportNotice({ directory: 'online', group: true, pending: 1 }).text, /Not all participants have confirmed/);
  assert.match(transportNotice({ directory: 'online', group: true, pending: 0 }).text, /phones/);
});

test('clock, one tick, two ticks and two blue ticks, for messages and files', () => {
  const item = { status: 'sent', recipientIds: ['a', 'b'], deliveredTo: ['a'], readBy: ['a'] };
  assert.equal(deliveryIcon(item), 'time-outline');
  assert.equal(deliveryIcon({ ...item, notifiedTo: ['b'] }), 'checkmark'); // a delivered, b notified
  assert.equal(deliveryIcon({ ...item, status: 'delivered' }), 'checkmark-done');
  assert.equal(deliveryColor({ ...item, status: 'delivered' }), '#70877D');
  assert.equal(deliveryIcon({ ...item, status: 'delivered', readBy: ['a', 'b', 'relay'] }), 'checkmark-done');
  assert.equal(deliveryColor({ ...item, status: 'delivered', readBy: ['a', 'b'] }), '#2F8FE0');
  assert.equal(deliveryLabel({ status: 'delivered', recipientIds: ['a'], readBy: ['a'] }, false), 'Read');
  assert.equal(deliveryStage({ deliveryStatus: 'expired', recipientIds: ['a'], readBy: ['a'], notifiedTo: ['a'] }), 'expired');
  assert.equal(deliveryIcon({ deliveryStatus: 'delivered', status: 'complete', recipientIds: ['a'], readBy: [] }), 'checkmark-done');
  assert.equal(deliveryIcon({ deliveryStatus: 'pending', status: 'complete', recipientIds: ['a'], notifiedTo: ['a'] }), 'checkmark');
});
test('a push request is never shown as delivery: one tick only, and only when every recipient was notified', () => {
  assert.equal(deliveryStage({ status: 'pending', recipientIds: ['a', 'b'], notifiedTo: ['a'] }), 'sending');
  assert.equal(deliveryStage({ status: 'pending', recipientIds: ['a', 'b'], notifiedTo: ['a', 'b'] }), 'notified');
  assert.equal(deliveryLabel({ status: 'pending', recipientIds: ['a'], notifiedTo: ['a'] }, false), 'Sent · the recipient was notified');
  assert.equal(deliveryStage({ status: 'pending' }), 'sending');
});
test('background, locked, unfocused and notification-drawer chat routes do not read content', () => {
  assert.equal(canMarkRead(true, 'active'), true);
  for (const state of ['background', 'inactive', 'unknown']) assert.equal(canMarkRead(true, state), false);
  assert.equal(canMarkRead(false, 'active'), false);
  assert.equal(canMarkRead(true, 'active', false), false);
});

test('read pass tracks incoming file completion and history identities without reacting to receipts', () => {
  const message = { id: 'message-1', from: 'alice', status: 'received' };
  const receiving = { id: 'file-1', senderId: 'alice', status: 'receiving', deliveryStatus: 'received' };
  const complete = { ...receiving, status: 'complete', blobKey: 'blob-1' };
  const initial = readContentVersion([message], [receiving]);
  assert.notEqual(readContentVersion([message], [complete]), initial);
  assert.equal(readContentVersion([message], [receiving]), readContentVersion([message], []));
  assert.notEqual(readContentVersion([{ ...message, id: 'message-2' }], [receiving]), initial);
  assert.notEqual(readContentVersion([{ ...message, from: 'bob' }], [receiving]), initial);
  const afterReceipt = { ...message, readBy: ['bob'] };
  assert.equal(readContentVersion([afterReceipt], [receiving]), initial);
  assert.equal(readContentVersion([{ ...message }], [{ ...receiving, status: 'receiving' }]), initial);
});

test('a message notice names who wrote and how much is unread, never the text', async () => {
  const { unreadNotice } = await import('../src/push-preview-model');
  assert.deepEqual(unreadNotice('Мария', null, 1), { title: 'Мария', body: 'You have an unread message' });
  assert.deepEqual(unreadNotice('Мария', null, 3), { title: 'Мария', body: 'You have unread messages: 3' });
  assert.deepEqual(unreadNotice('Мария', 'Выходные', 2), { title: 'Выходные', body: 'Unread messages in the group: 2. Last from Мария' });
});
