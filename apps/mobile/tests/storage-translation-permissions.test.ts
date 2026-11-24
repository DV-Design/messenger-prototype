import assert from 'node:assert/strict';
import test from 'node:test';
import { deletionTargets, storageFolders, storageTotals, storedKind } from '../src/storage-model';
import { TranslationCache, needsTranslation, translatable } from '../src/chat-translation-model';
import { addDenied, deniedText, isPermissionError } from '../src/permission-notice-model';

const file = (id: string, senderId: string, size: number, extra: Record<string, unknown> = {}) =>
  ({ id, senderId, name: `${id}.jpg`, mime: 'image/jpeg', size, timestamp: Number(id.replace(/\D/g, '')) || 1, blobKey: `k${id}`, ...extra });

test('storage lists one folder per chat with only files still stored, biggest first', () => {
  const folders = storageFolders({ conversations: [
    { id: 'dm:a', title: 'Alex', kind: 'direct', files: [file('f1', 'alex', 100), file('f2', 'me', 50, { deliveryStatus: 'pending' }), file('f3', 'alex', 999, { blobKey: undefined })] },
    { id: 'group:g', title: 'Team', kind: 'group', files: [file('f4', 'bob', 400)] },
    { id: 'dm:empty', title: 'Nobody', kind: 'direct', files: [] },
  ] }, 'me');
  assert.deepEqual(folders.map(folder => [folder.title, folder.bytes, folder.files.length]), [['Team', 400, 1], ['Alex', 150, 2]]);
  assert.deepEqual(folders[1]!.files.map(item => [item.id, item.own, item.pending]), [['f2', true, true], ['f1', false, false]]);
  assert.deepEqual(storageTotals(folders), { bytes: 550, files: 3 });
});

test('large files count too: the sender copy, a received one and a download in progress', () => {
  const big = 100 * 1024 * 1024;
  const folders = storageFolders({ conversations: [
    { id: 'dm:a', title: 'Alex', kind: 'direct', files: [
      file('f1', 'alex', 1024),
      file('f2', 'alex', big, { blobKey: undefined, large: true, status: 'complete' }),
      file('f3', 'me', big, { blobKey: undefined, large: true, status: 'sending', deliveryStatus: 'pending' }),
      file('f4', 'alex', big, { blobKey: undefined, large: true, status: 'receiving', receivedBytes: 300 }),
      file('f5', 'alex', big, { blobKey: undefined, large: true, status: 'receiving', receivedBytes: 0, waiting: true }),
      file('f6', 'me', big, { blobKey: undefined, large: true, deliveryStatus: 'expired' }),
    ] },
  ] }, 'me');
  assert.deepEqual(storageTotals(folders), { bytes: 1024 + 2 * big + 300, files: 4 });
  assert.deepEqual(deletionTargets(folders, {}).map(target => target.record.id).sort(), ['f1', 'f2', 'f3', 'f4']);
  assert.equal(folders[0]!.files.find(item => item.id === 'f2')!.large, true);
});

test('deleting a file, a folder or everything targets exactly those records', () => {
  const folders = storageFolders({ conversations: [
    { id: 'dm:a', title: 'Alex', kind: 'direct', files: [file('f1', 'alex', 100), file('f2', 'me', 50)] },
    { id: 'dm:b', title: 'Bea', kind: 'direct', files: [file('f1', 'bea', 10)] },
  ] }, 'me');
  assert.deepEqual(deletionTargets(folders, { conversationId: 'dm:a', fileId: 'f1', senderId: 'alex' }), [{ conversationId: 'dm:a', record: { id: 'f1', type: 'file', author: 'alex' } }]);
  assert.equal(deletionTargets(folders, { conversationId: 'dm:a' }).length, 2);
  assert.equal(deletionTargets(folders, {}).length, 3);
});

test('voice notes and circles are recognized, other files by type', () => {
  assert.equal(storedKind(`lastcall-voice-${'a'.repeat(32)}.m4a`, 'audio/mp4'), 'voice');
  assert.equal(storedKind(`lastcall-circle-${'a'.repeat(32)}.mp4`, 'video/mp4'), 'circle');
  assert.equal(storedKind('clip.mp4', 'video/mp4'), 'video');
  assert.equal(storedKind('a.pdf', 'application/pdf'), 'file');
});

test('only text in another recognized language is translated', () => {
  assert.equal(needsTranslation('en', 'ru'), true);
  assert.equal(needsTranslation('ru', 'ru'), false);
  assert.equal(needsTranslation('pt-BR', 'pt'), false);
  assert.equal(needsTranslation('und', 'ru'), false);
  assert.equal(translatable('👍👍 12:30!'), false);
  assert.equal(translatable('https://example.com'), false);
  assert.equal(translatable('See you tomorrow'), true);
});

test('the translation cache is bounded and keeps recent entries', () => {
  const cache = new TranslationCache<string | null>(2);
  cache.set('a', 'A'); cache.set('b', null); cache.get('a'); cache.set('c', 'C');
  assert.equal(cache.has('b'), false);
  assert.equal(cache.get('a'), 'A');
  assert.equal(cache.has('c'), true);
});

test('refused access is named and remembered in a fixed order', () => {
  assert.deepEqual(addDenied(['camera'], ['microphone', 'camera']), ['microphone', 'camera']);
  assert.match(deniedText(['microphone', 'camera']), /microphone and the camera/);
  assert.equal(isPermissionError({ name: 'NotAllowedError', message: '' }), true);
  assert.equal(isPermissionError(new Error('Permission denied')), true);
  assert.equal(isPermissionError(new Error('Camera is busy')), false);
});
