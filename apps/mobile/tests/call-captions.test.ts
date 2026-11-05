import assert from 'node:assert/strict';
import test from 'node:test';
import type { CallCaptionFrame } from '@messenger/core';
import { CAPTION_PARTIAL_MS, CAPTION_TRANSLATE_MS, CallCaptionsController, captionLanguage, captionSpeechNote, splitCaption, type CaptionNative, type CaptionScheduler, type CaptionsView, type SpeechStatus } from '../src/call-captions-model';

const callId = 'ab'.repeat(16);
const flush = async () => { for (let index = 0; index < 8; index++) await new Promise(resolve => setImmediate(resolve)); };

function harness(options: { language?: string; status?: SpeechStatus; translate?: (source: string, target: string, text: string) => Promise<string> } = {}) {
  let now = 1000; let id = 0;
  const timers = new Map<number, { at: number; run: () => void }>();
  const scheduler: CaptionScheduler = { now: () => now, set: (run, delay) => { timers.set(++id, { at: now + delay, run }); return id; }, clear: handle => { timers.delete(handle as number); } };
  const calls = { start: [] as string[], stop: 0, muted: [] as boolean[], download: 0, prepared: [] as string[], released: 0 };
  let status: SpeechStatus = options.status ?? 'ready';
  const native: CaptionNative = {
    speechStatus: async (_language, tag) => ({ status, tag }),
    downloadSpeech: async () => { calls.download++; status = 'downloading'; },
    startSpeech: async tag => { calls.start.push(tag); },
    stopSpeech: () => { calls.stop++; },
    setSpeechMuted: muted => { calls.muted.push(muted); },
    prepareTranslation: async (source, target) => { calls.prepared.push(`${source}:${target}`); },
    translate: options.translate ?? (async (_source, _target, text) => `T(${text})`),
    releaseTranslation: () => { calls.released++; },
  };
  const sent: CallCaptionFrame[] = []; const views: CaptionsView[] = [];
  const controller = new CallCaptionsController({ native, language: options.language ?? 'ru', send: async frame => { sent.push(frame); return true; }, onChange: view => views.push(view), scheduler });
  controller.setCall(callId, true);
  const advance = async (ms: number) => {
    now += ms;
    for (const [key, timer] of [...timers]) if (timer.at <= now) { timers.delete(key); timer.run(); }
    await flush();
  };
  const peer = (enabled = true, language = 'en', speech: 'ready' | 'preparing' | 'unavailable' = 'ready') => controller.onFrame({ kind: 'call-caption-state', callId, enabled, language, speech });
  const caption = (segment: number, revision: number, final: boolean, text: string, language = 'en') => controller.onFrame({ kind: 'call-caption', callId, language, segment, revision, final, text });
  return { controller, calls, sent, views, advance, peer, caption, setStatus: (value: SpeechStatus) => { status = value; }, timers };
}
async function both(h: ReturnType<typeof harness>) { h.controller.setEnabled(true); h.peer(); await flush(); }

test('speech is recognized only after both people enable captions', async () => {
  const h = harness();
  h.peer(); await flush();
  assert.equal(h.controller.snapshot().asked, true);
  assert.deepEqual(h.calls.start, []);
  h.controller.setEnabled(true); await flush();
  assert.deepEqual(h.calls.start, ['ru-RU']);
  assert.equal(h.controller.snapshot().asked, false);

  const one = harness();
  one.controller.setEnabled(true); await flush();
  assert.deepEqual(one.calls.start, [], 'turning on alone must not start the recognizer');
  assert.equal((one.sent.at(-1) as { enabled: boolean }).enabled, true);
});

test('declining hides the request and sends nothing; a new request asks again', async () => {
  const h = harness();
  h.peer(); h.controller.decline(); await flush();
  assert.equal(h.controller.snapshot().asked, false);
  assert.equal(h.sent.length, 0);
  h.peer(false); h.peer(true);
  assert.equal(h.controller.snapshot().asked, true);
});

test('either side turning off stops recognition and clears the words', async () => {
  const h = harness(); await both(h);
  h.caption(0, 0, true, 'hello'); await flush();
  assert.equal(h.controller.snapshot().lines.length, 1);
  h.peer(false); await flush();
  assert.equal(h.calls.stop, 1);
  assert.deepEqual(h.controller.snapshot().lines, []);

  const mine = harness(); await both(mine);
  mine.controller.setEnabled(false); await flush();
  assert.equal(mine.calls.stop, 1);
  assert.equal(mine.calls.released, 1);
  assert.equal((mine.sent.at(-1) as { enabled: boolean }).enabled, false);
});

