import assert from 'node:assert/strict';
import test from 'node:test';
import { formatContactText, formatLocationText, mapsUrl, parseContactText, parseLocationText } from '../src/location-contact';

test('a one-time location round-trips and renders as a plain Google Maps link for older clients', () => {
  const text = formatLocationText('Location', 55.751244, 37.618423, false);
  assert.equal(text, '📍 Location\nhttps://maps.google.com/?q=55.751244,37.618423');
  assert.deepEqual(parseLocationText(text), { lat: 55.751244, lng: 37.618423, live: false });
});

test('a live location is marked distinctly and still carries the same link', () => {
  const text = formatLocationText('Live location · until 18:45', 10, -20.5, true);
  assert.ok(text.startsWith('🔴 '));
  assert.deepEqual(parseLocationText(text), { lat: 10, lng: -20.5, live: true });
  assert.equal(mapsUrl(10, -20.5), 'https://maps.google.com/?q=10,-20.5');
});

test('plain text, and text that merely mentions a maps link without the marker, do not parse as a location', () => {
  assert.equal(parseLocationText('Привет, как дела?'), undefined);
  assert.equal(parseLocationText('Check this out: https://maps.google.com/?q=1,2'), undefined);
  assert.equal(parseLocationText('📍 no link here'), undefined);
});

test('out-of-range or non-numeric coordinates are rejected even if the shape matches', () => {
  assert.equal(parseLocationText('📍 x\nhttps://maps.google.com/?q=999,37'), undefined);
  assert.equal(parseLocationText('📍 x\nhttps://maps.google.com/?q=55,999'), undefined);
});

test('a contact round-trips with one or more phone numbers', () => {
  const text = formatContactText('Ada Lovelace', ['+1 234 567 8900']);
  assert.equal(text, '👤 Ada Lovelace\n+1 234 567 8900');
  assert.deepEqual(parseContactText(text), { name: 'Ada Lovelace', phones: ['+1 234 567 8900'] });

  const multi = formatContactText('Grace Hopper', [' +1 111 222 3333 ', '+1 444 555 6666']);
  assert.deepEqual(parseContactText(multi), { name: 'Grace Hopper', phones: ['+1 111 222 3333', '+1 444 555 6666'] });
});

test('a contact needs at least one phone number to format, and at most five are kept', () => {
  assert.throws(() => formatContactText('No Phone', []));
  const seven = Array.from({ length: 7 }, (_, index) => `+1 000 000 000${index}`);
  const many = formatContactText('Many', seven);
  assert.equal(parseContactText(many)!.phones.length, 5);
});

test('text that does not match the contact marker, or mixes in a non-phone line, does not parse', () => {
  assert.equal(parseContactText('👤 \n+1 234'), undefined); // empty name
  assert.equal(parseContactText('👤 Name only'), undefined); // no phone line
  assert.equal(parseContactText('👤 Name\n+1 234\nsome prose line'), undefined);
  assert.equal(parseContactText('Hi 👤 Name\n+1 234'), undefined); // marker must open the text
});

test('location and contact shapes never both match the same text', () => {
  const location = formatLocationText('Location', 1, 2, false);
  const contact = formatContactText('Name', ['+1 234']);
  assert.equal(parseContactText(location), undefined);
  assert.equal(parseLocationText(contact), undefined);
});
