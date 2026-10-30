import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createMediaScope, MAX_MEDIA_BYTES, mediaKind, mediaMetadata, mediaPermission, mediaTime, readMediaForSend, validateMedia } from '../src/media-model';
import { claimMediaPlayback, stopMediaPlayback } from '../src/media-playback';

const nonce = 'ab'.repeat(16);
const voice = mediaMetadata('voice', nonce, 'file:///note.m4a');
test('only reserved filenames with matching container MIME become inline media', () => {
  assert.equal(mediaKind(voice.name, voice.mime), 'voice');
  assert.equal(mediaKind(`lastcall-circle-${nonce}.mp4`, 'video/mp4'), 'circle');
  assert.equal(mediaKind(`lastcall-circle-${nonce}.mov`, 'video/quicktime'), 'circle');
  for (const [name, mime] of [['recording.m4a', 'audio/mp4'], [voice.name, 'video/mp4'], [`../${voice.name}`, voice.mime], [`lastcall-voice-${nonce}.mp3`, 'audio/mpeg']]) assert.equal(mediaKind(name!, mime!), undefined);
  assert.deepEqual(mediaMetadata('circle', nonce, 'file:///camera.mov'), { name: `lastcall-circle-${nonce}.mov`, mime: 'video/quicktime' });
  assert.throws(() => mediaMetadata('voice', '../unsafe', 'a'));
});
test('recording policy checks duration, empty files, and finite bounded size', () => {
  validateMedia(MAX_MEDIA_BYTES, 120, 'voice'); validateMedia(1024, 30, 'circle');
  for (const size of [0, -1, MAX_MEDIA_BYTES + 1, NaN, Infinity]) assert.throws(() => validateMedia(size, 1, 'voice'));
  for (const duration of [0, 0.1, 121, NaN, Infinity]) assert.throws(() => validateMedia(1024, duration, 'voice'));
  assert.throws(() => validateMedia(1024, 31, 'circle'));
  assert.equal(mediaTime(65.9), '1:05'); assert.equal(mediaTime(NaN), '0:00');
});
test('cancel during an asynchronous native read prevents a later send', async () => {
  const scope = createMediaScope(); let finish!: (value: Uint8Array) => void; let sends = 0;
  const read = new Promise<Uint8Array>(resolve => { finish = resolve; });
  const work = readMediaForSend(voice, 100, () => read, scope).then(() => { sends++; });
  scope.cancel(); finish(new Uint8Array(100));
  await assert.rejects(work, /отменена/); assert.equal(sends, 0); assert.equal(scope.active, false); scope.cancel(); assert.throws(scope.assert);
});
test('cancelled or invalid metadata does not read native bytes', async () => {
  let reads = 0; const read = async () => { reads++; return new Uint8Array(10); };
  const scope = createMediaScope(); scope.cancel();
  await assert.rejects(readMediaForSend(voice, 10, read, scope));
  await assert.rejects(readMediaForSend({ name: 'bad', mime: voice.mime }, 10, read, createMediaScope()));
  await assert.rejects(readMediaForSend(voice, MAX_MEDIA_BYTES + 1, read, createMediaScope()));
  assert.equal(reads, 0);
});
test('native byte result is rechecked even when reported size is small', async () => {
  await assert.rejects(readMediaForSend(voice, 10, async () => new Uint8Array(MAX_MEDIA_BYTES + 1), createMediaScope()));
  await assert.rejects(readMediaForSend(voice, 10, async () => new Uint8Array(), createMediaScope()));
  const bytes = new Uint8Array(10); assert.equal(await readMediaForSend(voice, 10, async () => bytes, createMediaScope()), bytes);
});
test('new playback revokes previous owner and stale release cannot stop new owner', () => {
  let first = 0, second = 0;
  const releaseFirst = claimMediaPlayback(() => first++);
  const releaseSecond = claimMediaPlayback(() => second++);
  assert.equal(first, 1); releaseFirst(); stopMediaPlayback(); assert.equal(second, 1); releaseSecond(); stopMediaPlayback(); assert.equal(second, 1);
});


test('microphone/camera access granted by initial setup never reopens Android permission Activity', async () => {
  for (const permission of ['microphone', 'camera']) {
    let requests = 0; let captures = 0; const scope = createMediaScope();
    const allowed = await mediaPermission(async () => ({ granted: true }), async () => { requests++; scope.cancel(); return { granted: true }; }, scope.assert);
    if (allowed.granted) { scope.assert(); captures++; }
    assert.equal(requests, 0, permission); assert.equal(captures, 1, permission);
  }
});

test('a first permission prompt or Home cancels capture; only a fresh explicit attempt may use the grant', async () => {
  const scope = createMediaScope(); let captures = 0; let granted = false;
  await assert.rejects(mediaPermission(async () => ({ granted }), async () => { scope.cancel(); granted = true; return { granted }; }, scope.assert).then(() => { captures++; }), /отменена/);
  assert.equal(captures, 0); const fresh = createMediaScope();
  const result = await mediaPermission(async () => ({ granted }), async () => { throw new Error('must not prompt twice'); }, fresh.assert); assert.equal(result.granted, true);
  const home = createMediaScope(); await assert.rejects(mediaPermission(async () => { home.cancel(); return { granted: false }; }, async () => { throw new Error('must not prompt after Home'); }, home.assert), /отменена/);
});

test('blocked denied access is returned without another permission Activity', async () => {
  const result = await mediaPermission(async () => ({ granted: false, canAskAgain: false }), async () => { throw new Error('must open settings instead'); }, createMediaScope().assert);
  assert.equal(result.granted, false);
});
