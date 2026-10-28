import assert from 'node:assert/strict';
import test from 'node:test';
import { deliveryLabel, waitingForDelivery } from '../src/delivery-model';
import { transportNotice } from '../src/transport-notice';

test('only final recipient receipts contribute to group delivery progress', () => {
  const item = { status: 'sent', recipientIds: ['alice', 'bob', 'alice'], deliveredTo: ['alice', 'alice', 'relay'] };
  assert.equal(deliveryLabel(item, true), 'Доставлено 1 из 2');
  assert.equal(deliveryLabel({ status: 'sent' }, false), 'Ожидает подтверждения');
  assert.equal(waitingForDelivery(item), true);
  assert.equal(deliveryLabel({ deliveryStatus: 'expired', recipientIds: ['alice'], deliveredTo: [] }, true), 'Не доставлено за 7 дней');
  assert.equal(waitingForDelivery({ deliveryStatus: 'expired', status: 'complete' }), false);
  assert.equal(deliveryLabel({ deliveryStatus: 'delivered', status: 'complete' }, false), 'Доставлено');
});
test('pending files and group sync copy describe sender retention without promising offline delivery', () => {
  assert.match(transportNotice({ directory: 'online', group: false, peerOnline: false, pending: 1 }).text, /Сообщения и файлы ждут на этом устройстве до 7 дней/);
  assert.match(transportNotice({ directory: 'online', group: true, pending: 1 }).text, /не все участники подтвердили/);
  assert.match(transportNotice({ directory: 'online', group: true, pending: 0 }).text, /между телефонами/);
});
