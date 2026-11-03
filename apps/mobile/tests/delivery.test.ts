import assert from 'node:assert/strict';
import test from 'node:test';
import { canMarkRead, deliveryIcon, deliveryLabel, deliveryStage, readContentVersion, waitingForDelivery } from '../src/delivery-model';
import { transportNotice } from '../src/transport-notice';

test('only final recipient receipts contribute to group delivery progress', () => {
  const item = { status: 'sent', recipientIds: ['alice', 'bob', 'alice'], deliveredTo: ['alice', 'alice', 'relay'] };
  assert.equal(deliveryLabel(item, true), 'Delivered 1 of 2 · Read 0 of 2');
  assert.equal(deliveryLabel({ status: 'sent' }, false), 'Awaiting confirmation');
  assert.equal(waitingForDelivery(item), true);
  assert.equal(deliveryLabel({ deliveryStatus: 'expired', recipientIds: ['alice'], deliveredTo: [] }, true), 'Not delivered within 7 days');
  assert.equal(waitingForDelivery({ deliveryStatus: 'expired', status: 'complete' }), false);
  assert.equal(deliveryLabel({ deliveryStatus: 'delivered', status: 'complete' }, false), 'Delivered');
});
test('pending files and group sync copy describe sender retention without promising offline delivery', () => {
  assert.match(transportNotice({ directory: 'online', group: false, peerOnline: false, pending: 1 }).text, /Messages and files wait on this device for up to 7 days/);
  assert.match(transportNotice({ directory: 'online', group: true, pending: 1 }).text, /Not all participants have confirmed/);
  assert.match(transportNotice({ directory: 'online', group: true, pending: 0 }).text, /phones/);
});

test('clock, one check and two checks distinguish delivery from reading for messages and files', () => {
  const item = { status: 'sent', recipientIds: ['a', 'b'], deliveredTo: ['a'], readBy: ['a'] };
  assert.equal(deliveryIcon(item), 'time-outline');
  assert.equal(deliveryIcon({ ...item, status: 'delivered' }), 'checkmark');
  assert.equal(deliveryIcon({ ...item, status: 'delivered', readBy: ['a', 'b', 'relay'] }), 'checkmark-done');
  assert.equal(deliveryLabel({ status: 'delivered', recipientIds: ['a'], readBy: ['a'] }, false), 'Read');
  assert.equal(deliveryStage({ deliveryStatus: 'expired', recipientIds: ['a'], readBy: ['a'] }), 'expired');
  assert.equal(deliveryIcon({ deliveryStatus: 'delivered', status: 'complete', recipientIds: ['a'], readBy: [] }), 'checkmark');
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
