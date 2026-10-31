import assert from 'node:assert/strict';
import test from 'node:test';
import { PERMISSION_ORDER, permissionSetupPlan, fullScreenCallAccess, requestSpecialAccess, type Access } from '../src/permission-model';
const denied: Access = { status: 'denied', canAskAgain: true };
const granted: Access = { status: 'granted', canAskAgain: true };
test('upgrade adds only the new call permission without repeating attempted/denied runtime prompts', () => {
  assert.deepEqual(permissionSetupPlan(null, null, denied), PERMISSION_ORDER);
  for (const old of ['done', 'attempted']) {
    assert.deepEqual(permissionSetupPlan(old, null, denied), ['fullScreenCalls']);
    for (const call of ['done', 'attempted']) assert.deepEqual(permissionSetupPlan(old, call, denied), []);
    assert.deepEqual(permissionSetupPlan(old, null, granted), []);
    assert.deepEqual(permissionSetupPlan(old, null, { status: 'unavailable', canAskAgain: false }), []);
  }
});
test('full-screen is Android special access only on34+, manifest-capable on24-33 and unavailable on iOS', () => {
  assert.equal(fullScreenCallAccess('android', 37, { supported: true, fullScreen: false }).status, 'denied');
  assert.equal(fullScreenCallAccess('android', 34, { supported: true, fullScreen: true }).status, 'granted');
  assert.deepEqual(fullScreenCallAccess('android', 33), { status: 'granted', canAskAgain: false });
  assert.deepEqual(fullScreenCallAccess('android', 24), { status: 'granted', canAskAgain: false });
  assert.equal(fullScreenCallAccess('android', 23).status, 'unavailable');
  assert.equal(fullScreenCallAccess('ios', 26).status, 'unavailable');
  assert.equal(fullScreenCallAccess('android', 37).status, 'unavailable');
  assert.equal(fullScreenCallAccess('android', 37, { supported: true }).status, 'unknown');
});
function settingsFlow(initial = denied) {
  let current = initial, listener: ((state: string) => void) | undefined, timeout: (() => void) | undefined;
  let reads = 0, opens = 0, explains = 0, unsubscribed = 0, cleared = 0;
  const port = {
    read: async () => { reads++; return current; },
    explain: async () => { explains++; return true; },
    open: async () => { opens++; return true; },
    subscribe: (callback: (state: string) => void) => { listener = callback; return () => { listener = undefined; unsubscribed++; }; },
    schedule: (callback: () => void) => { timeout = callback; return () => { timeout = undefined; cleared++; }; },
  };
  return { port, set: (value: Access) => { current = value; }, emit: (state: string) => listener?.(state), expire: () => timeout?.(),
    counts: () => ({ reads, opens, explains, unsubscribed, cleared }) };
}
const tick = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };
test('launch success/initial-active are not grants: wait for actual settings return and recheck once', async () => {
  const f = settingsFlow(); let resolved = false;
  const result = requestSpecialAccess(f.port).then(value => { resolved = true; return value; }); await tick();
  f.emit('active'); await tick(); assert.equal(resolved, false); assert.equal(f.counts().reads, 1);
  f.emit('background'); f.set(granted); await tick(); assert.equal(resolved, false);
  f.emit('active'); f.emit('active'); assert.equal((await result).status, 'granted');
  assert.deepEqual(f.counts(), { reads: 2, opens: 1, explains: 1, unsubscribed: 1, cleared: 1 });
});
test('denial, later, unsupported and already allowed remain truthful without repeated special prompts', async () => {
  const deniedFlow = settingsFlow(); const result = requestSpecialAccess(deniedFlow.port); await tick();
  deniedFlow.emit('background'); deniedFlow.emit('active'); assert.equal((await result).status, 'denied');
  const later = settingsFlow(); later.port.explain = async () => false;
  assert.equal((await requestSpecialAccess(later.port)).status, 'denied'); assert.equal(later.counts().opens, 0);
  for (const access of [granted, { status: 'unavailable', canAskAgain: false } as Access]) {
    const f = settingsFlow(access); assert.equal((await requestSpecialAccess(f.port)).status, access.status); assert.equal(f.counts().explains, 0); assert.equal(f.counts().opens, 0);
  }
});
test('unavailable settings and missing-return timeout finish safely and clean listeners', async () => {
  const missing = settingsFlow(); missing.port.open = async () => false;
  assert.equal((await requestSpecialAccess(missing.port)).status, 'denied'); assert.equal(missing.counts().unsubscribed, 1);
  const f = settingsFlow(); const result = requestSpecialAccess(f.port); await tick();
  f.set(granted); f.expire(); assert.equal((await result).status, 'denied');
  assert.equal(f.counts().reads, 1); assert.equal(f.counts().unsubscribed, 1); assert.equal(f.counts().cleared, 1);
});
test('failed native settings launch cleans up and never turns into a successful permission', async () => {
  const f = settingsFlow(); f.port.open = async () => { throw new Error('settings unavailable'); };
  await assert.rejects(requestSpecialAccess(f.port), /unavailable/); assert.equal(f.counts().unsubscribed, 1); assert.equal(f.counts().cleared, 1);
});
