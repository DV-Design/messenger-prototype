import { describe, expect, it } from 'vitest';
import { createDeviceIdentity, directConversationId, type DirectoryUser } from './directory.js';
import type { LocalRecordStore } from './local-records.js';
import { MessengerClient } from './messenger.js';

const alice = createDeviceIdentity(n => new Uint8Array(n).fill(81));
const bob = createDeviceIdentity(n => new Uint8Array(n).fill(82));
const bobUser: DirectoryUser = { userId: bob.userId, publicKey: bob.publicKey, username: 'bob', displayName: 'Bob', online: false, lastSeen: 1 };

function store(withArchive = true) {
  const rows = new Map<string, string>(); const archive = new Map<string, string>();
  const value: LocalRecordStore = {
    load: async () => [...rows].map(([key, v]) => ({ key, value: v })),
    write: async (put, remove, extra) => { for (const key of remove) rows.delete(key); for (const row of put) rows.set(row.key, row.value); for (const row of extra ?? []) archive.set(row.key, row.value); },
    ...(withArchive ? {
      loadArchive: async (prefix: string, before: string | undefined, limit: number) => [...archive.keys()].filter(key => key.startsWith(prefix) && (before === undefined || key < before)).sort().reverse().slice(0, limit).map(key => ({ key, value: archive.get(key)! })),
      dropArchive: async (prefix: string) => { for (const key of [...archive.keys()]) if (key.startsWith(prefix)) archive.delete(key); },
    } : {}),
  };
  return { value, rows, archive };
}
const client = (records: LocalRecordStore) => new MessengerClient({ serverUrl: 'https://example.com', identity: alice, username: 'alice', displayName: 'Alice', records });
async function fill(c: MessengerClient, count: number) {
  const internal = c as any; await internal.restore();
  const id = directConversationId(alice.userId, bob.userId);
  internal.remember(bobUser); const conv = internal.ensureDirect(bobUser);
  for (let i = 0; i < count; i++) conv.messages.push({ id: i.toString(16).padStart(32, '0'), text: `message ${i}`, from: bob.userId, timestamp: 1_000 + i, status: 'received', conversationId: id, expiresAt: 1_000 + i });
  internal.changed(); await c.flushState(); return id;
}

describe('history beyond the in-memory limit is archived, not lost', () => {
  it('keeps the newest 100 in memory and the rest in the encrypted archive, readable page by page', async () => {
    const s = store(); const first = client(s.value);
    const id = await fill(first, 130); first.disconnect();
    expect(s.archive.size).toBe(30);
    expect([...s.archive.values()].join('')).not.toContain('message 1');
    const second = client(s.value); await (second as any).restore();
    const chat = second.getSnapshot().conversations.find(c => c.id === id)!;
    expect(chat.messages.length).toBe(100); expect(chat.archived).toBe(30);
    expect(chat.messages[0]!.text).toBe('message 30');
    const page1 = await second.loadEarlier(id, undefined, 20);
    expect(page1.messages.map(m => m.text)).toEqual(Array.from({ length: 20 }, (_, i) => `message ${29 - i}`));
    const page2 = await second.loadEarlier(id, page1.cursor, 20);
    expect(page2.messages.map(m => m.text)).toEqual(Array.from({ length: 10 }, (_, i) => `message ${9 - i}`));
    await second.deleteChat(id); await second.flushState();
    expect(s.archive.size).toBe(0);
    second.disconnect();
  });
  it('a store without an archive keeps the old behaviour', async () => {
    const s = store(false); const c = client(s.value);
    const id = await fill(c, 130);
    expect(c.getSnapshot().conversations.find(x => x.id === id)!.messages.length).toBe(100);
    expect(c.getSnapshot().conversations.find(x => x.id === id)!.archived).toBeUndefined();
    expect((await c.loadEarlier(id)).messages).toEqual([]);
    c.disconnect();
  });
});
