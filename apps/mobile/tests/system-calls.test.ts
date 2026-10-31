import assert from 'node:assert/strict';
import test from 'node:test';
import type { MessengerSnapshot, SessionSnapshot } from '@messenger/core';
import { CallTaskRegistry, callSettingsTarget, callStatusText, nativeCallMode, nativeCallUuid, SystemCallController } from '../src/system-call-model';
const first = 'ab'.repeat(16); const second = 'cd'.repeat(16);
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }
function fixture() {
  let snapshot: MessengerSnapshot = { status: 'online', contacts: [], conversations: [] };
  const events: string[] = []; let accepts = 0; let ended = 0; let pins = 0;
  const manager = { getSnapshot: () => snapshot, acceptCall: async () => { accepts++; if (snapshot.activeCall) snapshot.activeCall.session.callState = 'active'; }, endCall: () => { ended++; snapshot = { ...snapshot, activeCall: undefined }; }, setMuted: (muted: boolean) => events.push(`mute:${muted}`) };
  const port = { present: async (id: string) => { events.push(`ring:${id}`); return true; }, showUi: (id: string) => { events.push(`ui:${id}`); return true; }, dismiss: (id: string) => events.push(`dismiss:${id}`), activate: (id: string) => events.push(`active:${id}`), end: (id: string) => events.push(`end:${id}`), startAudio: async (id: string) => { events.push(`audio:${id}`); }, stopAudio: (id: string) => { events.push(`stop:${id}`); }, retain: () => { pins++; return () => { pins--; }; } };
  const controller = new SystemCallController(port);
  const incoming = (id = first, overrides: Partial<SessionSnapshot> = {}) => { snapshot = { ...snapshot, activeCall: { conversationId: 'dm:synthetic', peerId: 'synthetic', session: { status: 'connected', callState: 'incoming', callId: id, muted: false, route: 'direct', stats: {}, messages: [], files: [], ...overrides } } }; controller.update(snapshot, manager); };
  return { controller, manager, port, events, incoming, update: () => controller.update(snapshot, manager), counts: () => ({ accepts, ended, pins }), snapshot: () => snapshot };
}
test('push-only or incomplete snapshots cannot ring; live stable call presents once and clears on hangup', async () => {
  const f = fixture(); f.update(); assert.equal(f.events.length, 0);
  f.incoming(); f.update(); await tick(); assert.equal(f.events.filter(value => value.startsWith('ring:')).length, 1); assert.equal(f.counts().pins, 1);
  assert.equal(f.events.some(value => value.startsWith('audio:')), false); f.manager.endCall(); f.update(); assert.equal(f.counts().pins, 0); assert.ok(f.events.includes(`end:${nativeCallUuid(first)}`));
  assert.throws(() => nativeCallUuid('invalid'));
});
test('only explicit valid answer starts microphone; duplicate native/UI answer stays owned', async () => {
  const f = fixture(); const audio = deferred(); f.port.startAudio = async () => audio.promise;
  f.incoming(); await tick(); assert.equal(await f.controller.answer('unknown'), false);
  const answering = f.controller.answer(nativeCallUuid(first)); assert.equal(await f.controller.answer(), true); assert.equal(f.counts().accepts, 0);
  audio.resolve(); assert.equal(await answering, true); assert.equal(f.counts().accepts, 1);
  f.controller.mute(nativeCallUuid(first), true); assert.ok(f.events.includes('mute:true')); f.controller.end(nativeCallUuid(first)); assert.equal(f.counts().pins, 0);
});
test('cancelled old audio completion cannot accept a call or stop a newer call audio lease', async () => {
  const f = fixture(); const old = deferred(); let running: string | null = null;
  f.port.startAudio = async id => { if (id === nativeCallUuid(first)) await old.promise; else running = id; };
  f.port.stopAudio = id => { if (running === id) running = null; };
  f.incoming(); await tick(); const oldAnswer = f.controller.answer(); f.controller.end(nativeCallUuid(first));
  f.incoming(second); await tick(); await f.controller.answer(); assert.equal(running, nativeCallUuid(second)); assert.equal(f.counts().accepts, 1);
  old.resolve(); await oldAnswer; assert.equal(running, nativeCallUuid(second)); assert.equal(f.counts().accepts, 1);
  f.controller.end(nativeCallUuid(second)); assert.equal(f.counts().pins, 0);
});
test('ring deadline releases runtime and prevents late native answer or microphone capture', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] }); const f = fixture(); f.incoming(); await tick();
  context.mock.timers.tick(30_000); assert.equal(f.counts().ended, 1); assert.equal(f.counts().pins, 0);
  assert.equal(await f.controller.answer(nativeCallUuid(first)), false); assert.equal(f.counts().accepts, 0); assert.equal(f.events.some(value => value.startsWith('audio:')), false);
});
test('microphone-service denial ends the live call without acquiring media', async () => {
  const f = fixture(); f.port.startAudio = async () => { throw new Error('FGS denied'); }; f.incoming(); await tick();
  assert.equal(await f.controller.answer(), true); assert.equal(f.counts().accepts, 0); assert.equal(f.counts().ended, 1); assert.equal(f.counts().pins, 0);
});

