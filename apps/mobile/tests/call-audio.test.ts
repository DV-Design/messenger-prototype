import assert from 'node:assert/strict';
import test from 'node:test';
import { CallAudioController, parseCallAudio, type CallAudioSnapshot } from '../src/call-audio-model';
const a = 'a'.repeat(32), b = 'b'.repeat(32);
const snapshot = (callId = a, selected = '1'): CallAudioSnapshot => ({ callId, active: true, routes: [
  { id: '1', kind: 'earpiece', selected: selected === '1' },
  { id: '2', kind: 'speaker', selected: selected === '2' },
  { id: '3', kind: 'bluetooth', selected: selected === '3' },
] });
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }

test('route request acceptance does not claim actual selection; actual Android event completes it', async () => {
  let selections = 0;
  const controller = new CallAudioController({ get: async () => snapshot(), select: async () => { selections++; return snapshot(); } }, () => {});
  controller.setCall(a); await controller.refresh(); await controller.select('3');
  assert.equal(controller.state.pendingId, '3');
  assert.equal(controller.state.routes.find(route => route.selected)?.id, '1');
  await controller.select('2'); assert.equal(selections, 1);
  controller.observe(snapshot(a, '3'));
  assert.equal(controller.state.pendingId, undefined);
  assert.equal(controller.state.routes.find(route => route.selected)?.kind, 'bluetooth');
});

test('old call results and device events cannot change the next call', async () => {
  const request = deferred<unknown>();
  const controller = new CallAudioController({ get: async () => snapshot(), select: () => request.promise }, () => {});
  controller.setCall(a); controller.observe(snapshot());
  const pending = controller.select('2');
  controller.setCall(b); controller.observe(snapshot(b));
  request.resolve(snapshot(a, '2')); await pending;
  controller.observe(snapshot(a, '3'));
  assert.equal(controller.state.callId, b);
  assert.equal(controller.state.routes.find(route => route.selected)?.id, '1');
  controller.setCall(); controller.observe(snapshot(b));
  assert.deepEqual(controller.state, { callId: '', active: false, routes: [] });
});

test('a newer native observation wins over an older query and selection response', async () => {
  const query = deferred<unknown>(), selection = deferred<unknown>();
  const controller = new CallAudioController({ get: () => query.promise, select: () => selection.promise }, () => {});
  controller.setCall(a); controller.observe(snapshot());
  const refreshing = controller.refresh(), selecting = controller.select('3');
  controller.observe(snapshot(a, '3'));
  query.resolve(snapshot()); selection.resolve(snapshot()); await Promise.all([refreshing, selecting]);
  assert.equal(controller.state.routes.find(route => route.selected)?.id, '3');
});

test('unplugged pending headset clears request; speaker/earpiece fallback follows actual state', async () => {
  const controller = new CallAudioController({ get: async () => snapshot(), select: async () => snapshot() }, () => {});
  controller.setCall(a); controller.observe(snapshot()); await controller.select('3');
  const unplugged = snapshot(a, '2'); unplugged.routes.pop(); controller.observe(unplugged);
  assert.equal(controller.state.pendingId, undefined); assert.match(controller.state.error!, /отключено/);
  assert.equal(controller.state.routes.find(route => route.selected)?.kind, 'speaker');
  controller.observe({ ...snapshot(), active: false });
  assert.deepEqual(controller.state.routes, []); assert.equal(controller.state.error, undefined);
});

test('rejected or timed-out selection unlocks retry without altering the actual selected output', async () => {
  let now = 0, reject = true;
  const controller = new CallAudioController({ get: async () => snapshot(), select: async () => { if (reject) throw new Error('device unavailable'); return snapshot(); } }, () => {}, () => now);
  controller.setCall(a); await controller.refresh(); await controller.select('2');
  assert.equal(controller.state.pendingId, undefined); assert.ok(controller.state.error);
  reject = false; await controller.select('2'); now = 8001; await controller.refresh();
  assert.equal(controller.state.pendingId, undefined); assert.ok(controller.state.error);
  assert.equal(controller.state.routes.find(route => route.selected)?.id, '1');
});

test('no fake earpiece/Bluetooth devices; malformed or duplicate native inputs are rejected', () => {
  assert.equal(parseCallAudio({ ...snapshot(), callId: 'invalid' }), undefined);
  const value = parseCallAudio({ ...snapshot(), routes: [{ id: '2', kind: 'speaker', selected: true }, { id: '2', kind: 'speaker', selected: true }, { id: '5', kind: 'toString', selected: true }, { id: '-1', kind: 'earpiece', selected: false }] });
  assert.deepEqual(value?.routes, [{ id: '2', kind: 'speaker', selected: true }]);
});

test('observation failures still release a timed-out request; stale rejection cannot affect a new call', async () => {
  let now = 0;
  const selection = deferred<unknown>();
  const controller = new CallAudioController({ get: async () => { throw new Error('native unavailable'); }, select: () => selection.promise }, () => {}, () => now);
  controller.setCall(a); controller.observe(snapshot()); const selecting = controller.select('2');
  now = 8001; await controller.refresh(); assert.equal(controller.state.pendingId, undefined);
  controller.setCall(b); controller.observe(snapshot(b)); selection.reject(new Error('old call ended')); await selecting;
  assert.equal(controller.state.error, undefined); assert.equal(controller.state.callId, b);
});
