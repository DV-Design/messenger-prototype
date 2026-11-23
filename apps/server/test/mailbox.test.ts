import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDeviceIdentity, MessengerClient, type DeviceIdentity, type MessengerSnapshot } from '@messenger/core';
import { createSignalingServer } from '../src/server.js';
import { Mailbox } from '../src/mailbox.js';

const servers: ReturnType<typeof createSignalingServer>[] = [];
const clients: MessengerClient[] = [];
afterEach(async () => {
  for (const client of clients.splice(0)) client.disconnect();
  await Promise.all(servers.splice(0).map(server => server.close()));
});
async function start() {
  const server = createSignalingServer({ port: 0 }); servers.push(server);
  return (await server.listen()).url;
}
function client(url: string, identity: DeviceIdentity, username: string, mailbox = true) {
  const value = new MessengerClient({ serverUrl: url, identity, username, displayName: username.toUpperCase(), mailbox, reconcileDeliveryOnConnect: true }); clients.push(value);
  return value;
}
async function until(check: () => boolean, ms = 8000) {
  const deadline = Date.now() + ms;
  while (!check()) { if (Date.now() > deadline) throw new Error('Timed out'); await new Promise(resolve => setTimeout(resolve, 25)); }
}
const chat = (snapshot: MessengerSnapshot, id: string) => snapshot.conversations.find(c => c.id === id);