test('dedicated call headless task stays pending beyond Expo completion and releases by UUID', async () => {
  const tasks = new CallTaskRegistry(); tasks.claim(first); let done = false;
  const running = tasks.run(first); void running.then(() => { done = true; }); await tick(); assert.equal(done, false);
  assert.equal(tasks.run(first), running); tasks.claim(second); tasks.release(second); await tick(); assert.equal(done, false);
  tasks.release(first); await running; assert.equal(done, true); await tasks.run(first);
});

test('a video invitation does not start camera service until explicit answer and forwards the negotiated video flag', async () => {
  const f = fixture(); let requested: boolean | undefined;
  f.port.startAudio = async (_id: string, ...rest: unknown[]) => { requested = rest[0] as boolean; };
  f.incoming(); const snapshot = f.snapshot(); snapshot.activeCall!.session.callVideo = true; f.update(); await tick(); assert.equal(requested, undefined);
  await f.controller.answer(); assert.equal(requested, true); assert.equal(f.counts().accepts, 1); f.controller.end(nativeCallUuid(first));
});

test('self-managed calls are enabled on Android 26+ without a user phone-account gate and report blocked full-screen UI', () => {
  assert.equal(nativeCallMode(25), 'in-app'); assert.equal(nativeCallMode(26), 'self-managed');
  const ready = { supported: true, notifications: true, channel: true, fullScreen: true };
  assert.match(callStatusText(true, ready), /включены/);
  assert.equal(callSettingsTarget(ready), 'none');
  const fsiBlocked = { ...ready, fullScreen: false };
  assert.match(callStatusText(true, fsiBlocked), /полноэкран/);
  assert.equal(callSettingsTarget(fsiBlocked), 'full-screen');
  assert.match(callStatusText(true, { ...ready, notifications: false }), /уведомления/);
});

test('native call UI shows once for the live UUID and rejects stale/unknown actions', async () => {
  const f = fixture(); f.incoming(); await tick();
  assert.equal(f.controller.showUi(nativeCallUuid(first)), true);
  assert.equal(f.controller.showUi(nativeCallUuid(first)), true);
  assert.equal(f.events.filter(value => value === `ui:${nativeCallUuid(first)}`).length, 1);
  assert.equal(f.controller.showUi(nativeCallUuid(second)), false);
  assert.equal(f.events.some(value => value === `ui:${nativeCallUuid(second)}`), false);
});

test('early showUi/answer events wait for the authenticated snapshot, answer dismisses ringing UI', async () => {
  const f = fixture();
  assert.equal(f.controller.showUi(nativeCallUuid(first)), false);
  assert.equal(await f.controller.answer(nativeCallUuid(first)), false);
  f.incoming(); await tick();
  assert.ok(f.events.includes(`ui:${nativeCallUuid(first)}`));
  assert.equal(f.counts().accepts, 1);
  assert.ok(f.events.includes(`dismiss:${nativeCallUuid(first)}`));
  assert.equal(f.events.some(value => value.startsWith('audio:')), true);
});

