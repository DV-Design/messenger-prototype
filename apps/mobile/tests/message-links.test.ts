import assert from 'node:assert/strict';
import test from 'node:test';
import { messageParts } from '../src/message-links';

test('web addresses, bare domains and e-mail become links; the text around them is kept', () => {
  assert.deepEqual(messageParts('see https://lienad.ru/a?b=1, or example.com.'), [
    { text: 'see ' }, { text: 'https://lienad.ru/a?b=1', url: 'https://lienad.ru/a?b=1' }, { text: ', or ' }, { text: 'example.com', url: 'http://example.com' }, { text: '.' },
  ]);
  assert.deepEqual(messageParts('mail admin@lienad.ru'), [{ text: 'mail ' }, { text: 'admin@lienad.ru', url: 'mailto:admin@lienad.ru' }]);
  assert.deepEqual(messageParts('Привет, как дела?'), [{ text: 'Привет, как дела?' }]);
  assert.deepEqual(messageParts(''), [{ text: '' }]);
});

test('other schemes and IP addresses stay plain text', () => {
  assert.ok(messageParts('ftp://files.example.com/x').every(part => !part.url));
  assert.ok(messageParts('ping 192.168.1.1').every(part => !part.url));
  assert.ok(messageParts('javascript:alert(1)').every(part => !part.url));
  assert.equal(messageParts('a https://x.org b https://y.org').filter(part => part.url).length, 2);
});