describe('encrypted server mailbox, end to end', () => {
  it('delivers a text to a phone that was offline, then reports delivered and read to the sender', async () => {
    const url = await start();
    const aliceId = createDeviceIdentity(), bobId = createDeviceIdentity();
    // Bob registers once, so the server knows his app takes mailbox items, then goes offline.
    let bob = client(url, bobId, 'bob'); await bob.connect(); await bob.getServices(); bob.disconnect();
    const alice = client(url, aliceId, 'alice'); await alice.connect(); await alice.getServices();
    const [bobUser] = await alice.search('bob');
    const conversation = await alice.addContact(bobUser!);
    await alice.sendText(conversation, 'Сообщение, пока Боб не в сети');
    await until(() => chat(alice.getSnapshot(), conversation)?.messages[0]?.status === 'sent');
    expect(chat(alice.getSnapshot(), conversation)!.messages[0]!.notifiedTo).toEqual([bobId.userId]);

    bob = client(url, bobId, 'bob'); await bob.connect();
    await until(() => chat(bob.getSnapshot(), conversation)?.messages.length === 1);
    const received = chat(bob.getSnapshot(), conversation)!.messages[0]!;
    expect(received).toMatchObject({ text: 'Сообщение, пока Боб не в сети', status: 'received', from: aliceId.userId });
    expect(bob.getSnapshot().contacts.map(c => c.userId)).toEqual([aliceId.userId]);
    await until(() => chat(alice.getSnapshot(), conversation)?.messages[0]?.status === 'delivered');

    await bob.markRead(conversation);
    await until(() => (chat(alice.getSnapshot(), conversation)?.messages[0]?.readBy ?? []).includes(bobId.userId));
  }, 30_000);

  it('announces a file in its place and keeps the bytes for the direct path', async () => {
    const url = await start();
    const aliceId = createDeviceIdentity(), bobId = createDeviceIdentity();
    let bob = client(url, bobId, 'bob'); await bob.connect(); await bob.getServices(); bob.disconnect();
    const alice = client(url, aliceId, 'alice'); await alice.connect(); await alice.getServices();
    const conversation = await alice.addContact((await alice.search('bob'))[0]!);
    await alice.sendText(conversation, 'Сейчас пришлю фото');
    await new Promise(resolve => setTimeout(resolve, 5));
    await alice.sendFile(conversation, { name: 'фото.jpg', mime: 'image/jpeg', data: new Uint8Array([1, 2, 3]) });
    await new Promise(resolve => setTimeout(resolve, 5));
    await alice.sendText(conversation, 'Вот оно');
    await until(() => (chat(alice.getSnapshot(), conversation)?.files[0]?.notifiedTo ?? []).length === 1);
    expect(chat(alice.getSnapshot(), conversation)!.files[0]!.deliveryStatus).toBe('pending');

    bob = client(url, bobId, 'bob'); await bob.connect();
    await until(() => chat(bob.getSnapshot(), conversation)?.messages.length === 2 && chat(bob.getSnapshot(), conversation)?.files.length === 1);
    const c = chat(bob.getSnapshot(), conversation)!;
    expect(c.files[0]).toMatchObject({ name: 'фото.jpg', size: 3, waiting: true, status: 'receiving', receivedBytes: 0 });
    expect(c.files[0]!.blobKey).toBeUndefined();
    const order = [...c.messages.map(m => [m.timestamp, m.text]), ...c.files.map(f => [f.timestamp, f.name])].sort((a, b) => Number(a[0]) - Number(b[0])).map(x => x[1]);
    expect(order).toEqual(['Сейчас пришлю фото', 'фото.jpg', 'Вот оно']);
  }, 30_000);

  it('brings a group and its message to members who were offline when it was created', async () => {
    const url = await start();
    const aliceId = createDeviceIdentity(), bobId = createDeviceIdentity(), carolId = createDeviceIdentity();
    for (const [identity, name] of [[bobId, 'bob'], [carolId, 'carol']] as const) { const c = client(url, identity, name); await c.connect(); await c.getServices(); c.disconnect(); }
    const alice = client(url, aliceId, 'alice'); await alice.connect(); await alice.getServices();
    for (const name of ['bob', 'carol']) await alice.addContact((await alice.search(name))[0]!);
    const group = await alice.createGroup('Выходные', [bobId.userId, carolId.userId]);
    await alice.sendText(group, 'Встречаемся в субботу');
    await until(() => chat(alice.getSnapshot(), group)?.messages[0]?.notifiedTo?.length === 2);
    const bob = client(url, bobId, 'bob'); await bob.connect();
    await until(() => chat(bob.getSnapshot(), group)?.messages.length === 1);
    expect(chat(bob.getSnapshot(), group)).toMatchObject({ kind: 'group', title: 'Выходные' });
    expect(chat(bob.getSnapshot(), group)!.messages[0]!.text).toBe('Встречаемся в субботу');
    await until(() => (chat(alice.getSnapshot(), group)?.messages[0]?.deliveredTo ?? []).includes(bobId.userId));
    expect(chat(alice.getSnapshot(), group)!.messages[0]!.status).toBe('sent');
  }, 30_000);

  it('leaves an older app on the direct path: the server refuses its mailbox', async () => {
    const url = await start();
    const aliceId = createDeviceIdentity(), bobId = createDeviceIdentity();
    const old = client(url, bobId, 'bob', false); await old.connect(); old.disconnect();
    const alice = client(url, aliceId, 'alice'); await alice.connect(); await alice.getServices();
    const conversation = await alice.addContact((await alice.search('bob'))[0]!);
    await alice.sendText(conversation, 'Только напрямую');
    await new Promise(resolve => setTimeout(resolve, 500));
    const message = chat(alice.getSnapshot(), conversation)!.messages[0]!;
    expect(message.status).toBe('pending');expect(message.notifiedTo ?? []).toEqual([]);
  }, 30_000);
});

