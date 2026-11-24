import { describe, expect, it } from 'vitest';
import { createDeviceIdentity, type DirectoryUser } from './directory.js';
import { sealAttachment } from './persistence.js';
import { MessengerClient } from './messenger.js';

const alice = createDeviceIdentity(n => new Uint8Array(n).fill(91));
const bob = createDeviceIdentity(n => new Uint8Array(n).fill(92));
const bobUser: DirectoryUser = { userId: bob.userId, publicKey: bob.publicKey, username: 'bob', displayName: 'Bob', online: false, lastSeen: 1 };

describe('files are encrypted on the way, not on the phone', () => {
  it('writes a new file as plain bytes and still reads an older sealed one', async () => {
    const plain = new Map<string, Uint8Array>(); const sealed = new Map<string, string>();
    const options = { savePlainAttachment: async (key: string, data: Uint8Array) => { plain.set(key, data.slice()); }, loadPlainAttachment: async (key: string) => plain.get(key) ?? null,
      saveAttachment: async (key: string, value: string) => { sealed.set(key, value); }, loadAttachment: async (key: string) => sealed.get(key) ?? null };
    const client = new MessengerClient({ serverUrl: 'https://example.com', identity: alice, username: 'alice', displayName: 'Alice', ...options });
    const id = await client.addContact(bobUser);
    await client.sendFile(id, { name: 'photo.jpg', mime: 'image/jpeg', data: new Uint8Array([1, 2, 3]) });
    const file = client.getSnapshot().conversations[0]!.files[0]!;
    expect([...plain.values()][0]).toEqual(new Uint8Array([1, 2, 3])); expect(sealed.size).toBe(0);
    (client as any).blobs.clear();
    expect(await client.getFileData(id, file.id)).toEqual(new Uint8Array([1, 2, 3]));
    // An attachment saved before 1.0.43 is sealed: it opens as before.
    plain.clear(); (client as any).blobs.clear(); sealed.set(file.blobKey!, sealAttachment(alice, file.blobKey!, new Uint8Array([9, 8, 7])));
    expect(await client.getFileData(id, file.id)).toEqual(new Uint8Array([9, 8, 7]));
    client.disconnect();
  });
});
