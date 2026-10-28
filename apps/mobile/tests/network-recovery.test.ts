import assert from 'node:assert/strict';
import test from 'node:test';
import { monitorNetworkRecovery, type ConnectionState } from '../src/network-recovery';

const wifi: ConnectionState = { type: 'WIFI', isConnected: true, isInternetReachable: true };
const mobile: ConnectionState = { type: 'CELLULAR', isConnected: true, isInternetReachable: true };
const gap: ConnectionState = { type: 'NONE', isConnected: false, isInternetReachable: false };
const tick = () => new Promise<void>(resolve => setImmediate(resolve));

test('Wi-Fi to mobile recovers once per reachable transition and preserves transient gaps', async () => {
  let listener: (state: ConnectionState) => void = () => {};
  let current = wifi; let calls = 0; let removed = 0;
  const recovery = monitorNetworkRecovery({ read: async () => current, listen: fn => { listener = fn; return { remove: () => { removed++; } }; }, onReachable: () => { calls++; } });
  await tick(); assert.equal(calls, 1);
  listener(wifi); await tick(); assert.equal(calls, 1);
  listener(gap); await tick(); assert.equal(calls, 1);
  current = mobile; listener(mobile); listener(mobile); await tick(); assert.equal(calls, 2);
  await recovery.resume(); await tick(); assert.equal(calls, 3);
  recovery.stop(); listener(wifi); await recovery.resume(); await tick();
  assert.equal(calls, 3); assert.equal(removed, 1);
});

test('stale async observations cannot restore an old route after a newer native event', async () => {
  let resolveRead!: (state: ConnectionState) => void;
  let listener: (state: ConnectionState) => void = () => {};
  let calls = 0;
  const recovery = monitorNetworkRecovery({ read: () => new Promise(resolve => { resolveRead = resolve; }), listen: fn => { listener = fn; return { remove() {} }; }, onReachable: () => { calls++; } });
  listener(mobile); await tick(); assert.equal(calls, 1);
  resolveRead(wifi); await tick(); assert.equal(calls, 1);
  listener(mobile); await tick(); assert.equal(calls, 1);
  recovery.stop();
});

test('recovery is serialized, bursts collapse and a failed attempt can retry on resume', async () => {
  let listener: (state: ConnectionState) => void = () => {};
  let finish!: () => void; let calls = 0; let active = 0; let maximum = 0;
  const recovery = monitorNetworkRecovery({ read: async () => wifi, listen: fn => { listener = fn; return { remove() {} }; }, onReachable: async () => {
    calls++; active++; maximum = Math.max(maximum, active);
    try { if (calls === 1) await new Promise<void>(resolve => { finish = resolve; }); else if (calls === 2) throw new Error('Temporary DNS outage'); }
    finally { active--; }
  } });
  await tick(); listener(mobile); listener(wifi); listener(mobile); assert.equal(calls, 1);
  finish(); await tick(); assert.equal(calls, 2); assert.equal(maximum, 1);
  await recovery.resume(); await tick(); assert.equal(calls, 3);
  listener(gap); await recovery.resume(); await tick(); assert.equal(calls, 4);
  recovery.stop();
});