describe('mailbox storage rules', () => {
  function fixture(online = new Set<string>()) {
    const db = new DatabaseSync(':memory:'); let now = 1_000_000;
    db.exec('CREATE TABLE push_consent (recipient_id TEXT NOT NULL, sender_id TEXT NOT NULL, PRIMARY KEY (recipient_id, sender_id)) STRICT;');
    const push = vi.fn(async (_recipient: string, _expiresAt: number) => {});
    const nudge = vi.fn((id: string) => online.has(id));
    const mailbox = new Mailbox(db, { now: () => now, reserve: () => {}, push, nudge, isOnline: id => online.has(id) });
    return { db, mailbox, push, nudge, advance: (ms: number) => { now += ms; }, now: () => now };
  }
  const a = 'aa'.repeat(32), b = 'bb'.repeat(32);
  const item = (id: string, kind: 'message' | 'file' | 'app' = 'message') => ({ id, kind, envelope: 'ab'.repeat(60), expiresAt: Number.MAX_SAFE_INTEGER });
  it('keeps items in order, removes taken ones and leaves a receipt only for delivered messages', () => {
    const f = fixture(); f.mailbox.enable(b);
    expect(f.mailbox.put(a, b, [item('01'.repeat(16)), item('02'.repeat(16), 'file'), item('03'.repeat(16), 'app')])).toEqual({ accepted: true });
    expect(f.mailbox.put(a, b, [item('01'.repeat(16))])).toEqual({ accepted: true });
    const page = f.mailbox.fetch(b, 0, () => undefined);
    expect(page.items.map(x => [x.id.slice(0, 2), x.kind])).toEqual([['01', 'message'], ['02', 'file'], ['03', 'app']]);
    f.mailbox.ack(b, page.items.map(x => ({ from: x.from, id: x.id, delivered: true })), []);
    expect(f.mailbox.fetch(b, 0, () => undefined).items).toHaveLength(0);
    expect(f.mailbox.fetch(a, 0, () => undefined).receipts).toEqual([{ to: b, id: '01'.repeat(16) }]);
    f.mailbox.ack(a, [], [{ to: b, id: '01'.repeat(16) }]);
    expect(f.mailbox.fetch(a, 0, () => undefined).receipts).toEqual([]);
  });
  it('overwrites deleted ciphertext instead of leaving it in free pages', () => {
    const f = fixture();
    expect(f.db.prepare('PRAGMA secure_delete').get()).toEqual({ secure_delete: 1 });
  });
  it('refuses phones without the mailbox and drops items after their deadline', () => {
    const f = fixture();
    expect(f.mailbox.put(a, b, [item('01'.repeat(16))])).toEqual({ accepted: false, reason: 'unsupported' });
    f.mailbox.enable(b); f.mailbox.put(a, b, [{ ...item('01'.repeat(16)), expiresAt: f.now() + 1000 }]);
    f.advance(1000); f.mailbox.expire();
    expect(f.db.prepare('SELECT COUNT(*) AS n FROM mailbox_items').get()).toEqual({ n: 0 });
  });
  it('pushes an offline contact once per burst, never for strangers or service records, and retries later', async () => {
    const f = fixture(); f.mailbox.enable(b);
    f.mailbox.put(a, b, [item('01'.repeat(16))]); await Promise.resolve();
    expect(f.push).not.toHaveBeenCalled(); // Bob has not allowed Alice.
    f.db.prepare('INSERT INTO push_consent VALUES (?,?)').run(b, a);
    f.mailbox.put(a, b, [item('02'.repeat(16), 'app')]); await f.mailbox.tick();
    expect(f.push).toHaveBeenCalledTimes(1);
    f.mailbox.put(a, b, [item('03'.repeat(16))]); await f.mailbox.tick();
    expect(f.push).toHaveBeenCalledTimes(1);
    f.advance(15_000); await f.mailbox.tick(); expect(f.push).toHaveBeenCalledTimes(2);
    await f.mailbox.tick(); expect(f.push).toHaveBeenCalledTimes(2);
    f.advance(20 * 60_000); await f.mailbox.tick(); expect(f.push).toHaveBeenCalledTimes(3);
  });
  it('nudges a connected recipient instead of pushing', () => {
    const f = fixture(new Set([b])); f.mailbox.enable(b);
    f.db.prepare('INSERT INTO push_consent VALUES (?,?)').run(b, a);
    f.mailbox.put(a, b, [item('01'.repeat(16))]);
    expect(f.nudge).toHaveBeenCalledWith(b); expect(f.push).not.toHaveBeenCalled();
  });
});