test('caller cancel, reject and a following call clean the old ringing UI exactly once', async () => {
  const f = fixture(); f.incoming(); await tick(); f.controller.showUi(nativeCallUuid(first));
  f.manager.endCall(); f.update();
  assert.equal(f.events.filter(value => value === `dismiss:${nativeCallUuid(first)}`).length, 1);
  assert.equal(f.counts().pins, 0);
  f.incoming(second); await tick(); f.controller.showUi(nativeCallUuid(second));
  assert.equal(f.events.filter(value => value === `ui:${nativeCallUuid(second)}`).length, 1);
  f.controller.showUi(nativeCallUuid(first));
  assert.equal(f.events.filter(value => value === `ui:${nativeCallUuid(first)}`).length, 1);
  f.controller.end(nativeCallUuid(second));
  assert.equal(f.counts().pins, 0);
});

test('authenticated pre-media invitation rings before peer connection and handoff never duplicates UI or audio', async () => {
  const f = fixture(); f.incoming(first, { status: 'connecting', setup: 'invitation', route: 'unknown', callExpiresAt: Date.now() + 5000 });
  const session = f.snapshot().activeCall!.session;
  f.update(); await tick();
  assert.equal(f.events.filter(value => value.startsWith('ring:')).length, 1);
  assert.equal(f.events.filter(value => value.startsWith('ui:')).length, 1);
  assert.equal(f.events.some(value => value.startsWith('audio:')), false);
  session.status = 'connected'; session.setup = undefined; f.update(); await tick();
  assert.equal(f.events.filter(value => value.startsWith('ui:')).length, 1);
  assert.equal(f.events.filter(value => value.startsWith('ring:')).length, 1);
  f.controller.end(nativeCallUuid(first));
});
test('answer may await matching peer while UI stays connecting; activate/dismiss only on actual active session', async () => {
  const f = fixture(); const peer = deferred(); let accepts = 0;
  f.manager.acceptCall = async () => { accepts++; await peer.promise; };
  f.incoming(); f.snapshot().activeCall!.session.setup = 'invitation'; f.snapshot().activeCall!.session.status = 'connecting';
  const answering = f.controller.answer(); await tick();
  assert.equal(accepts, 1); assert.equal(await f.controller.answer(), true);
  assert.equal(f.events.some(value => value.startsWith('active:') || value.startsWith('dismiss:')), false);
  peer.resolve(); await answering;
  assert.equal(f.events.some(value => value.startsWith('active:') || value.startsWith('dismiss:')), false);
  f.snapshot().activeCall!.session.callState = 'active'; f.update(); f.update();
  assert.equal(f.events.filter(value => value.startsWith('active:')).length, 1);
  assert.equal(f.events.filter(value => value.startsWith('dismiss:')).length, 1);
  f.controller.end(nativeCallUuid(first));
});
test('original invitation expiry is passed to native and cannot be renewed by duplicate or peer handoff', async context => {
  context.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000000 });
  const f = fixture(); const deadlines: number[] = [];
  f.port.showUi = (_id: string, ...rest: unknown[]) => { deadlines.push(rest[2] as number); return true; };
  f.incoming(second, { status: 'connecting', setup: 'invitation', callExpiresAt: Date.now() + 4000 });
  const call = f.snapshot().activeCall!; f.update(); await tick();
  assert.equal(deadlines.at(-1), 1004000);
  context.mock.timers.tick(3000); call.session.status = 'connected'; f.update();
  context.mock.timers.tick(1000); assert.equal(f.snapshot().activeCall, undefined);
  assert.equal(await f.controller.answer(nativeCallUuid(second)), false);
});
test('caller cancel during pending answer and late completion never activate a new call', async () => {
  const f = fixture(), peer = deferred();
  f.manager.acceptCall = async () => peer.promise; f.incoming();
  const answering = f.controller.answer(); await tick(); f.controller.end(nativeCallUuid(first));
  f.incoming(second); await tick(); peer.resolve(); await answering;
  assert.equal(f.events.includes(`active:${nativeCallUuid(first)}`), false);
  assert.equal(f.events.includes(`dismiss:${nativeCallUuid(second)}`), false);
  f.controller.end(nativeCallUuid(second));
});
