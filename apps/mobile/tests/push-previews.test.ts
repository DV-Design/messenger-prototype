import assert from 'node:assert/strict';
import test from 'node:test';
import type { MessengerSnapshot } from '@messenger/core';
import { IncomingMessageTracker, MAX_PREVIEW_BODY_BYTES, PreviewDeduper, isEncryptedMessagePreview, isLocalMessagePreview, messagePreviewBody, notificationIdentity, parseMessagePreview, type SeenPreview } from '../src/push-preview-model';
const now = 1_800_000_000_000;
const payload = { kind: 'lastcall-wake', intentKind: 'message', intentId: 'a'.repeat(32), expiresAt: String(now + 60_000), preview: '{"ciphertext":"opaque"}' };
test('file push metadata and P2P file use an independent stable notification origin', () => {
  assert.equal(parseMessagePreview({ data: { ...payload, intentKind: 'file' } }, now)?.intent.kind, 'file');
  assert.notEqual(notificationIdentity('s', 'author', 'group', 'id', 'file'), notificationIdentity('s', 'author', 'group', 'id', 'message'));
  const tracker = new IncomingMessageTracker(); tracker.next(snapshot('online', []));
  const next = snapshot('online', []);
  next.conversations[0]!.files.push({ id: 'e'.repeat(32), timestamp: now, senderId: sender.userId, from: 'peer', conversationId: 'dm:chat', name: 'photo.jpg', mime: 'image/jpeg', size: 5, receivedBytes: 5, status: 'complete', deliveryStatus: 'received', blobKey: 'f'.repeat(64) });
  assert.equal(tracker.next(next)[0]?.kind, 'file'); assert.deepEqual(tracker.next(next), []);
});
test('preview accepts bounded Expo raw/task/dataString/receipt/response wrappers only with complete message intent', () => {
  const wrappers = [payload, { data: payload }, { notification: null, data: { dataString: JSON.stringify(payload) } }, { data: { notification: null, data: { dataString: JSON.stringify(payload) } } }, { request: { content: { data: payload } } }, { notification: { request: { content: { data: payload } } } }];
  for (const wrapper of wrappers) {
    const parsed = parseMessagePreview(wrapper, now);
    assert.equal(parsed?.envelope, payload.preview);
    assert.equal(parsed?.intent.expiresAt, now + 60_000);
  }
  assert.equal(parseMessagePreview({ ...payload, intentKind: 'call' }, now), null);
  assert.equal(parseMessagePreview({ ...payload, intentId: undefined }, now), null);
  assert.equal(parseMessagePreview({ ...payload, expiresAt: String(now) }, now), null);
  assert.equal(parseMessagePreview({ ...payload, expiresAt: String(now + 66_000) }, now), null);
});
test('spoofed plaintext names are ignored; malformed/conflicting/oversized wrappers fail closed', () => {
  const result = parseMessagePreview({ ...payload, sender: 'Untrusted sender', text: 'UNAUTHENTICATED' }, now);
  assert.deepEqual(Object.keys(result!).sort(), ['envelope', 'intent']);
  assert.equal(parseMessagePreview({ ...payload, preview: 'я'.repeat(1501) }, now), null);
  assert.equal(parseMessagePreview({ data: { dataString: 'not JSON' } }, now), null);
  assert.equal(parseMessagePreview({ ...payload, data: { ...payload, preview: 'different' } }, now), null);
  const cyclic: Record<string, unknown> = {}; cyclic.data = cyclic;
  assert.equal(parseMessagePreview(cyclic, now), null);
  assert.equal(isEncryptedMessagePreview({ data: payload }), true);
  assert.equal(isLocalMessagePreview({ data: { kind: 'lastcall-message-preview' } }), true);
  assert.equal(parseMessagePreview({ data: { kind: 'lastcall-message-preview', preview: payload.preview } }, now), null);
});
test('short text is exact and long Unicode bodies truncate by UTF8 without splitting code points', () => {
  const short = 'Привет\nHello 🙂'; assert.equal(messagePreviewBody(short), short);
  for (const text of ['я'.repeat(800), '🙂'.repeat(300), 'a'.repeat(800)]) {
    const body = messagePreviewBody(text, true);
    assert.ok(new TextEncoder().encode(body).length <= MAX_PREVIEW_BODY_BYTES);
    assert.ok(body.endsWith('…'));
    assert.equal(new TextDecoder().decode(new TextEncoder().encode(body)), body);
    assert.equal(body.includes('\uFFFD'), false);
  }
});
test('notification identity separates account/server/author but matches preview and P2P origin IDs', () => {
  const id = notificationIdentity('server:a', 'sender', 'chat', 'message');
  assert.equal(id, notificationIdentity('server:a', 'sender', 'chat', 'message'));
  assert.notEqual(id, notificationIdentity('server:b', 'sender', 'chat', 'message'));
  assert.notEqual(id, notificationIdentity('server:a', 'forwarder', 'chat', 'message'));
});
test('simultaneous task/receipt and later process replay notify once; tap/dismiss does not reset durable dedup', async () => {
  let saved: SeenPreview[] | null = null; let displayed = 0;
  const storage = { load: async () => saved, save: async (value: SeenPreview[]) => { saved = value; }, contains: async () => false };
  const first = new PreviewDeduper(storage, () => now);
  const id = 'lastcall-message-' + 'a'.repeat(64);
  await Promise.all([first.run(id, async () => { displayed++; return true; }), first.run(id, async () => { displayed++; return true; })]);
  await new PreviewDeduper(storage, () => now + 1000).run(id, async () => { displayed++; return true; });
  assert.equal(displayed, 1);
});
test('native presented ID covers crash gap; a failed schedule is retryable', async () => {
  const id = 'lastcall-message-' + 'b'.repeat(64); let displayed = 0; let saved: SeenPreview[] = [];
  const deduper = new PreviewDeduper({ load: async () => null, save: async value => { saved = value; }, contains: async value => value === id }, () => now);
  await deduper.run(id, async () => { displayed++; return true; });
  assert.equal(displayed, 0); assert.equal(saved.length, 1);
  const retry = new PreviewDeduper({ load: async () => null, save: async () => {}, contains: async () => false }, () => now);
  await assert.rejects(retry.run(id, async () => { throw new Error('OS failed'); }), /OS failed/);
  assert.equal(await retry.run(id, async () => true), true);
});
const sender = { userId: 'b'.repeat(64), publicKey: 'c'.repeat(64), username: 'sender', displayName: 'Имя из сохранённого профиля', online: true, lastSeen: now };
const message = (id: string) => ({ id, text: 'Authenticated P2P', from: sender.userId, timestamp: now, status: 'received' as const, conversationId: 'dm:chat' });
function snapshot(status: MessengerSnapshot['status'], ids: string[]): MessengerSnapshot { return { status, contacts: [sender], conversations: [{ id: 'dm:chat', kind: 'direct', title: 'Contact', memberIds: ['own', sender.userId], messages: ids.map(message), files: [], unread: 1, updatedAt: now }] }; }
test('empty/restore/ready snapshots baseline old history; only fresh authenticated received IDs become notification candidates', () => {
  const tracker = new IncomingMessageTracker();
  assert.deepEqual(tracker.next(snapshot('idle', [])), []);
  assert.deepEqual(tracker.next(snapshot('idle', ['old'])), []);
  assert.deepEqual(tracker.next(snapshot('online', ['old'])), []);
  const incoming = tracker.next(snapshot('online', ['old', 'new']));
  assert.equal(incoming.length, 1); assert.equal(incoming[0]?.messageId, 'new'); assert.equal(incoming[0]?.displayName, sender.displayName);
  assert.deepEqual(tracker.next(snapshot('online', ['old', 'new'])), []);
  // An already authenticated P2P channel can deliver while the directory reconnects.
  assert.equal(tracker.next(snapshot('offline', ['old', 'new', 'during-handover'])).length, 1);
});