test('muted speech is never sent, and pending words are closed when muting', async () => {
  const h = harness(); await both(h); await h.advance(CAPTION_PARTIAL_MS);
  h.controller.onSpeech({ type: 'partial', text: 'first' });
  h.controller.onSpeech({ type: 'partial', text: 'first words' });
  h.controller.setMuted(true);
  assert.deepEqual(h.calls.muted.at(-1), true);
  const before = h.sent.filter(frame => frame.kind === 'call-caption');
  assert.deepEqual(before.map(frame => frame.kind === 'call-caption' && [frame.text, frame.final]), [['first', false], ['first words', true]]);
  h.controller.onSpeech({ type: 'partial', text: 'secret while muted' });
  h.controller.onSpeech({ type: 'final', text: 'secret while muted' });
  await h.advance(CAPTION_PARTIAL_MS);
  assert.equal(h.sent.filter(frame => frame.kind === 'call-caption').length, 2);
  assert.ok(!JSON.stringify(h.sent).includes('secret'));
});

test('partials are throttled to the latest text and revisions increase within a segment', async () => {
  const h = harness(); await both(h); await h.advance(CAPTION_PARTIAL_MS);
  for (const text of ['a', 'a b', 'a b c', 'a b c d']) h.controller.onSpeech({ type: 'partial', text });
  await h.advance(CAPTION_PARTIAL_MS);
  h.controller.onSpeech({ type: 'final', text: 'a b c d e' });
  const frames = h.sent.filter(frame => frame.kind === 'call-caption');
  assert.deepEqual(frames.map(frame => frame.kind === 'call-caption' && [frame.segment, frame.revision, frame.final, frame.text]), [[0, 0, false, 'a'], [0, 1, false, 'a b c d'], [0, 2, true, 'a b c d e']]);
  h.controller.onSpeech({ type: 'partial', text: 'next' });
  await h.advance(CAPTION_PARTIAL_MS);
  assert.deepEqual((h.sent.at(-1) as { segment: number; revision: number }).segment, 1);
});

test('a final long phrase is split without losing words and every part fits the protocol', () => {
  const text = Array.from({ length: 200 }, (_, index) => `word${index}`).join(' ');
  const parts = splitCaption(text);
  assert.ok(parts.length > 1 && parts.every(part => part.length <= 400));
  assert.equal(parts.join(' '), text);
  assert.deepEqual(splitCaption('   '), []);
});

test('a final is translated at once, a partial after a pause, and same-language speech not at all', async () => {
  const translated: string[] = [];
  const h = harness({ translate: async (_source, _target, text) => { translated.push(text); return `T(${text})`; } });
  await both(h); await flush();
  assert.deepEqual(h.calls.prepared, ['en:ru']);
  h.caption(0, 0, false, 'hel'); h.caption(0, 1, false, 'hello'); await flush();
  assert.deepEqual(translated, [], 'partials wait so a flood of revisions is not translated');
  assert.equal(h.controller.snapshot().lines[0]?.text, 'hello', 'the newest original shows until its translation arrives');
  await h.advance(CAPTION_TRANSLATE_MS);
  assert.deepEqual(translated, ['hello']);
  h.caption(0, 2, true, 'hello there'); await flush();
  assert.deepEqual(translated, ['hello', 'hello there']);
  assert.equal(h.controller.snapshot().lines[0]?.text, 'T(hello there)');

  const same = harness({ translate: async () => { throw new Error('must not translate'); } });
  same.controller.setEnabled(true); same.peer(true, 'ru'); await flush();
  same.caption(0, 0, true, 'привет', 'ru'); await flush();
  assert.equal(same.controller.snapshot().lines[0]?.text, 'привет');
  assert.equal(same.controller.snapshot().translation, 'none');
});

test('a slow translation of old words cannot replace newer ones', async () => {
  const pending: Array<(value: string) => void> = [];
  const h = harness({ translate: () => new Promise(resolve => pending.push(resolve)) });
  await both(h); await flush();
  h.caption(0, 0, false, 'old'); await h.advance(CAPTION_TRANSLATE_MS);
  h.caption(0, 1, true, 'new words'); await flush();
  assert.equal(pending.length, 2);
  pending[1]!('T(new words)'); await flush();
  pending[0]!('T(old)'); await flush();
  assert.equal(h.controller.snapshot().lines[0]?.text, 'T(new words)');
});

