import { bytesToHex, hexToBytes } from '@messenger/core';

/**
 * On-disk form of an encrypted attachment. Core seals to JSON with hex, which
 * doubles the size; the phone stores the same nonce and ciphertext as bytes.
 * Older ".sealed" JSON files stay readable.
 */
const MAGIC = [0x4c, 0x43, 0x41, 0x31]; // "LCA1"
const NONCE_BYTES = 24;
/** Space kept free on the phone so LastCall never fills it completely. */
export const DISK_RESERVE_BYTES = 512 * 1024 * 1024;

export function packSealed(sealed: string): Uint8Array | null {
  let value: unknown;
  try { value = JSON.parse(sealed); } catch { return null; }
  const envelope = value as { version?: unknown; nonce?: unknown; ciphertext?: unknown } | null;
  if (!envelope || typeof envelope !== 'object' || Object.keys(envelope).length !== 3 || envelope.version !== 1
    || typeof envelope.nonce !== 'string' || !/^[a-f0-9]{48}$/.test(envelope.nonce)
    || typeof envelope.ciphertext !== 'string' || !/^(?:[a-f0-9]{2})+$/.test(envelope.ciphertext)) return null;
  const ciphertext = hexToBytes(envelope.ciphertext);
  const out = new Uint8Array(MAGIC.length + NONCE_BYTES + ciphertext.length);
  out.set(MAGIC, 0); out.set(hexToBytes(envelope.nonce), MAGIC.length); out.set(ciphertext, MAGIC.length + NONCE_BYTES);
  return out;
}

export function unpackSealed(bytes: Uint8Array): string {
  if (bytes.length <= MAGIC.length + NONCE_BYTES || MAGIC.some((value, index) => bytes[index] !== value)) throw new Error('Invalid stored attachment');
  return JSON.stringify({ version: 1, nonce: bytesToHex(bytes.subarray(MAGIC.length, MAGIC.length + NONCE_BYTES)), ciphertext: bytesToHex(bytes.subarray(MAGIC.length + NONCE_BYTES)) });
}

/** Bytes on disk for a sealed JSON envelope of this length. */
export const packedSize = (sealedLength: number) => Math.ceil(sealedLength / 2);

export function hasDiskRoom(available: number, needed: number): boolean {
  // Unknown (0 or not a number) must not block saving; the write itself still fails cleanly when full.
  return !(available > 0) || available - needed >= DISK_RESERVE_BYTES;
}
