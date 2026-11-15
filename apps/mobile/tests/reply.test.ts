import assert from 'node:assert/strict';
import test from 'node:test';
import { formatReplyText, parseReplyText, quotedMessageSnippet, replyBody } from '../src/reply';
import { formatLocationText, formatContactText } from '../src/location-contact';

const AUTHOR = 'a'.repeat(64);
const ID = 'b'.repeat(32);

test('a reply round-trips and keeps the body fully readable below the marker line', () => {
  const text = formatReplyText({ type: 'message', author: AUTHOR, id: ID }, 'Sounds good, see you then');
  assert.equal(text, `↩️ message:${AUTHOR}:${ID}\nSounds good, see you then`);
  assert.deepEqual(parseReplyText(text), { type: 'message', author: AUTHOR, id: ID, text: 'Sounds good, see you then' });
});

test('a reply to a file target round-trips the same way', () => {
  const text = formatReplyText({ type: 'file', author: AUTHOR, id: ID }, 'nice photo');
  assert.deepEqual(parseReplyText(text), { type: 'file', author: AUTHOR, id: ID, text: 'nice photo' });
});

test('a multi-line reply body survives intact', () => {
  const text = formatReplyText({ type: 'message', author: AUTHOR, id: ID }, 'line one\nline two\n\nline four');
  assert.equal(parseReplyText(text)!.text, 'line one\nline two\n\nline four');
});

test('plain text, and text that merely resembles the marker, do not parse as a reply', () => {
  assert.equal(parseReplyText('Hi, how are you?'), undefined);
  assert.equal(parseReplyText(`↩️ message:${AUTHOR}:${ID}`), undefined); // no body line at all
  assert.equal(parseReplyText(`something ↩️ message:${AUTHOR}:${ID}\nbody`), undefined); // marker must open the text
  assert.equal(parseReplyText(`↩️ message:short:${ID}\nbody`), undefined); // author not 64 hex chars
});

test('replyBody strips one level of marker and leaves plain text untouched', () => {
  const quoted = formatReplyText({ type: 'message', author: AUTHOR, id: ID }, 'original body');
  assert.equal(replyBody(quoted), 'original body');
  assert.equal(replyBody('just a plain message'), 'just a plain message');
});

test('quotedMessageSnippet describes a location, a live location, a contact, and plain text', () => {
  assert.equal(quotedMessageSnippet(formatLocationText('Location', 1, 2, false)), 'Location');
  assert.equal(quotedMessageSnippet(formatLocationText('Live location', 1, 2, true)), 'Live location');
  assert.equal(quotedMessageSnippet(formatContactText('Ada Lovelace', ['+1 555 0100'])), '👤 Ada Lovelace');
  assert.equal(quotedMessageSnippet('  hello   world  '), 'hello world');
});

test('quotedMessageSnippet unwraps one level of a nested reply, matching replyBody', () => {
  const nested = formatReplyText({ type: 'message', author: AUTHOR, id: ID }, 'the actual text');
  assert.equal(quotedMessageSnippet(nested), 'the actual text');
});
