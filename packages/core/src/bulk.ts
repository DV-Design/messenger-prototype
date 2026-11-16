import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { bytesToHex, hexToBytes } from './crypto.js';

/**
 * Binary chunk format for large files: [0xB1][file id 16][offset 8, big-endian][ciphertext].
 * Each offer carries a fresh random 32-byte key inside the already end-to-end sealed control
 * channel; the nonce is derived from the offset, so every chunk of one offer has its own, and the
 * id and offset are bound as associated data so a chunk cannot be moved or replayed elsewhere.
 */
export const BULK_MAGIC = 0xb1;
export const BULK_CHUNK_BYTES = 64 * 1024;
const HEADER = 1 + 16 + 8;

// No BigInt: Hermes support for DataView's 64-bit methods is not something to depend on.
function writeOffset(view: DataView, at: number, offset: number) { view.setUint32(at, Math.floor(offset / 0x100000000)); view.setUint32(at + 4, offset >>> 0); }
function readOffset(view: DataView, at: number): number { return view.getUint32(at) * 0x100000000 + view.getUint32(at + 4); }
function nonceFor(offset: number): Uint8Array {
  const nonce = new Uint8Array(24);
  writeOffset(new DataView(nonce.buffer), 16, offset);
  return nonce;
}
function header(id: string, offset: number): Uint8Array {
  const out = new Uint8Array(HEADER);
  out[0] = BULK_MAGIC;
  out.set(hexToBytes(id), 1);
  writeOffset(new DataView(out.buffer), 17, offset);
  return out;
}

export function sealBulkChunk(keyHex: string, id: string, offset: number, data: Uint8Array): Uint8Array<ArrayBuffer> {
  const head = header(id, offset);
  const sealed = xchacha20poly1305(hexToBytes(keyHex), nonceFor(offset), head).encrypt(data);
  const out = new Uint8Array(HEADER + sealed.length);
  out.set(head); out.set(sealed, HEADER);
  return out;
}

export function isBulkChunk(bytes: Uint8Array): boolean { return bytes.length > HEADER && bytes[0] === BULK_MAGIC; }

export function openBulkChunk(keyHex: string, bytes: Uint8Array): { id: string; offset: number; data: Uint8Array } {
  if (!isBulkChunk(bytes)) throw new Error('Not a large-file chunk');
  const head = bytes.subarray(0, HEADER);
  const id = bytesToHex(head.subarray(1, 17));
  const offset = readOffset(new DataView(head.buffer, head.byteOffset, HEADER), 17);
  const data = xchacha20poly1305(hexToBytes(keyHex), nonceFor(offset), head).decrypt(bytes.subarray(HEADER));
  return { id, offset, data };
}

/** What the app gives the core to stream one incoming large file to disk. */
/** `pause` releases the open file on a disconnect but keeps what was written, so the next offer resumes; `abort` discards it. */
export interface BulkSink { offset: number; write(bytes: Uint8Array): Promise<void>; finish(): Promise<void>; abort(): Promise<void>; pause?(): void }
export interface BulkOffer { id: string; conversationId?: string; name: string; mime: string; size: number; metadata?: string }
