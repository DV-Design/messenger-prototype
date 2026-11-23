import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_SHARED_FILES, shareTargets, sharedItem, splitText } from '../src/share-intent-model';

test('a shared text, link or set of files becomes one item; anything without content is ignored', () => {
  assert.equal(sharedItem(null), null);
  assert.equal(sharedItem({ text: '   ', files: [] }), null);
  assert.deepEqual(sharedItem({ text: '  Привет  ' }), { text: 'Привет', files: [] });
  assert.deepEqual(sharedItem({ text: null, webUrl: 'https://example.com' }), { text: 'https://example.com', files: [] });
  const item = sharedItem({ files: [{ path: '/data/user/0/ru.lastcall.app/cache/IMG_1.jpg', fileName: '../../IMG_1.jpg', mimeType: 'image/jpeg', size: '2048' as unknown as number }] });
  assert.deepEqual(item, { text: null, files: [{ uri: 'file:///data/user/0/ru.lastcall.app/cache/IMG_1.jpg', name: 'IMG_1.jpg', mime: 'image/jpeg', size: 2048 }] });
  assert.equal(sharedItem({ files: [{ path: 'content://evil/x', fileName: 'x' }] }), null);
  const many = sharedItem({ files: Array.from({ length: 15 }, (_, i) => ({ path: `/cache/f${i}`, fileName: `f${i}` })) });
  assert.equal(many?.files.length, MAX_SHARED_FILES);
});

test('long text is split into messages that fit, preferably at a line or word break', () => {
  const text = ('слово '.repeat(1000)).trim();
  const parts = splitText(text, 4000);
  assert.ok(parts.length >= 2);
  assert.ok(parts.every(part => part.length <= 4000 && part.length > 0));
  assert.equal(parts.join(' '), text);
  assert.deepEqual(splitText('коротко'), ['коротко']);
});

test('targets are the newest chats first, searchable, without groups this phone left', () => {
  const chats = [{ id: 'a', title: 'Мария', updatedAt: 1 }, { id: 'b', title: 'Выходные', updatedAt: 3, removed: true }, { id: 'c', title: 'Олег', updatedAt: 2 }];
  assert.deepEqual(shareTargets(chats).map(c => c.id), ['c', 'a']);
  assert.deepEqual(shareTargets(chats, 'мар').map(c => c.id), ['a']);
});
