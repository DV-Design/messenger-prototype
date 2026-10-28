/**
 * Public HTTPS/WSS control-plane smoke; ordinary DNS and certificate validation.
 * Run with Node24 + tsx after deploying USERNAME-CONTRACT support:
 *   PUBLIC_URL=https://lienad.ru/messenger node --import tsx infra/public/verify-usernames.ts
 * Each successful run intentionally leaves TWO synthetic qa_* public profiles.
 * No profile deletion endpoint exists. Keys stay in memory; no RTC/media/push is tested.
 */
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import WebSocket from 'ws';
import { createDeviceIdentity, MessengerClient, resolveDeviceProfile, type DeviceIdentity, type DirectoryPage } from '../../packages/core/src/index.js';

const base = new URL(process.env.PUBLIC_URL ?? 'https://lienad.ru/messenger');
assert.equal(base.protocol, 'https:', 'Public username smoke requires HTTPS');
const sockets = new Set<WebSocket>();
const managers: MessengerClient[] = [];
const originalWebSocket = globalThis.WebSocket;
// The actual core APIs use global WebSocket. Track their sockets for bounded cleanup
// while presenting the real gateway Origin; do not override DNS or TLS verification.
class TrackedWebSocket extends WebSocket {
  constructor(address: string | URL, protocols?: string | string[]) {
    super(address, protocols, { origin: base.origin });
    sockets.add(this);
    this.once('close', () => sockets.delete(this));
    this.on('error', () => {}); // Core onerror handles failures; cleanup must not throw.
  }
}
globalThis.WebSocket = TrackedWebSocket as unknown as typeof globalThis.WebSocket;
const suffix = `${Date.now().toString(36)}_${randomBytes(3).toString('hex')}`;
const usernameA = `qa_${suffix}_a`, usernameB = `qa_${suffix}_b`;
const displayName = `Проверка ${suffix}`;
const identityA = createDeviceIdentity(randomBytes), identityB = createDeviceIdentity(randomBytes);
let stage = 'initialization';
function manager(identity: DeviceIdentity, username: string, name: string) {
  const client = new MessengerClient({ serverUrl: base.href, identity, username, displayName: name });
  managers.push(client); return client;
}
function checkPage(page: DirectoryPage, after?: string) {
  assert.ok(page.users.length <= 100);
  const names = page.users.map(user => user.username);
  assert.deepEqual(names, [...names].sort());
  assert.equal(new Set(names).size, names.length);
  if (after) assert.ok(names.every(name => name > after));
  if (page.nextCursor !== undefined) {
    assert.equal(page.users.length, 100);
    assert.equal(page.nextCursor, names.at(-1));
  }
}
async function run() {
  stage = 'unknown-key resolution';
  assert.equal(await resolveDeviceProfile(base.href, identityA), null);
  assert.equal(await resolveDeviceProfile(base.href, identityB), null);
  console.log('PASS: unknown installation keys resolve to null');

  stage = 'first registration';
  const a = manager(identityA, usernameA, displayName); await a.connect();
  const canonical = a.getSnapshot().self!;
  assert.equal(canonical.username, usernameA); assert.equal(canonical.displayName, displayName);
  // Resolve B again after another registration: its null response did not create a profile.
  assert.equal(await resolveDeviceProfile(base.href, identityB), null);
  const pageBefore = await a.listUsers(); checkPage(pageBefore);
  assert.ok(pageBefore.users.every(user => user.userId !== identityB.userId));
  console.log('PASS: unique registration and unknown resolver leaves no profile');

  stage = 'occupied username rejection';
  const occupied = manager(identityB, usernameA, 'Не регистрировать');
  await assert.rejects(occupied.connect(), /username-taken/); occupied.disconnect();
  assert.equal(await resolveDeviceProfile(base.href, identityB), null);
  const b = manager(identityB, usernameB, `Наблюдатель ${suffix}`); await b.connect();
  console.log('PASS: occupied login rejects a different unregistered key');

  stage = 'online profile resolution';
  assert.deepEqual(await resolveDeviceProfile(base.href, identityA), canonical);
  assert.equal(a.getSnapshot().status, 'online');
  const first = await a.listUsers(); checkPage(first); // Original authenticated socket still owns the session.
  if (first.nextCursor !== undefined) {
    const second = await a.listUsers(first.nextCursor); checkPage(second, first.nextCursor);
    const ids = new Set(first.users.map(user => user.userId));
    assert.ok(second.users.every(user => !ids.has(user.userId)));
  }
  assert.equal((await b.search(usernameA)).find(user => user.userId === identityA.userId)?.online, true);
  console.log('PASS: resolver preserves live owner/presence; catalog pages are bounded and ordered');

  stage = 'Unicode and login search';
  assert.ok((await b.search(`@${usernameA}`)).some(user => user.userId === identityA.userId));
  assert.ok((await b.search(displayName.toUpperCase())).some(user => user.userId === identityA.userId));
  assert.ok((await b.search(displayName.toLowerCase())).some(user => user.userId === identityA.userId));
  console.log('PASS: second client finds login and Cyrillic display name in both cases');

  stage = 'immutable username rejection';
  const rename = manager(identityA, `${usernameA.slice(0, -1)}x`, 'Не менять имя');
  await assert.rejects(rename.connect(), /device-already-registered/); rename.disconnect();
  assert.equal(a.getSnapshot().status, 'online');
  assert.deepEqual(await resolveDeviceProfile(base.href, identityA), canonical);
  console.log('PASS: same installation cannot rename or displace its canonical profile');

  stage = 'canonical profile reconnect';
  a.disconnect();
  const stale = manager(identityA, usernameA, 'Устаревшее локальное имя'); await stale.connect();
  assert.equal(stale.getSnapshot().self?.displayName, displayName);
  assert.equal(stale.getSnapshot().self?.username, usernameA);
  const restored = await resolveDeviceProfile(base.href, identityA);
  assert.equal(restored?.displayName, displayName); assert.equal(restored?.username, usernameA);
  assert.equal(restored?.online, true);
  console.log('PASS: reconnect keeps canonical server profile; two synthetic QA profiles created');
}
let deadline: ReturnType<typeof setTimeout> | undefined;
try {
  await Promise.race([run(), new Promise<never>((_, reject) => { deadline = setTimeout(() => reject(new Error('Smoke deadline exceeded')), 27_000); })]);
} catch {
  console.error(`FAIL: public username smoke at ${stage}`); process.exitCode = 1;
} finally {
  clearTimeout(deadline);
  for (const client of managers) client.disconnect();
  for (const socket of sockets) socket.terminate();
  globalThis.WebSocket = originalWebSocket;
}
