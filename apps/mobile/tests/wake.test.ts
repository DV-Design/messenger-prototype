import assert from 'node:assert/strict';
import test from 'node:test';
import { parseWakeNotice, runWakeTask, wakeSyncBudget, WakeTaskRegistry, SharedWakeRuntime, WakeSyncCoordinator, type WakeLease } from '../src/wake-model';

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

test('typed calls get a 25s budget bounded by intent expiry while data stays at 9s', async () => {
  const rawCall = { legacy: false as const, kind: 'call' as const, id: 'dd'.repeat(16), expiresAt: now + 60_000 };
  assert.equal(wakeSyncBudget(rawCall, now), 25_000);
  assert.equal(wakeSyncBudget({ legacy: false, kind: 'message', id: raw.intentId, expiresAt: now + 60_000 }, now), 9_000);
  assert.equal(wakeSyncBudget({ ...rawCall, expiresAt: now + 4_000 }, now), 4_000);
  const clock = timers(); let releases = 0;
  const coordinator = new WakeSyncCoordinator(async () => ({ connect: async () => {}, release: async () => { releases++; } }), () => now, clock);
  const first = coordinator.run(rawCall); const duplicate = coordinator.run(rawCall); await tick();
  assert.equal(first, duplicate); assert.equal(clock.duration(), 25_000);
  clock.fire(); await first; assert.equal(releases, 1);
});

test('a call arriving during a data window is queued for its own full call lease', async () => {
  const clock = timers(); let acquisitions = 0; let releases = 0;
  const coordinator = new WakeSyncCoordinator(async () => { acquisitions++; return { connect: async () => {}, release: async () => { releases++; } }; }, () => now, clock);
  const call = { legacy: false as const, kind: 'call' as const, id: 'ee'.repeat(16), expiresAt: now + 60_000 };
  const data = coordinator.run(notice()); await tick();
  const ringing = coordinator.run(call); await tick();
  assert.equal(acquisitions, 1); assert.equal(clock.duration(), 9000);
  clock.fire(); await data; await tick();
  assert.equal(acquisitions, 2); assert.equal(clock.duration(), 25_000);
  clock.fire(); await ringing; assert.equal(releases, 2);
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

test('overlapping preview/task leases and a live-call pin keep one client until all cold owners release', async () => {
  let closed = 0; const client = { connect: async () => {}, disconnectAndFlush: async () => { closed++; } };
  const owner = new SharedWakeRuntime<typeof client>(); const signal = new AbortController().signal;
  const preview = await owner.acquire(async () => client, signal); const task = await owner.acquire(async () => { throw new Error('must reuse'); }, signal);
  const unpin = owner.retain(client); await preview!.release(); await task!.release(); assert.equal(closed, 0); assert.equal(owner.peek(), client);
  unpin(); await tick(); assert.equal(closed, 1); assert.equal(owner.peek(), null); await task!.release(); assert.equal(closed, 1);
});

test('preview authentication shares the task deadline and cannot connect after expiration', async () => {
  const clock = timers(); const slow = deferred<void>(); let connects = 0; let released = 0; let signal!: AbortSignal;
  const coordinator = new WakeSyncCoordinator(async () => ({ connect: async () => { connects++; }, release: async () => { released++; } }), () => now, clock);
  const work = coordinator.run(notice(), async input => { signal = input; await slow.promise; }); await tick(); clock.fire(); await work;
  assert.equal(signal.aborted, true); assert.equal(connects, 0); assert.equal(released, 1); slow.resolve(); await tick(); assert.equal(connects, 0);
});

test('distinct previews during one active wake share the lease/deadline and duplicates run once', async () => {
  const clock = timers(); const previews: string[] = []; let acquisitions = 0; let releases = 0;
  const coordinator = new WakeSyncCoordinator(async () => { acquisitions++; return { connect: async () => {}, release: async () => { releases++; } }; }, () => now, clock);
  const first = coordinator.run(notice(), async () => { previews.push('first'); }); await tick();
  const next = { ...notice(), legacy: false as const, kind: 'message' as const, id: 'ee'.repeat(16), expiresAt: now + 60_000 };
  const second = coordinator.run(next, async () => { previews.push('second'); }); const duplicate = coordinator.run(next, async () => { previews.push('duplicate'); }); await tick();
  assert.equal(first, second); assert.equal(second, duplicate); assert.deepEqual(previews, ['first', 'second']); assert.equal(acquisitions, 1); assert.equal(clock.duration(), 9000);
  clock.fire(); await first; assert.equal(releases, 1);
});


test('new intent during storage-drain cleanup starts a fresh window after release rather than disappearing', async () => {
  const clock = timers(); const drained = deferred<void>(); let acquisitions = 0; let previews = 0;
  const coordinator = new WakeSyncCoordinator(async () => { const first = ++acquisitions === 1; return { connect: async () => {}, release: () => first ? drained.promise : Promise.resolve() }; }, () => now, clock);
  const first = coordinator.run(notice()); await tick(); clock.fire(); await tick();
  const second = coordinator.run({ legacy: false, kind: 'message', id: 'ff'.repeat(16), expiresAt: now + 60000 }, async () => { previews++; });
  await tick(); assert.equal(acquisitions, 1); assert.equal(previews, 0); drained.resolve(); await first; await tick();
  assert.equal(acquisitions, 2); assert.equal(previews, 1); clock.fire(); await second;
});


test('native wake task registry remains pending until the last duplicate owner releases, with idempotent cleanup', async () => {
  const registry = new WakeTaskRegistry(); const first = registry.acquire(raw.intentId); const duplicate = registry.acquire(raw.intentId); let done = false;
  const running = registry.run(raw.intentId); void running.then(() => { done = true; }); await tick(); assert.equal(done, false);
  assert.equal(first(), false); assert.equal(first(), false); await tick(); assert.equal(done, false);
  assert.equal(duplicate(), true); await running; assert.equal(done, true); assert.equal(duplicate(), false);
  await registry.run(raw.intentId);
});

test('valid background work awaits native timer ownership before JS deadline setup, releases on failures, and ignores invalid intents', async () => {
  const active = deferred<void>(); const events: string[] = [];
  const acquire = async () => { events.push('acquire'); await active.promise; events.push('native-active'); return () => { events.push('release'); }; };
  const work = async () => { events.push('deadline-created'); throw new Error('expected work failure'); };
  await runWakeTask(null, acquire, work, () => now); await runWakeTask({ legacy: true }, acquire, work, () => now); await runWakeTask({ legacy: false, kind: 'message', id: raw.intentId, expiresAt: now }, acquire, work, () => now); assert.deepEqual(events, []);
  const operation = runWakeTask(notice(), acquire, work, () => now); const rejected = assert.rejects(operation, /expected work failure/);
  await tick(); assert.deepEqual(events, ['acquire']); active.resolve(); await rejected; assert.deepEqual(events, ['acquire', 'native-active', 'deadline-created', 'release']);
});

test('an intent that expires during runtime acquisition releases ownership without starting delayed work', async () => {
  let clock = now; let works = 0; let releases = 0;
  await runWakeTask(notice(), async () => { clock += 60001; return () => { releases++; }; }, async () => { works++; }, () => clock);
  assert.equal(works, 0); assert.equal(releases, 1);
});
