import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { CueThrottle, incomingCue, observeFeedback, type FeedbackSnapshot } from '../src/feedback-model';

const chat = (id: string, messages: [string, string][], files: [string, string][] = []) =>
  ({ id, messages: messages.map(([mid, from]) => ({ id: mid, from })), files: files.map(([fid, senderId]) => ({ id: fid, senderId })) });
const snap = (conversations: ReturnType<typeof chat>[], extra: Partial<FeedbackSnapshot> = {}): FeedbackSnapshot => ({ conversations, blockedContacts: [], ...extra });

test('history already on the phone is a baseline, not new messages', () => {
  const first = observeFeedback(undefined, 's:me', snap([chat('a', [['1', 'bob'], ['2', 'bob']])]), 'me');
  assert.deepEqual(first.events, []);
  const again = observeFeedback(first.state, 's:me', snap([chat('a', [['1', 'bob'], ['2', 'bob']])]), 'me');
  assert.deepEqual(again.events, []);
});

test('a new message or file from someone else is incoming; my own and blocked ones are not', () => {
  const base = observeFeedback(undefined, 's:me', snap([chat('a', [['1', 'bob']]), chat('b', [])]), 'me').state;
  const own = observeFeedback(base, 's:me', snap([chat('a', [['1', 'bob'], ['2', 'me']]), chat('b', [])]), 'me');
  assert.deepEqual(own.events, []);
  const blocked = observeFeedback(base, 's:me', snap([chat('a', [['1', 'bob'], ['3', 'eve']]), chat('b', [])], { blockedContacts: ['eve'] }), 'me');
  assert.deepEqual(blocked.events, []);
  const next = observeFeedback(base, 's:me', snap([chat('a', [['1', 'bob']]), chat('b', [], [['f', 'carol']])]), 'me');
  assert.deepEqual(next.events, [{ kind: 'incoming', conversationIds: ['b'] }]);
});

test('switching accounts starts a new baseline', () => {
  const base = observeFeedback(undefined, 's:me', snap([chat('a', [])]), 'me').state;
  const other = observeFeedback(base, 's:other', snap([chat('x', [['9', 'bob']])]), 'other');
  assert.deepEqual(other.events, []);
});

test('a call that connects and then ends gives one cue each', () => {
  const call = (callState: 'outgoing' | 'active') => ({ session: { callState } });
  let state = observeFeedback(undefined, 's:me', snap([], { activeCall: call('outgoing') }), 'me').state;
  const connected = observeFeedback(state, 's:me', snap([], { activeCall: call('active') }), 'me');
  assert.deepEqual(connected.events, [{ kind: 'callConnected' }]);
  state = connected.state;
  assert.deepEqual(observeFeedback(state, 's:me', snap([], { activeCall: call('active') }), 'me').events, []);
  assert.deepEqual(observeFeedback(state, 's:me', snap([]), 'me').events, [{ kind: 'callEnded' }]);
  // A call that never connected (declined, missed) ends silently.
  const ringing = observeFeedback(undefined, 's:me', snap([], { activeCall: call('outgoing') }), 'me').state;
  assert.deepEqual(observeFeedback(ringing, 's:me', snap([]), 'me').events, []);
});

test('the open chat gets the quiet in-chat cue; the rest of the app also vibrates; background and calls stay silent', () => {
  assert.equal(incomingCue(['a'], 'a', true, false), 'chat');
  assert.equal(incomingCue(['a', 'b'], 'a', true, false), 'app');
  assert.equal(incomingCue(['b'], undefined, true, false), 'app');
  assert.equal(incomingCue(['a'], 'a', false, false), 'none');
  assert.equal(incomingCue(['a'], 'a', true, true), 'none');
});

test('a backlog plays once per interval', () => {
  const throttle = new CueThrottle(1500);
  assert.equal(throttle.allow(1000), true);
  assert.equal(throttle.allow(1800), false);
  assert.equal(throttle.allow(2600), true);
});

test('the notifications plugin ships both in-chat sounds as raw resources', () => {
  const plugin = readFileSync(new URL('../plugins/withLastCallNotifications.cjs', import.meta.url), 'utf8');
  const module = readFileSync(new URL('../plugins/notifications/LastCallNotificationsModule.java', import.meta.url), 'utf8');
  for (const name of ['lastcall_sent', 'lastcall_incoming']) {
    assert.match(plugin, new RegExp(`${name}\\.wav`));
    assert.match(module, new RegExp(`R\\.raw\\.${name}`));
    const wav = readFileSync(new URL(`../plugins/notifications/raw/${name}.wav`, import.meta.url));
    assert.equal(wav.subarray(0, 4).toString(), 'RIFF');
    assert.ok(wav.length < 64 * 1024);
  }
  // Ringer and call guards keep the sounds out of silent mode and calls.
  assert.match(module, /RINGER_MODE_NORMAL/);
  assert.match(module, /MODE_NORMAL/);
});
