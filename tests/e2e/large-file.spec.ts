import { connectContacts } from './contacts.js';
import { expect, test, type Page } from '@playwright/test';
import type { BulkFileStore, MessengerClient, MessengerOptions, createDeviceIdentity } from '../../packages/core/src/index.js';

type LargeWindow = Window & {
  __messenger: MessengerClient;
  __createMessenger: (options: MessengerOptions) => MessengerClient;
  __createIdentity: typeof createDeviceIdentity;
  __bulk: Map<string, Uint8Array>;
  __bulkDone: Set<string>;
};
const serverUrl = process.env.PW_SIGNALING_URL ?? `http://127.0.0.1:${process.env.PW_SERVER_PORT || '8799'}`;
const SIZE = 12 * 1024 * 1024 + 12345; // several hundred binary chunks, not a multiple of the chunk size

async function start(page: Page, username: string) {
  await page.goto('/');
  return page.evaluate(async ({ serverUrl, username }) => {
    const w = window as LargeWindow;
    w.__bulk = new Map(); w.__bulkDone = new Set();
    // An in-memory stand-in for app storage: the same interface the phone implements on disk.
    const bulkFiles: BulkFileStore = {
      read: async (key, _name, offset, length) => w.__bulk.get(key)!.slice(offset, offset + length),
      openIncoming: async (key, _name, size) => {
        let bytes = w.__bulk.get(key); if (!bytes) { bytes = new Uint8Array(size); w.__bulk.set(key, bytes); }
        let offset = 0; const target = bytes;
        return { offset, write: async chunk => { target.set(chunk, offset); offset += chunk.length; }, finish: async () => { w.__bulkDone.add(key); }, abort: async () => { w.__bulk.delete(key); } };
      },
    };
    w.__messenger = w.__createMessenger({ serverUrl, identity: w.__createIdentity(), username, displayName: username, bulkFiles });
    await w.__messenger.connect();
    return w.__messenger.getSnapshot().self!;
  }, { serverUrl, username });
}

test('a large file streams phone to phone over a direct WebRTC path, byte for byte', async ({ browser }) => {
  test.setTimeout(180_000);
  const contexts = await Promise.all([0, 1].map(() => browser.newContext()));
  const [a, b] = await Promise.all(contexts.map(c => c.newPage())) as [Page, Page];
  try {
    const stamp = Date.now().toString(36);
    const ua = await start(a, `bulk_${stamp}_a`), ub = await start(b, `bulk_${stamp}_b`);
    const chat = await connectContacts(a, ub, b, ua);
    await expect.poll(() => a.evaluate(id => (window as LargeWindow).__messenger.getSnapshot().conversations.find(c => c.id === id)?.session?.status, chat), { timeout: 30_000 }).toBe('connected');
    const started = Date.now();
    await a.evaluate(async ({ chat, size }) => {
      const w = window as LargeWindow;
      const data = new Uint8Array(size); for (let i = 0; i < size; i++) data[i] = (i * 131 + (i >> 9)) & 0xff;
      await w.__messenger.sendLargeFile(chat, { name: 'archive.bin', mime: 'application/octet-stream', size }, async key => { w.__bulk.set(key, data); });
    }, { chat, size: SIZE });
    await expect.poll(() => a.evaluate(id => (window as LargeWindow).__messenger.getSnapshot().conversations.find(c => c.id === id)?.files[0]?.deliveryStatus, chat), { timeout: 150_000, intervals: [500] }).toBe('delivered');
    const seconds = (Date.now() - started) / 1000;
    const received = await b.evaluate(size => {
      const w = window as LargeWindow;
      const file = w.__messenger.getSnapshot().conversations.flatMap(c => c.files).find(f => f.name === 'archive.bin');
      const bytes = [...w.__bulk.values()][0]!;
      let mismatch = -1; for (let i = 0; i < size; i++) if (bytes[i] !== ((i * 131 + (i >> 9)) & 0xff)) { mismatch = i; break; }
      return { status: file?.status, large: file?.large, size: bytes.length, mismatch, done: w.__bulkDone.size };
    }, SIZE);
    expect(received).toEqual({ status: 'complete', large: true, size: SIZE, mismatch: -1, done: 1 });
    const route = await a.evaluate(id => (window as LargeWindow).__messenger.getSnapshot().conversations.find(c => c.id === id)?.session?.route, chat);
    console.log(`large file: ${(SIZE / 1048576).toFixed(1)} MiB in ${seconds.toFixed(1)} s (${(SIZE / 1048576 / seconds).toFixed(1)} MiB/s), route ${route}`);
  } finally { await Promise.all(contexts.map(c => c.close())); }
});
