import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mp4Duration } from '../src/media-duration-model';

function box(type: string, body: number[]) { const size = 8 + body.length; return [size >>> 24, (size >>> 16) & 255, (size >>> 8) & 255, size & 255, ...[...type].map(c => c.charCodeAt(0)), ...body]; }
const u32 = (n: number) => [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];

test('reads the length of a recording from its movie header (version 0)', () => {
  const mvhd = box('mvhd', [0, 0, 0, 0, ...u32(1), ...u32(2), ...u32(44100), ...u32(44100 * 36 + 22050), ...new Array(80).fill(0)]);
  const file = new Uint8Array([...box('ftyp', [0x4d, 0x34, 0x41, 0x20]), ...box('moov', mvhd)]);
  assert.equal(mp4Duration(file), 36.5);
});

test('reads 64-bit lengths (version 1) and refuses missing or broken headers', () => {
  const mvhd = box('mvhd', [1, 0, 0, 0, ...u32(0), ...u32(1), ...u32(0), ...u32(2), ...u32(1000), ...u32(0), ...u32(12_000), ...new Array(80).fill(0)]);
  assert.equal(mp4Duration(new Uint8Array(box('moov', mvhd))), 12);
  assert.equal(mp4Duration(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])), undefined);
  assert.equal(mp4Duration(new Uint8Array(box('moov', box('mvhd', [0, 0, 0, 0, ...u32(1), ...u32(2), ...u32(0), ...u32(5)])))), undefined);
});
