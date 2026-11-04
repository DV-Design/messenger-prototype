import assert from 'node:assert/strict';
import test from 'node:test';
import { ConnectionSupervisor, RETRY_DELAYS_MS, connectionAction, connectionNeedsUser, isTransientConnectionError, type ConnectionInput } from '../src/connection-supervisor';

const base: ConnectionInput = { foreground: true, retired: false, hasProfile: true, hasIdentity: true, registration: 'bound', status: 'offline' };

function harness(input: ConnectionInput, retry: () => Promise<void> = async () => {}) {
  const pending = new Map<number, { callback: () => void; delay: number }>();
  let next = 0;
  const calls = { reconnect: 0, check: 0 };
  const supervisor = new ConnectionSupervisor({
    read: () => input,
    reconnect: async () => { calls.reconnect++; await retry(); },
    checkRegistration: async () => { calls.check++; await retry(); },
    scheduler: { set: (callback, delay) => { pending.set(++next, { callback, delay }); return next; }, clear: handle => { pending.delete(handle as number); } },
  });
  const fire = async () => { const [id, entry] = [...pending.entries()][0]!; pending.delete(id); entry.callback(); await new Promise(resolve => setImmediate(resolve)); };
  return { supervisor, pending, calls, fire };
}

test('errors that core leaves stopped are retried automatically', () => {
  for (const error of ['session-replaced: replaced', 'auth-expired: expired', 'auth-failed: bad', 'This identity connected on another client', 'This device is already registered on this server; resolve its existing profile'])
    assert.equal(connectionAction({ ...base, status: 'error', error }), 'reconnect', error);
});

test('states that need the user or a healthy connection are left alone', () => {
  for (const error of ['account-moved: moved', 'username-taken: taken', 'email-required: need', 'email-taken: taken', 'Encrypted local state is invalid; it was not overwritten']) {
    assert.equal(connectionAction({ ...base, status: 'error', error }), 'none', error);
    assert.equal(connectionNeedsUser(error), true, error);
    assert.equal(isTransientConnectionError(error), false, error);
  }
  assert.equal(connectionAction({ ...base, status: 'online' }), 'none');
  assert.equal(connectionAction({ ...base, status: 'connecting' }), 'none');
  assert.equal(connectionAction({ ...base, status: 'idle' }), 'none');
  assert.equal(connectionAction({ ...base, retired: true }), 'none');
  assert.equal(connectionAction({ ...base, hasIdentity: false }), 'none');
});

test('a hidden app does not retry, so a background wake keeps its own bounded window', () => {
  assert.equal(connectionAction({ ...base, foreground: false }), 'none');
});

test('a failed first registration check is retried, an unregistered device is not', () => {
  const input = { ...base, hasProfile: false, status: 'idle' as const };
  assert.equal(connectionAction({ ...input, registration: 'unavailable' }), 'check-registration');
  assert.equal(connectionAction({ ...input, registration: 'unregistered' }), 'none');
  assert.equal(connectionAction({ ...input, registration: 'checking' }), 'none');
});

test('raw transient transport text is hidden, unrelated app errors stay visible', () => {
  for (const error of ['Directory connection failed', 'Directory disconnected', 'Directory authentication timed out', 'Directory is offline', 'session-replaced: x', 'Email connection failed'])
    assert.equal(isTransientConnectionError(error), true, error);
  for (const error of ['Local encrypted state could not be saved', 'File exceeds 5 MiB limit', undefined])
    assert.equal(isTransientConnectionError(error), false, String(error));
});

test('repeated pokes keep one timer and retries back off to a cap', async () => {
  const { supervisor, pending, calls, fire } = harness(base);
  supervisor.poke(); supervisor.poke(); supervisor.poke();
  assert.equal(pending.size, 1);
  const seen: number[] = [];
  for (let index = 0; index < RETRY_DELAYS_MS.length + 2; index++) { seen.push([...pending.values()][0]!.delay); await fire(); assert.equal(pending.size, 1); }
  assert.deepEqual(seen, [...RETRY_DELAYS_MS, 30_000, 30_000]);
  assert.equal(calls.reconnect, RETRY_DELAYS_MS.length + 2);
});

test('a rejected retry still schedules the next one', async () => {
  const { supervisor, pending, calls, fire } = harness(base, async () => { throw new Error('Directory connection failed'); });
  supervisor.poke(); await fire();
  assert.equal(calls.reconnect, 1);
  assert.equal(pending.size, 1);
});

test('coming online clears the timer and resets backoff', async () => {
  const input = { ...base };
  const { supervisor, pending, fire } = harness(input);
  supervisor.poke(); await fire(); supervisor.poke();
  assert.equal([...pending.values()][0]!.delay, RETRY_DELAYS_MS[1]);
  input.status = 'online'; supervisor.poke();
  assert.equal(pending.size, 0);
  input.status = 'offline'; supervisor.poke();
  assert.equal([...pending.values()][0]!.delay, RETRY_DELAYS_MS[0]);
});

test('returning to the app restarts from the shortest delay', async () => {
  const { supervisor, pending, fire } = harness(base);
  supervisor.poke(); await fire(); await fire(); await fire();
  assert.equal([...pending.values()][0]!.delay, RETRY_DELAYS_MS[3]);
  supervisor.resume();
  assert.equal(pending.size, 1);
  assert.equal([...pending.values()][0]!.delay, RETRY_DELAYS_MS[0]);
});

test('hiding the app cancels a waiting retry', () => {
  const input = { ...base };
  const { supervisor, pending } = harness(input);
  supervisor.poke();
  input.foreground = false; supervisor.poke();
  assert.equal(pending.size, 0);
});

test('a failed registration check retries through its own path', async () => {
  const { supervisor, calls, fire } = harness({ ...base, hasProfile: false, registration: 'unavailable', status: 'idle' });
  supervisor.poke(); await fire();
  assert.deepEqual(calls, { reconnect: 0, check: 1 });
});
