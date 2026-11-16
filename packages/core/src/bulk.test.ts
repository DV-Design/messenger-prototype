import { describe, it, expect } from 'vitest';
import { openBulkChunk, sealBulkChunk, isBulkChunk } from './bulk.js';

const key = 'ab'.repeat(32), id = 'cd'.repeat(16);
describe('large-file chunks', () => {
  it('round-trip with the offset bound, including offsets above 4 GiB arithmetic', () => {
    const data = new Uint8Array([1, 2, 3, 4, 5]);
    for (const offset of [0, 65536, 1024 * 1024 * 1024 - 5, 0x100000000 + 7]) {
      const opened = openBulkChunk(key, sealBulkChunk(key, id, offset, data));
      expect(opened.id).toBe(id); expect(opened.offset).toBe(offset); expect([...opened.data]).toEqual([...data]);
    }
  });
  it('rejects a chunk moved to another offset, a wrong key, or tampering', () => {
    const sealed = sealBulkChunk(key, id, 4096, new Uint8Array(100).fill(9));
    const moved = sealed.slice(); moved[24] = 1; // last byte of the offset
    expect(() => openBulkChunk(key, moved)).toThrow();
    expect(() => openBulkChunk('cd'.repeat(32), sealed)).toThrow();
    const flipped = sealed.slice(); flipped[flipped.length - 1]! ^= 1;
    expect(() => openBulkChunk(key, flipped)).toThrow();
    expect(isBulkChunk(new TextEncoder().encode('{"kind":"text"}'))).toBe(false);
  });
});
