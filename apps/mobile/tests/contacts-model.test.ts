import assert from 'node:assert/strict';
import test from 'node:test';
import { filterContacts, uniquePhones, type PhoneContact } from '../src/contacts-model';

test('the same number in different formatting is kept once, blanks are dropped', () => {
  assert.deepEqual(uniquePhones(['+7 (912) 345-67-89', '+79123456789', ' ', undefined, '8 800 100-00-00']), ['+7 (912) 345-67-89', '8 800 100-00-00']);
  assert.deepEqual(uniquePhones([]), []);
});

const book: PhoneContact[] = [
  { id: '1', name: 'Мария Петрова', phones: ['+7 912 345-67-89'] },
  { id: '2', name: 'Alex Smith', phones: ['+1 202 555 0143', '+1 202 555 0199'] },
];

test('search matches any part of the name case-insensitively, in Cyrillic too', () => {
  assert.deepEqual(filterContacts(book, 'петр').map(c => c.id), ['1']);
  assert.deepEqual(filterContacts(book, 'SMI').map(c => c.id), ['2']);
  assert.deepEqual(filterContacts(book, '  ').map(c => c.id), ['1', '2']);
});

test('search by number ignores formatting, but needs at least three digits', () => {
  assert.deepEqual(filterContacts(book, '555-0199').map(c => c.id), ['2']);
  assert.deepEqual(filterContacts(book, '9123').map(c => c.id), ['1']);
  assert.deepEqual(filterContacts(book, '12').map(c => c.id), []);
});
