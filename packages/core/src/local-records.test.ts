import { afterEach, expect, it, vi } from 'vitest';
import { createDeviceIdentity, type DeviceIdentity, type DirectoryUser } from './directory.js';
import { MessengerClient } from './messenger.js';
import { LocalRecordCipher, LocalRecordWriter, type LocalRecord, type LocalRecordStore } from './local-records.js';
import { contentHash } from './group-sync.js';
import { signReadReceipt } from './read-receipt.js';

const alice = createDeviceIdentity(n => new Uint8Array(n).fill(121));
const bob = createDeviceIdentity(n => new Uint8Array(n).fill(122));
const user = (i: DeviceIdentity, name: string): DirectoryUser => ({ userId: i.userId, publicKey: i.publicKey, username: name, displayName: name, online: false, lastSeen: 1 });

/** An in-memory store with SQLite's all-or-nothing writes. */
function recordStore() {
  const rows = new Map<string, string>();
  const writes: { put: LocalRecord[]; remove: string[] }[] = [];
  let failNext = false;
  const store: LocalRecordStore & { rows: Map<string, string>; writes: typeof writes; failOnce(): void } = {
    rows, writes,
    failOnce() { failNext = true; },
    load: async () => [...rows].map(([key, value]) => ({ key, value })),
    write: async (put, remove) => {
      if (failNext) { failNext = false; throw new Error('disk full'); }
      writes.push({ put, remove });
      for (const key of remove) rows.delete(key);
      for (const row of put) rows.set(row.key, row.value);
    },
  };
  return store;
}
function attachments() {
  const blobs = new Map<string, string>();
  return { saveAttachment: async (k: string, s: string) => { blobs.set(k, s); }, loadAttachment: async (k: string) => blobs.get(k) ?? null };
}
const clients: MessengerClient[] = [];
afterEach(() => { for (const c of clients.splice(0)) c.disconnect(); });
function make(options: Partial<ConstructorParameters<typeof MessengerClient>[0]>, identity = alice) {
  const c = new MessengerClient({ identity, serverUrl: 'https://example.com', username: 'tester', displayName: 'Tester', ...attachments(), ...options });
  clients.push(c);
  return { c, i: c as any };
}
const conversation = (c: MessengerClient, id: string) => c.getSnapshot().conversations.find(item => item.id === id)!;

it('keeps the history across restarts as records', async () => {
  const store = recordStore();
  const a = make({ records: store });
  const id = await a.c.addContact(user(bob, 'bob'));
  await a.c.sendText(id, 'first');
  await a.c.sendText(id, 'second');
  await a.i.persist();
  expect([...store.rows.keys()].some(key => key.startsWith('i:'))).toBe(true);
  const restored = make({ records: store });
  await restored.i.restore();
  expect(conversation(restored.c, id).messages.map(m => m.text)).toEqual(['first', 'second']);
  expect(restored.c.getSnapshot().contacts.map(c => c.userId)).toEqual([bob.userId]);
});

it('writes only the records that changed', async () => {
  const store = recordStore();
  const a = make({ records: store });
  const id = await a.c.addContact(user(bob, 'bob'));
  for (let n = 0; n < 30; n++) await a.c.sendText(id, `message ${n}`);
  await a.i.persist();
  const total = store.rows.size;
  const target = conversation(a.c, id).messages[10]!;
  await a.i.receiveApplication(bob.userId, signReadReceipt(bob, { conversationId: id, author: alice.userId, id: target.id, type: 'message', hash: contentHash('message', target.text) }));
  await a.i.persist();
  const last = store.writes.at(-1)!;
  // The read message itself, its list's order, and what the receipt touched — not the 30-message history.
  expect(last.put.length).toBeLessThanOrEqual(6);
  expect(last.put.length).toBeLessThan(total / 4);
  const restored = make({ records: store });
  await restored.i.restore();
  expect(conversation(restored.c, id).messages[10]!.readBy).toEqual([bob.userId]);
  expect(conversation(restored.c, id).messages).toHaveLength(30);
});

it('moves an existing single-file history into records and clears the old file only after', async () => {
  let sealed: string | null = null;
  const legacy = make({ loadState: async () => sealed, saveState: async (s: string) => { sealed = s; } });
  const id = await legacy.c.addContact(user(bob, 'bob'));
  await legacy.c.sendText(id, 'from the old file');
  await legacy.i.persist();
  expect(sealed).not.toBeNull();

  const store = recordStore();
  const clearLegacyState = vi.fn(async () => { sealed = null; });
  store.failOnce();
  const migrating = make({ records: store, loadState: async () => sealed, clearLegacyState });
  await migrating.i.restore();
  expect(conversation(migrating.c, id).messages[0]!.text).toBe('from the old file');
  await expect(migrating.i.persist()).rejects.toThrow('disk full');
  expect(clearLegacyState).not.toHaveBeenCalled(); // a failed first write keeps the old file
  await migrating.i.persist();
  expect(clearLegacyState).toHaveBeenCalledTimes(1);
  expect(sealed).toBeNull();

  const restored = make({ records: store, loadState: async () => sealed });
  await restored.i.restore();
  expect(conversation(restored.c, id).messages[0]!.text).toBe('from the old file');
});

it('rewrites after a failed write instead of assuming it landed', async () => {
  const store = recordStore();
  const a = make({ records: store });
  const id = await a.c.addContact(user(bob, 'bob'));
  await a.c.sendText(id, 'kept');
  await a.i.persist();
  a.i.conversations.get(id).title = 'Renamed';
  a.i.dirty = true;
  store.failOnce();
  await expect(a.i.persist()).rejects.toThrow('disk full');
  await a.i.persist(); // the failure left it dirty; this write must still carry the change
  const restored = make({ records: store });
  await restored.i.restore();
  expect(conversation(restored.c, id).title).toBe('Renamed');
  expect(conversation(restored.c, id).messages.map(m => m.text)).toEqual(['kept']);
});

it('refuses a history with a missing or moved record', async () => {
  const store = recordStore();
  const a = make({ records: store });
  const id = await a.c.addContact(user(bob, 'bob'));
  await a.c.sendText(id, 'one');
  await a.c.sendText(id, 'two');
  await a.i.persist();
  const items = [...store.rows.keys()].filter(key => key.startsWith('i:'));
  const missing = new Map(store.rows); missing.delete(items[0]!);
  const writerMissing = new LocalRecordWriter({ load: async () => [...missing].map(([key, value]) => ({ key, value })), write: async () => {} }, new LocalRecordCipher(alice));
  await expect(writerMissing.read()).rejects.toThrow('Invalid local records');
  const swapped = new Map(store.rows); swapped.set(items[0]!, store.rows.get(items[1]!)!);
  const writerSwapped = new LocalRecordWriter({ load: async () => [...swapped].map(([key, value]) => ({ key, value })), write: async () => {} }, new LocalRecordCipher(alice));
  await expect(writerSwapped.read()).rejects.toThrow();
});

it('another device key cannot open the records', async () => {
  const store = recordStore();
  const a = make({ records: store });
  await a.c.addContact(user(bob, 'bob'));
  await a.i.persist();
  await expect(new LocalRecordWriter(store, new LocalRecordCipher(bob)).read()).rejects.toThrow();
});
