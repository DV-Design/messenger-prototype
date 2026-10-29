import assert from 'node:assert/strict';
import test from 'node:test';
import { parseWakeNotice, SharedWakeRuntime, WakeSyncCoordinator, type WakeLease } from '../src/wake-model';

const now = 1_800_000_000_000;
const raw = { kind: 'lastcall-wake', intentKind: 'message', intentId: 'ab'.repeat(16), expiresAt: String(now + 60_000) };
const notice = () => parseWakeNotice(raw, now)!;
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
function timers() {
  let expire = () => {}; let duration = 0;
  return { set: (callback: () => void, delay: number) => { expire = callback; duration = delay; return 1; }, clear: () => {}, fire: () => expire(), duration: () => duration };
}

test('wake parsing handles actual Expo raw/headless/response shapes and rejects unbounded or expired input', () => {
  const expected = { legacy: false, kind: 'message', id: raw.intentId, expiresAt: now + 60_000 };
  assert.deepEqual(parseWakeNotice({ notification: null, data: { ...raw, dataString: null } }, now), expected);
  assert.deepEqual(parseWakeNotice({ notification: { notification: null, data: { ...raw, dataString: null }, messageId: 'synthetic-job' } }, now), expected);
  assert.deepEqual(parseWakeNotice({ notification: null, data: { dataString: JSON.stringify(raw) } }, now), expected);
  assert.deepEqual(parseWakeNotice({ actionIdentifier: 'default', notification: { request: { content: { data: raw } } } }, now), expected);
  assert.deepEqual(parseWakeNotice({ request: { content: { data: raw } } }, now), expected);
  assert.deepEqual(parseWakeNotice({ kind: 'lastcall-wake' }, now), { legacy: true });
  for (const invalid of [undefined, null, {}, { ...raw, intentId: '../bad' }, { ...raw, expiresAt: String(now) }, { ...raw, expiresAt: String(now + 90_000) }, { ...raw, intentKind: 'url' }, { ...raw, expiresAt: undefined }, { data: { dataString: '{' } }, { ...raw, text: 'x'.repeat(9000) }]) assert.equal(parseWakeNotice(invalid, now), null);
  const circular: Record<string, unknown> = {}; circular.self = circular;
  assert.equal(parseWakeNotice(circular, now), null);
});

test('duplicate wake callbacks share one bounded window and await durable drain', async () => {
  const clock = timers(); const drained = deferred<void>(); let acquisitions = 0; let connects = 0; let releases = 0; let done = false;
  const coordinator = new WakeSyncCoordinator(async () => { acquisitions++; return { connect: async () => { connects++; }, release: async () => { releases++; await drained.promise; } }; }, () => now, clock);
  const first = coordinator.run(notice()); const second = coordinator.run(notice());
  assert.equal(first, second); await tick();
  assert.equal(acquisitions, 1); assert.equal(connects, 1); assert.equal(clock.duration(), 9000);
  void first.then(() => { done = true; }); clock.fire(); await tick();
  assert.equal(releases, 1); assert.equal(done, false);
  drained.resolve(); await first; assert.equal(done, true);
  await coordinator.run(notice()); assert.equal(acquisitions, 1);
});

test('short intent deadlines and late initialization do not start a late transport', async () => {
  const clock = timers(); const acquired = deferred<WakeLease | null>(); let signal!: AbortSignal; let connected = 0; let released = 0;
  const coordinator = new WakeSyncCoordinator(async input => { signal = input; return acquired.promise; }, () => now, clock);
  const work = coordinator.run({ legacy: false, kind: 'call', id: 'cc'.repeat(16), expiresAt: now + 100 });
  await tick(); assert.equal(clock.duration(), 100); clock.fire(); await work; assert.equal(signal.aborted, true);
  acquired.resolve({ connect: async () => { connected++; }, release: async () => { released++; } }); await tick();
  assert.equal(connected, 0); assert.equal(released, 1);
});

test('foreground takeover during cold initialization reuses the client and task completion preserves it', async () => {
  const owner = new SharedWakeRuntime<{ connect(): Promise<void>; disconnectAndFlush(): Promise<void> }>();
  const created = deferred<{ connect(): Promise<void>; disconnectAndFlush(): Promise<void> }>(); let closes = 0; let uiCreates = 0;
  const client = { connect: async () => {}, disconnectAndFlush: async () => { closes++; } };
  const leasePromise = owner.acquire(() => created.promise, new AbortController().signal); await tick();
  owner.claimForeground(); const ui = owner.ensure(async () => { uiCreates++; return client; });
  created.resolve(client); const lease = await leasePromise;
  assert.equal(await ui, client); assert.equal(uiCreates, 0); await lease!.release();
  assert.equal(closes, 0); assert.equal(owner.peek(), client);
});

test('UI waits for terminal cleanup before replacing a task-owned manager', async () => {
  const drained = deferred<void>(); let secondCreated = false;
  const first = { connect: async () => {}, disconnectAndFlush: () => drained.promise };
  const second = { connect: async () => {}, disconnectAndFlush: async () => {} };
  const owner = new SharedWakeRuntime<typeof first>();
  const lease = await owner.acquire(async () => first, new AbortController().signal);
  const closing = lease!.release(); await tick(); assert.equal(owner.peek(), null);
  owner.claimForeground(); const ui = owner.ensure(async () => { secondCreated = true; return second; });
  await tick(); assert.equal(secondCreated, false); drained.resolve(); await closing;
  assert.equal(await ui, second); assert.equal(secondCreated, true);
});

test('aborted cold initialization never installs a late client and drains it before UI boot', async () => {
  const constructed = deferred<{ connect(): Promise<void>; disconnectAndFlush(): Promise<void> }>();
  const drained = deferred<void>(); const controller = new AbortController(); let connected = 0; let closes = 0; let uiCreated = false;
  const late = { connect: async () => { connected++; }, disconnectAndFlush: async () => { closes++; await drained.promise; } };
  const owner = new SharedWakeRuntime<typeof late>();
  const acquiring = owner.acquire(() => constructed.promise, controller.signal); await tick();
  controller.abort(); constructed.resolve(late); await tick();
  assert.equal(owner.peek(), null); assert.equal(closes, 1); assert.equal(connected, 0);
  owner.claimForeground(); const ui = owner.ensure(async () => { uiCreated = true; return { connect: async () => {}, disconnectAndFlush: async () => {} }; });
  await tick(); assert.equal(uiCreated, false); drained.resolve();
  assert.equal(await acquiring, null); await ui; assert.equal(uiCreated, true); assert.notEqual(owner.peek(), late);
});

test('legacy/expired pushes do no cold work; connection errors still release ownership', async () => {
  let acquisitions = 0; let releases = 0;
  const coordinator = new WakeSyncCoordinator(async () => { acquisitions++; return { connect: async () => { throw new Error('Network unavailable'); }, release: async () => { releases++; } }; }, () => now);
  await coordinator.run({ legacy: true }); await coordinator.run({ legacy: false, kind: 'file', id: raw.intentId, expiresAt: now });
  assert.equal(acquisitions, 0); await coordinator.run(notice()); assert.equal(releases, 1);
});
