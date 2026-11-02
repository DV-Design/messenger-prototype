import assert from 'node:assert/strict';
import test from 'node:test';
import { CallCameraController, type CallCameraTrack } from '../src/call-camera-model';
import { CallPipObserver, emptyCallPip, ownsLiveCall, parseCallPip, type CallPipSnapshot } from '../src/call-pip-model';
import { VIDEO_CONTROLS_DELAY_MS, VideoControlsController } from '../src/video-controls-model';

test('PiP parser accepts only the native snapshot shape and canonical call ownership', () => {
  assert.deepEqual(parseCallPip({ callId: 'ab'.repeat(16), active: true, supported: true, allowed: true, transitioning: true, closed: false }), { callId: 'ab'.repeat(16), active: true, supported: true, allowed: true, transitioning: true, closed: false });
  assert.equal(parseCallPip({ ...emptyCallPip, callId: 'ABC' }), undefined);
  assert.equal(parseCallPip({ ...emptyCallPip, active: 'yes' }), undefined);
});

test('stale PiP events cannot close a newer call and a close is honoured once', () => {
  const seen: CallPipSnapshot[] = []; let closed = 0;
  const observer = new CallPipObserver(value => seen.push(value), () => closed++);
  const old = 'aa'.repeat(16), next = 'bb'.repeat(16);
  observer.setCall(old);
  observer.observe({ callId: next, active: true, supported: true, allowed: true });
  assert.equal(closed, 0); assert.equal(seen.at(-1)?.callId, old);
  observer.observe({ callId: old, active: true, supported: true, allowed: true, closed: true });
  observer.observe({ callId: old, active: false, supported: true, allowed: true, closed: true });
  assert.equal(closed, 1);
  observer.setCall(next);
  observer.observe({ callId: old, active: false, supported: true, allowed: true, closed: true });
  assert.equal(closed, 1);
  assert.equal(seen.at(-1)?.callId, next);
});

test('an event observed while a native request is in flight wins over its older reply', async () => {
  const seen: CallPipSnapshot[] = [];
  const observer = new CallPipObserver(value => seen.push(value), () => {});
  const callId = 'cc'.repeat(16);
  observer.setCall(callId);
  let release!: (value: unknown) => void;
  const pending = observer.request(() => new Promise(resolve => { release = resolve; }));
  const current = { callId, active: true, supported: true, allowed: true };
  observer.observe(current);
  release({ callId, active: false, supported: true, allowed: true });
  await pending;
  assert.deepEqual(seen.at(-1), { ...current, transitioning: false, closed: false });
});

class ManualClock {
  private timers = new Set<() => void>();
  readonly port = { set: (callback: () => void) => { this.timers.add(callback); return callback; }, clear: (timer: unknown) => { this.timers.delete(timer as () => void); } };
  get pending() { return this.timers.size; }
  fire() { const timers = [...this.timers]; this.timers.clear(); timers.forEach(callback => callback()); }
}

test('active video controls hide after inactivity and a tap brings them back and restarts', () => {
  const clock = new ManualClock(); const published: boolean[] = [];
  const controls = new VideoControlsController(value => published.push(value), clock.port);
  controls.configure(true, false, false);
  assert.equal(controls.visible, true); assert.equal(clock.pending, 1);
  clock.fire(); assert.equal(controls.visible, false);
  controls.tap(); assert.equal(controls.visible, true); assert.equal(clock.pending, 1);
  controls.interact(); assert.equal(controls.visible, true);
  clock.fire(); assert.equal(controls.visible, false);
  controls.dispose(); assert.equal(clock.pending, 0);
  assert.deepEqual(published, [true, false, true, true, false]);
});

test('audio chooser and incoming/outgoing controls never auto-hide while PiP restores them', () => {
  const clock = new ManualClock();
  const controls = new VideoControlsController(() => {}, clock.port);
  controls.configure(false, false, false);
  assert.equal(clock.pending, 0);
  clock.fire(); assert.equal(controls.visible, true);
  controls.configure(true, false, true);
  clock.fire(); assert.equal(controls.visible, true);
  controls.configure(true, true, false);
  assert.equal(controls.visible, false); assert.equal(clock.pending, 0);
  controls.tap(); assert.equal(controls.visible, false);
  controls.configure(true, false, false);
  assert.equal(controls.visible, true); assert.equal(clock.pending, 1);
  controls.dispose();
});

interface FakeTrack extends CallCameraTrack {
  remote: boolean; kind: 'video'; readyState: 'live' | 'ended';
  applied: MediaTrackConstraints[]; settings: { facingMode?: string };
}
function fakeTrack(overrides: Partial<FakeTrack> = {}): FakeTrack {
  const state: FakeTrack = {
    remote: false, kind: 'video', readyState: 'live', applied: [], settings: { facingMode: 'user' },
    getSettings() { return this.settings as never; },
    getConstraints() { return { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 }, deviceId: 'front', facingMode: 'user' } as never; },
    async applyConstraints(constraints?: MediaTrackConstraints) {
      const value = constraints!;
      this.applied.push(value);
      this.settings = { facingMode: Array.isArray(value.facingMode) ? undefined : value.facingMode } as { facingMode?: string };
    },
    ...overrides,
  };
  return state;
}

test('camera toggle keeps the same track and quality while dropping the old deviceId', async () => {
  const track = fakeTrack(); const states: { facing?: string; busy: boolean; available: boolean }[] = [];
  const controller = new CallCameraController(state => states.push(state));
  controller.setTrack('aa'.repeat(16), track);
  assert.equal(controller.state.available, true);
  await controller.switch();
  assert.deepEqual(track.applied, [{ width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 }, facingMode: 'environment' }]);
  assert.equal(controller.state.facing, 'environment'); assert.equal(controller.state.busy, false);
  await controller.switch();
  assert.equal(controller.state.facing, 'user');
  assert.equal(track.applied.length, 2); assert.equal(track.readyState, 'live');
  assert.deepEqual(states.at(-1), { available: true, busy: false, facing: 'user' });
});

test('camera ignores ended/remote tracks and collapses overlapping switches', async () => {
  let release!: () => void; let calls = 0;
  const track = fakeTrack({ async applyConstraints(_constraints?: MediaTrackConstraints) { calls++; await new Promise<void>(resolve => { release = resolve; }); } });
  const controller = new CallCameraController(() => {});
  controller.setTrack('bb'.repeat(16), track);
  const first = controller.switch();
  assert.equal(controller.state.busy, true);
  await controller.switch();
  assert.equal(calls, 1);
  release(); await first;
  controller.setTrack('bb'.repeat(16), fakeTrack({ readyState: 'ended' }));
  await controller.switch();
  assert.equal(calls, 1);
});

test('camera reports a failed actual-facing confirmation instead of claiming success', async () => {
  const track = fakeTrack({ async applyConstraints(_constraints?: MediaTrackConstraints) { /* device kept the old camera */ } });
  const controller = new CallCameraController(() => {});
  controller.setTrack('cc'.repeat(16), track);
  await controller.switch();
  assert.equal(controller.state.facing, 'user');
  assert.match(controller.state.error ?? '', /Не удалось переключить камеру/);
  assert.equal(controller.state.busy, false);
});

test('a late native close cannot end a newer live call', () => {
  const oldId = '11'.repeat(16), newId = '22'.repeat(16);
  assert.equal(ownsLiveCall(newId, oldId), false);
  assert.equal(ownsLiveCall(undefined, oldId), false);
  assert.equal(ownsLiveCall(newId, newId), true);
});
