import { describe, it, expect, vi } from 'vitest';
import { createDeviceIdentity, directConversationId, type DeviceIdentity, type DirectoryUser } from './directory.js';
import { MessengerClient, type BulkFileStore } from './messenger.js';
import { encodeDirectFileTiming } from './direct-file.js';
import { OUTBOX_TTL_MS } from './group-sync.js';

const alice = createDeviceIdentity(n => new Uint8Array(n).fill(61));
const bob = createDeviceIdentity(n => new Uint8Array(n).fill(67));
const user = (identity: DeviceIdentity, username: string): DirectoryUser => ({ userId: identity.userId, publicKey: identity.publicKey, username, displayName: username, online: true, lastSeen: 1 });

function store(): BulkFileStore & { files: Map<string, number[]>; done: Set<string> } {
  const files = new Map<string, number[]>(), done = new Set<string>();
  return { files, done,
    read: async (key, _name, offset, length) => new Uint8Array(length).fill(offset % 251),
    openIncoming: async (key, _name, size) => { const bytes = files.get(key) ?? []; files.set(key, bytes); return { offset: Math.min(bytes.length, size), write: async chunk => { for (const b of chunk) bytes.push(b); }, finish: async () => { done.add(key); }, abort: async () => {} }; } };
}
function pair(route: 'direct' | 'relay', sendBulk = vi.fn(async () => {})) {
  return { flushing: false, attempt: 0, lastSent: new Map(), definitions: new Set(), lastUsed: Date.now(), notified: false,
    session: { getSnapshot: () => ({ status: 'connected', callState: 'idle', files: [] }), supportsBulk: () => true, currentRoute: async () => route, sendBulk, sendText: vi.fn(), sendApplication: vi.fn(), supportsMessageChanges: () => false, supportsReactions: () => false, disconnect: () => {} } };
}

describe('large files in the messenger', () => {
  it('queues like text, streams only over a direct path, and counts as delivered on the receiver ack', async () => {
    const files = store();
    const client = new MessengerClient({ serverUrl: 'https://lienad.ru/messenger', identity: alice, username: 'alice', displayName: 'Alice', bulkFiles: files });
    try {
      const id = await client.addContact(user(bob, 'bob'));
      const adopted: string[] = [];
      await client.sendLargeFile(id, { name: 'movie.mp4', mime: 'video/mp4', size: 300 * 1024 * 1024 }, async key => { adopted.push(key); });
      expect(adopted).toHaveLength(1);
      let file = client.getSnapshot().conversations[0]!.files[0]!;
      expect(file.large).toBe(true); expect(file.deliveryStatus).toBe('pending');
      const internal = client as any;
      const relayed = pair('relay');internal.pairs.set(bob.userId, relayed);
      internal.startBulk(bob.userId, relayed, internal.conversations.get(id), internal.conversations.get(id).files[0]);
      await vi.waitFor(() => expect(internal.bulkActive.size).toBe(0));
      expect(relayed.session.sendBulk).not.toHaveBeenCalled(); // never through TURN
      const direct = pair('direct');internal.pairs.set(bob.userId, direct);
      internal.startBulk(bob.userId, direct, internal.conversations.get(id), internal.conversations.get(id).files[0]);
      await vi.waitFor(() => expect(client.getSnapshot().conversations[0]!.files[0]!.deliveryStatus).toBe('delivered'));
      file = client.getSnapshot().conversations[0]!.files[0]!;
      expect(direct.session.sendBulk).toHaveBeenCalledTimes(1);
      const [offer] = (direct.session.sendBulk.mock.calls[0] as unknown as [{ size: number; name: string }]);
      expect(offer.size).toBe(300 * 1024 * 1024); expect(offer.name).toBe('movie.mp4');
      await expect(client.sendLargeFile(id, { name: 'x', mime: '', size: 1024 * 1024 * 1024 + 1 }, async () => {})).rejects.toThrow(/1 GiB/);
    } finally { client.disconnect(); }
  });
  it('accepts an offer from the author into app storage and completes the record on finish', async () => {
    const files = store();
    const client = new MessengerClient({ serverUrl: 'https://lienad.ru/messenger', identity: bob, username: 'bob', displayName: 'Bob', bulkFiles: files });
    try {
      const id = await client.addContact(user(alice, 'alice'));
      expect(id).toBe(directConversationId(alice.userId, bob.userId));
      const now = Date.now();const fileId = 'ab'.repeat(16);
      const sink = await (client as any).receiveBulkOffer(alice.userId, { id: fileId, conversationId: id, name: 'big.zip', mime: 'application/zip', size: 10, metadata: encodeDirectFileTiming({ id: fileId, conversationId: id, timestamp: now, expiresAt: now + OUTBOX_TTL_MS }) });
      expect(sink.offset).toBe(0);
      let record = client.getSnapshot().conversations[0]!.files[0]!;
      expect(record.status).toBe('receiving'); expect(record.large).toBe(true);
      await sink.write(new Uint8Array(10)); await sink.finish();
      record = client.getSnapshot().conversations[0]!.files[0]!;
      expect(record.status).toBe('complete'); expect(record.receivedBytes).toBe(10);
      expect(await (client as any).receiveBulkOffer('cd'.repeat(32), { id: fileId, conversationId: id, name: 'x', mime: '', size: 1 })).toBeUndefined(); // a stranger
    } finally { client.disconnect(); }
  });
});
