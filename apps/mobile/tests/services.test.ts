import assert from 'node:assert/strict';
import test from 'node:test';
import { createDeviceIdentity, phoneLookupHash, type PhoneMatch } from '@messenger/core';
import { discoverBatches, discoveryIndex, MAX_DISCOVERY_CONTACTS } from '../src/discovery-model';
import { sanitizeDiagnostic } from '../src/diagnostics';
import type { DeviceContact } from '../src/phonebook-model';
const contact = (id: string, phones: string[]): DeviceContact => ({ id, name: `Локальное имя ${id}`, phones, usernames: [] });
const identity = createDeviceIdentity(() => new Uint8Array(32).fill(7));
const user = { userId: identity.userId, publicKey: identity.publicKey, username: 'alice', displayName: 'Алиса', online: false, lastSeen: 0 };

test('local normalization deduplicates formats and ignores invalid numbers without inferring ownership', () => {
  const records = [contact('private-contact-id', ['8 (999) 123-45-67', '+79991234567', 'not a phone']), contact('second', ['+79991234567'])];
  const index = discoveryIndex(records, 'RU');
  assert.equal(index.size, 1);
  assert.deepEqual([...index.keys()], [phoneLookupHash('+79991234567')]);
  assert.equal(index.values().next().value?.length, 2);
  assert.equal('userId' in records[0]!, false);
  assert.throws(() => discoveryIndex(Array.from({ length: MAX_DISCOVERY_CONTACTS + 1 }, (_, i) => contact(`${i}`, []))), /2000/);
});

test('discovery sends only <=100 hashes, rejects unrequested results and requires own verification', async () => {
  const index = new Map(Array.from({ length: 205 }, (_, i) => [i.toString(16).padStart(64, '0'), [contact(`${i}`, ['private-phone'])]]));
  let calls = 0;
  await assert.rejects(discoverBatches(index, false, async () => { calls++; return []; }), /подтвердите/);
  assert.equal(calls, 0);
  const sizes: number[] = [];
  const found = await discoverBatches(index, true, async hashes => {
    sizes.push(hashes.length);
    assert.ok(hashes.every(hash => /^[0-9a-f]{64}$/.test(hash)));
    return [{ hash: hashes[0]!, user }, { hash: 'z'.repeat(64), user: { ...user, userId: 'a'.repeat(64) } }];
  });
  assert.deepEqual(sizes, [100, 100, 5]);
  assert.equal(found.length, 1);
  assert.equal(found[0]?.user.userId, user.userId);
});

test('revoking consent cancels subsequent batches and discards outstanding lookup results', async () => {
  const index = new Map(Array.from({ length: 101 }, (_, i) => [i.toString(16).padStart(64, '0'), []]));
  let active = true; let calls = 0;
  await assert.rejects(discoverBatches(index, true, async hashes => { calls++; active = false; return [{ hash: hashes[0]!, user }] satisfies PhoneMatch[]; }, () => active), /отменён/);
  assert.equal(calls, 1);
});

test('diagnostics redact known names/usernames/messages/keys case-insensitively including regex characters', () => {
  const privateValues = ['Иван Петров', 'ivan_test', 'Alice (QA)+', 'личное сообщение', identity.privateKey];
  const input = `ИВАН ПЕТРОВ / ivan_TEST: ICE failure; Alice (QA)+: личное сообщение; @someone; +7 (999) 123-45-67; ${identity.privateKey}\nnext`;
  const output = sanitizeDiagnostic(input, privateValues);
  for (const value of ['иван', 'ivan_test', 'Alice', 'личное сообщение', '999', identity.privateKey, '@someone']) assert.equal(output.toLowerCase().includes(value.toLowerCase()), false, value);
  assert.match(output, /ICE failure/);
  assert.equal(output.includes('\n'), false);
  assert.equal(sanitizeDiagnostic(undefined, []), '—');
});
