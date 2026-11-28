import { afterEach, expect, it } from 'vitest';
import { createDeviceIdentity, conversationInvite, type DeviceIdentity, type DirectoryUser } from './directory.js';
import { MessengerClient } from './messenger.js';
import type { LocalRecord, LocalRecordStore } from './local-records.js';

const alice = createDeviceIdentity(n => new Uint8Array(n).fill(131));
const bob = createDeviceIdentity(n => new Uint8Array(n).fill(132));
const user = (i: DeviceIdentity, name: string): DirectoryUser => ({ userId: i.userId, publicKey: i.publicKey, username: name, displayName: name, online: false, lastSeen: 1 });

/** A disk that answers only when told to, like a busy phone. */
function slowStore() {
  const waiting: Array<{ resolve: () => void; reject: (error: Error) => void }> = [];
  const store: LocalRecordStore & { waiting: typeof waiting } = {
    waiting,
    load: async () => [],
    write: (_put: LocalRecord[], _remove: string[]) => new Promise<void>((resolve, reject) => { waiting.push({ resolve, reject }); }),
  };
  return store;
}
const clients: MessengerClient[] = [];
afterEach(() => { for (const c of clients.splice(0)) c.disconnect(); });
async function make(store: LocalRecordStore) {
  const c = new MessengerClient({ identity: alice, serverUrl: 'https://example.com', username: 'alice', displayName: 'Alice', records: store, saveAttachment: async () => {}, loadAttachment: async () => null } as never);
  clients.push(c);
  const pending = c.addContact(user(bob, 'bob'));
  for (let i = 0; i < 20 && !(store as ReturnType<typeof slowStore>).waiting.length; i++) await new Promise(resolve => setTimeout(resolve, 1));
  (store as ReturnType<typeof slowStore>).waiting.splice(0).forEach(item => item.resolve());
  return { c, id: await pending };
}
const texts = (c: MessengerClient, id: string) => c.getSnapshot().conversations.find(item => item.id === id)!.messages.map(m => `${m.text}:${m.status}`);

it('a sent text is in the chat at once, before the disk write and any network', async () => {
  const store = slowStore();
  const { c, id } = await make(store);
  let seen: string[] = [];
  const unsubscribe = (c as unknown as { options: { onChange?: (s: unknown) => void } }).options;
  unsubscribe.onChange = () => { seen = texts(c, id); };
  const sending = c.sendText(id, 'Напиши как пойдёте,');
  // No await yet: the message is already shown, waiting with a clock.
  expect(texts(c, id)).toEqual(['Напиши как пойдёте,:pending']);
  expect(seen).toEqual(['Напиши как пойдёте,:pending']);
  // It is not handed to the network before it is on disk.
  expect((c as unknown as { committed: Set<string> }).committed.size).toBe(0);
  for (let i = 0; i < 50 && !store.waiting.length; i++) await new Promise(resolve => setTimeout(resolve, 1));
  store.waiting.splice(0).forEach(item => item.resolve());
  await sending;
  expect((c as unknown as { committed: Set<string> }).committed.size).toBe(1);
  expect(texts(c, id)).toEqual(['Напиши как пойдёте,:pending']);
});

it('texts sent quickly one after another keep their order, each once', async () => {
  const store = slowStore();
  const { c, id } = await make(store);
  const all = ['one', 'two', 'three'].map(text => c.sendText(id, text));
  expect(texts(c, id)).toEqual(['one:pending', 'two:pending', 'three:pending']);
  for (let round = 0; round < 3; round++) {
    for (let i = 0; i < 50 && !store.waiting.length; i++) await new Promise(resolve => setTimeout(resolve, 1));
    store.waiting.splice(0).forEach(item => item.resolve());
  }
  await Promise.all(all);
  expect(texts(c, id)).toEqual(['one:pending', 'two:pending', 'three:pending']);
});

it('a text the disk could not keep leaves the chat and the send reports the failure', async () => {
  const store = slowStore();
  const { c, id } = await make(store);
  const sending = c.sendText(id, 'lost');
  expect(texts(c, id)).toEqual(['lost:pending']);
  for (let i = 0; i < 50 && !store.waiting.length; i++) await new Promise(resolve => setTimeout(resolve, 1));
  store.waiting.splice(0).forEach(item => item.reject(new Error('disk full')));
  await expect(sending).rejects.toThrow('disk full');
  expect(texts(c, id)).toEqual([]);
  expect((c as unknown as { pending: unknown[] }).pending).toEqual([]);
});

it('a blank text is refused at once', async () => {
  const { c, id } = await make(slowStore());
  await expect(c.sendText(id, '   ')).rejects.toThrow('Text must contain');
  expect(texts(c, id)).toEqual([]);
});

it('the pair key is derived once per contact', () => {
  const first = conversationInvite(alice, bob.publicKey);
  const started = performance.now();
  for (let i = 0; i < 200; i++) expect(conversationInvite(alice, bob.publicKey)).toBe(first);
  expect(performance.now() - started).toBeLessThan(50);
  expect(conversationInvite(bob, alice.publicKey)).toBe(first);
});
