import { afterEach, expect, it, vi } from 'vitest';
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes } from './crypto.js';
import { createDeviceIdentity } from './directory.js';
import { openLocalState, sealLocalState } from './persistence.js';

afterEach(() => vi.unstubAllGlobals());

const identity = createDeviceIdentity(size => new Uint8Array(size).fill(7));
const state = { version: 7, note: 'Привет, история', list: Array.from({ length: 300 }, (_, i) => i) };
const encoder = new TextEncoder();

it('seals local state as base64 (version 2) and opens it again', () => {
  const sealed = sealLocalState(identity, state);
  const envelope = JSON.parse(sealed) as { version: number; ciphertext: string };
  expect(envelope.version).toBe(2);
  expect(envelope.ciphertext).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
  expect(openLocalState(identity, sealed)).toEqual(state);
});

it('still opens state saved as hex (version 1) by earlier releases', () => {
  // Built exactly as releases up to 1.0.34 wrote it.
  const nonce = new Uint8Array(24).fill(3);
  const key = hkdf(sha256, hexToBytes(identity.privateKey), encoder.encode('messenger/local-state/hkdf/v2'), encoder.encode(identity.userId), 32);
  const ciphertext = xchacha20poly1305(key, nonce, encoder.encode('messenger/local-state/v2/' + identity.userId)).encrypt(encoder.encode(JSON.stringify(state)));
  const legacy = JSON.stringify({ version: 1, nonce: bytesToHex(nonce), ciphertext: bytesToHex(ciphertext) });
  expect(openLocalState(identity, legacy)).toEqual(state);
});

it('falls back to hex where the platform has no base64', () => {
  vi.stubGlobal('btoa', undefined);
  const sealed = sealLocalState(identity, state);
  expect((JSON.parse(sealed) as { version: number }).version).toBe(1);
  expect(openLocalState(identity, sealed)).toEqual(state);
});

it('rejects a tampered or mislabelled envelope', () => {
  const envelope = JSON.parse(sealLocalState(identity, state)) as { version: number; nonce: string; ciphertext: string };
  expect(() => openLocalState(identity, JSON.stringify({ ...envelope, version: 1 }))).toThrow('Invalid sealed local state');
  const flipped = envelope.ciphertext.startsWith('A') ? 'B' + envelope.ciphertext.slice(1) : 'A' + envelope.ciphertext.slice(1);
  expect(() => openLocalState(identity, JSON.stringify({ ...envelope, ciphertext: flipped }))).toThrow();
});
