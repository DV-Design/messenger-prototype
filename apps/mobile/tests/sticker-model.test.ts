import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STICKER_MARK, formatGif, formatSticker, parseGif, parseSticker, richPreview } from '../src/sticker-model';

const known = (emoji: string) => emoji === '😂' || emoji === '❤️';

test('a sticker is the emoji behind an invisible mark; unknown or plain emoji stay text', () => {
  assert.equal(formatSticker('😂'), `${STICKER_MARK}😂`);
  assert.equal(parseSticker(formatSticker('😂'), known), '😂');
  assert.equal(parseSticker(formatSticker('❤️'), known), '❤️');
  assert.equal(parseSticker('😂', known), undefined);
  assert.equal(parseSticker(formatSticker('🦖'), known), undefined);
  assert.equal(parseSticker(`${STICKER_MARK}hello there`, known), undefined);
});

test('a GIF keeps its size and only KLIPY HTTPS links are shown inline', () => {
  const text = formatGif({ url: 'https://static.klipy.com/ii/abc/md.webp', width: 480.4, height: 270 });
  assert.equal(text, `${STICKER_MARK}https://static.klipy.com/ii/abc/md.webp#lc=480x270`);
  assert.deepEqual(parseGif(text), { url: 'https://static.klipy.com/ii/abc/md.webp', width: 480, height: 270 });
  assert.deepEqual(parseGif(formatGif({ url: 'https://static.klipy.com/s.webp', width: 200, height: 200, sticker: true })), { url: 'https://static.klipy.com/s.webp', width: 200, height: 200, sticker: true });
  assert.equal(parseGif(`${STICKER_MARK}http://static.klipy.com/a.gif`), undefined);
  assert.equal(parseGif(`${STICKER_MARK}https://evil.example/klipy.com/a.gif`), undefined);
  assert.equal(parseGif(`${STICKER_MARK}https://klipy.com.evil.example/a.gif`), undefined);
  assert.equal(parseGif('https://static.klipy.com/a.gif'), undefined);
});

test('previews name stickers and GIFs instead of showing the mark or the link', () => {
  const words = { sticker: 'Sticker', gif: 'GIF' };
  assert.equal(richPreview(formatSticker('😂'), known, words), '😂 Sticker');
  assert.equal(richPreview(formatGif({ url: 'https://static.klipy.com/x.gif', width: 2, height: 1 }), known, words), 'GIF');
  assert.equal(richPreview('hello', known, words), undefined);
});
