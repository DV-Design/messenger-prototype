import assert from 'node:assert/strict';
import test from 'node:test';
import { createDeviceIdentity, openAttachment, sealAttachment } from '@messenger/core';
import { DISK_RESERVE_BYTES, hasDiskRoom, packSealed, packedSize, unpackSealed } from '../src/attachment-file-model';

test('attachments are stored as bytes at half the size and open exactly as before', () => {
  const identity = createDeviceIdentity(n => new Uint8Array(n).fill(7));
  const key = 'ab'.repeat(32);
  const data = new Uint8Array(4096).map((_, index) => index % 251);
  const sealed = sealAttachment(identity, key, data);
  const packed = packSealed(sealed)!;
  assert.ok(packed.length <= packedSize(sealed.length));
  assert.ok(packed.length < sealed.length / 2 + 64);
  assert.deepEqual(openAttachment(identity, key, unpackSealed(packed)), data);
});

test('anything that is not a version-1 envelope is kept as text, and broken bytes are refused', () => {
  assert.equal(packSealed('not json'), null);
  assert.equal(packSealed(JSON.stringify({ version: 2, nonce: 'a'.repeat(48), ciphertext: 'ab' })), null);
  assert.throws(() => unpackSealed(new Uint8Array([1, 2, 3, 4, 5])));
});

test('a save keeps the last 512 MB of the phone free, and unknown free space does not block it', () => {
  assert.equal(hasDiskRoom(DISK_RESERVE_BYTES + 10, 5), true);
  assert.equal(hasDiskRoom(DISK_RESERVE_BYTES + 10, 20), false);
  assert.equal(hasDiskRoom(0, 1e9), true);
});