test('stale, duplicate and foreign frames are ignored; only recent lines stay in memory', async () => {
  const h = harness(); await both(h); await flush();
  h.caption(1, 3, false, 'current'); h.caption(1, 2, false, 'stale'); await flush();
  assert.equal(h.controller.snapshot().lines[0]?.original, 'current');
  h.caption(0, 9, false, 'older segment'); await flush();
  assert.equal(h.controller.snapshot().lines.length, 1);
  h.controller.onFrame({ kind: 'call-caption', callId: 'cd'.repeat(16), language: 'en', segment: 7, revision: 0, final: true, text: 'other call' });
  assert.ok(!h.controller.snapshot().lines.some(line => line.original === 'other call'));
  h.caption(1, 4, true, 'done'); h.caption(1, 5, false, 'after final'); await flush();
  assert.equal(h.controller.snapshot().lines[0]?.original, 'done');
  for (let segment = 2; segment < 9; segment++) h.caption(segment, 0, true, `s${segment}`);
  await flush();
  assert.equal(h.controller.snapshot().lines.length, 3);
});

test('words received while captions are off are dropped', () => {
  const h = harness();
  h.peer(); h.caption(0, 0, true, 'unasked');
  assert.deepEqual(h.controller.snapshot().lines, []);
});

test('a missing speech model is requested once and polled; a phone without one can still read', async () => {
  const h = harness({ status: 'download' });
  await both(h); await flush();
  assert.equal(h.calls.download, 1);
  assert.equal(h.controller.snapshot().speech, 'downloading');
  assert.deepEqual(h.calls.start, []);
  h.setStatus('ready'); await h.advance(3000);
  assert.equal(h.controller.snapshot().speech, 'ready');
  assert.deepEqual(h.calls.start, ['ru-RU']);

  const none = harness({ status: 'unavailable' });
  await both(none); await flush();
  assert.equal(none.controller.snapshot().speech, 'unavailable');
  assert.equal((none.sent.at(-1) as { speech: string }).speech, 'unavailable');
  none.caption(0, 0, true, 'still readable'); await flush();
  assert.equal(none.controller.snapshot().lines[0]?.text, 'T(still readable)');
});

test('a recognizer failure is reported to the peer and is not retried in a loop', async () => {
  const h = harness(); await both(h);
  h.controller.onSpeech({ type: 'error', code: 'error-3' });
  assert.equal(h.controller.snapshot().speech, 'unavailable');
  assert.equal((h.sent.at(-1) as { speech: string }).speech, 'unavailable');
  assert.equal(h.calls.start.length, 1);
});

test('after a transport recovery the state is announced again; nothing is queued while away', async () => {
  const h = harness(); await both(h);
  const sentBefore = h.sent.length;
  h.controller.setCall(callId, false);
  h.controller.setCall(callId, true);
  assert.equal(h.sent.length, sentBefore + 1);
  assert.equal(h.sent.at(-1)?.kind, 'call-caption-state');
});

test('ending the call stops everything and later events do nothing', async () => {
  const h = harness(); await both(h);
  h.caption(0, 0, true, 'words'); await flush();
  h.controller.dispose();
  assert.equal(h.calls.stop, 1);
  assert.equal(h.calls.released, 1);
  assert.deepEqual(h.controller.snapshot().lines, []);
  const views = h.views.length;
  h.controller.onSpeech({ type: 'final', text: 'late' }); h.caption(1, 0, true, 'late');
  await flush();
  assert.equal(h.views.length, views);
});

test('an unknown phone language falls back to English', () => {
  assert.equal(captionLanguage('ru'), 'ru');
  assert.equal(captionLanguage('xx'), 'en');
  assert.equal(captionLanguage(undefined), 'en');
});

test('the settings note survives the first render, before anything has loaded', () => {
  assert.equal(captionSpeechNote(undefined, undefined), '');
  assert.equal(captionSpeechNote(undefined, 'ru'), '');
  assert.equal(captionSpeechNote({ language: 'en', text: 'old' }, 'ru'), '');
  assert.equal(captionSpeechNote({ language: 'ru', text: 'ready' }, 'ru'), 'ready');
});
