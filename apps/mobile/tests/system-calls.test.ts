import assert from 'node:assert/strict';
import test from 'node:test';
import type { MessengerSnapshot } from '@messenger/core';
import { CallTaskRegistry, nativeCallUuid, SystemCallController } from '../src/system-call-model';
const first = 'ab'.repeat(16); const second = 'cd'.repeat(16);
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }
function fixture() {
  let snapshot: MessengerSnapshot = { status: 'online', contacts: [], conversations: [] };
  const events: string[] = []; let accepts = 0; let ended = 0; let pins = 0;
  const manager = { getSnapshot: () => snapshot, acceptCall: async () => { accepts++; }, endCall: () => { ended++; snapshot = { ...snapshot, activeCall: undefined }; }, setMuted: (muted: boolean) => events.push(`mute:${muted}`) };
  const port = { present: async (id: string) => { events.push(`ring:${id}`); return true; }, activate: (id: string) => events.push(`active:${id}`), end: (id: string) => events.push(`end:${id}`), startAudio: async (id: string) => { events.push(`audio:${id}`); }, stopAudio: (id: string) => { events.push(`stop:${id}`); }, retain: () => { pins++; return () => { pins--; }; } };
  const controller = new SystemCallController(port);
  const incoming = (id = first) => { snapshot = { ...snapshot, activeCall: { conversationId: 'dm:synthetic', peerId: 'synthetic', session: { status: 'connected', callState: 'incoming', callId: id, muted: false, route: 'direct', stats: {}, messages: [], files: [] } } }; controller.update(snapshot, manager); };
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
