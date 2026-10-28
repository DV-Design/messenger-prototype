import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { createDeviceIdentity, directoryServerFrameSchema, signAuthentication, signProfileResolve, resolveDeviceProfile, MessengerClient, type DeviceIdentity, type DirectoryServerFrame } from '@messenger/core';
import { createSignalingServer, optionsFromEnv, type ServerOptions } from '../src/server.js';

const servers: ReturnType<typeof createSignalingServer>[] = [];
const sockets: WebSocket[] = [];
const tempDirs: string[] = [];
const managers: MessengerClient[] = [];
afterEach(async () => {
  for (const manager of managers.splice(0)) manager.disconnect();
  for (const ws of sockets.splice(0)) ws.terminate();
  await Promise.all(servers.splice(0).map((server) => server.close()));
  for (const path of tempDirs.splice(0)) rmSync(path, { recursive: true, force: true });
});
async function start(options: ServerOptions = {}) {
  const server = createSignalingServer({ port: 0, ...options }); servers.push(server);
  return { server, ...(await server.listen()) };
}
let sequence = 0;
const requestId = () => (++sequence).toString(16).padStart(32, '0');
class Client {
  ws: WebSocket;
  frames: DirectoryServerFrame[] = [];
  private queue: DirectoryServerFrame[] = [];
  private wake?: () => void;
  constructor(url: string) {
    this.ws = new WebSocket(url.replace('http', 'ws') + '/directory'); sockets.push(this.ws);
    this.ws.on('message', (raw) => {
      const frame = directoryServerFrameSchema.parse(JSON.parse(raw.toString()));
      this.frames.push(frame); this.queue.push(frame); this.wake?.();
    });
  }
  send(frame: unknown) { this.ws.send(JSON.stringify(frame)); }
  async next(type?: DirectoryServerFrame['type']) {
    const deadline = Date.now() + 2000;
    while (true) {
      const index = this.queue.findIndex((frame) => !type || frame.type === type);
      if (index >= 0) return this.queue.splice(index, 1)[0]!;
      if (Date.now() >= deadline) throw new Error(`Directory response timeout (${type ?? 'any'})`);
      await new Promise<void>((resolve) => { this.wake = resolve; setTimeout(resolve, 20); });
      this.wake = undefined;
    }
  }
  async auth(identity: DeviceIdentity, username: string, displayName = username) {
    const challenge = await this.next('challenge'); if (challenge.type !== 'challenge') throw new Error('Missing challenge');
    this.send({ type: 'authenticate', publicKey: identity.publicKey, username, displayName, signature: signAuthentication(identity, challenge.challenge, username, displayName) });
    return this.next();
  }
}
async function authenticated(url: string, username: string, identity = createDeviceIdentity()) {
  const client = new Client(url);
  expect(await client.auth(identity, username)).toMatchObject({ type: 'ready', self: { userId: identity.userId, publicKey: identity.publicKey, username, online: true } });
  return { client, identity };
}

 describe('authenticated persistent user directory', () => {
  it('keeps three identities online, supports bounded search/lookup and routes only authenticated sender identity', async () => {
    const { url } = await start();
    const a = await authenticated(url, 'alice'), b = await authenticated(url, 'bob'), c = await authenticated(url, 'carol');
    a.client.send({ type: 'search', query: '', requestId: requestId() });
    const all = await a.client.next('results');
    expect(all.type === 'results' && all.users.map((user) => user.username)).toEqual(['alice', 'bob', 'carol']);
    a.client.send({ type: 'search', query: 'bo', requestId: requestId() });
    const found = await a.client.next('results');
    expect(found.type === 'results' && found.users.map((user) => user.userId)).toEqual([b.identity.userId]);
    b.client.send({ type: 'lookup', userIds: [a.identity.userId, c.identity.userId], requestId: requestId() });
    const lookup = await b.client.next('results'); expect(lookup.type === 'results' && lookup.users).toHaveLength(2);
    a.client.send({ type: 'connect', to: c.identity.userId });
    expect(await c.client.next('connect')).toMatchObject({ from: { userId: a.identity.userId, username: 'alice' } });
    expect(b.client.frames.filter((frame) => frame.type === 'connect')).toHaveLength(0);
    a.client.send({ type: 'connect', to: '0'.repeat(64) });
    expect(await a.client.next('error')).toMatchObject({ code: 'peer-offline' });
  });
  it('publishes presence only to authenticated explicit watchers and replaces subscriptions', async () => {
    const { url } = await start();
    const a = await authenticated(url, 'alice'), b = await authenticated(url, 'bob'), c = await authenticated(url, 'carol');
    a.client.send({ type: 'watch', userIds: [b.identity.userId] });
    expect(await a.client.next('presence')).toMatchObject({ user: { userId: b.identity.userId, online: true } });
    b.client.ws.terminate();
    const offline = await a.client.next('presence');
    expect(offline).toMatchObject({ user: { userId: b.identity.userId, online: false } });
    expect(c.client.frames.filter((frame) => frame.type === 'presence')).toHaveLength(0);
    a.client.send({ type: 'watch', userIds: [] });
    a.client.send({ type: 'search', query: '', requestId: requestId() }); await a.client.next('results'); // Ordering barrier.
    await authenticated(url, 'bob', b.identity);
    a.client.send({ type: 'lookup', userIds: [b.identity.userId], requestId: requestId() });
    expect(await a.client.next('results')).toMatchObject({ users: [{ online: true }] });
    expect(a.client.frames.filter((frame) => frame.type === 'presence')).toHaveLength(2);
  });
  it('rejects forged signatures, altered signed profile fields, unauthenticated operations and challenge replay', async () => {
    const { url } = await start(); const identity = createDeviceIdentity();
    const first = new Client(url); const challenge = await first.next('challenge');
    if (challenge.type !== 'challenge') throw new Error('challenge missing');
    const signed = { type: 'authenticate', publicKey: identity.publicKey, username: 'alice', displayName: 'Alice', signature: signAuthentication(identity, challenge.challenge, 'alice', 'Alice') };
    first.send(signed); expect(await first.next('ready')).toMatchObject({ self: { userId: identity.userId } });
    const replay = new Client(url); await replay.next('challenge'); replay.send(signed);
    expect(await replay.next('error')).toMatchObject({ code: 'auth-failed' });
    const tamper = new Client(url); const next = await tamper.next('challenge');
    if (next.type !== 'challenge') throw new Error('challenge missing');
    tamper.send({ ...signed, displayName: 'Mallory', signature: signAuthentication(identity, next.challenge, 'alice', 'Alice') });
    expect(await tamper.next('error')).toMatchObject({ code: 'auth-failed' });
    const unknown = new Client(url); await unknown.next('challenge'); unknown.send({ type: 'search', query: '', requestId: requestId() });
    expect(await unknown.next('error')).toMatchObject({ code: 'not-authenticated' });
    first.send(signed); expect(await first.next('error')).toMatchObject({ code: 'auth-expired' });
  });
  it('enforces challenge expiry and stable username ownership', async () => {
    const { url } = await start({ directoryChallengeTtlMs: 20 });
    const a = await authenticated(url, 'alice'); const conflict = new Client(url);
    expect(await conflict.auth(createDeviceIdentity(), 'alice')).toMatchObject({ code: 'username-taken' });
    const expired = new Client(url); const challenge = await expired.next('challenge');
    if (challenge.type !== 'challenge') throw new Error('challenge missing');
    await new Promise((resolve) => setTimeout(resolve, 25));
    expired.send({ type: 'authenticate', publicKey: a.identity.publicKey, username: 'alice', displayName: 'Alice', signature: signAuthentication(a.identity, challenge.challenge, 'alice', 'Alice') });
    expect(await expired.next('error')).toMatchObject({ code: 'auth-expired' });
  });
  it('replaces identity sockets without stale closes producing false offline presence', async () => {
    const { url } = await start();
    const watcher = await authenticated(url, 'watcher'); const a = await authenticated(url, 'alice');
    watcher.client.send({ type: 'watch', userIds: [a.identity.userId] }); await watcher.client.next('presence');
    const replacement = await authenticated(url, 'alice', a.identity);
    expect(await a.client.next('error')).toMatchObject({ code: 'session-replaced' });
    expect(await watcher.client.next('presence')).toMatchObject({ user: { online: true } });
    a.client.ws.terminate();
    watcher.client.send({ type: 'lookup', userIds: [a.identity.userId], requestId: requestId() });
    expect(await watcher.client.next('results')).toMatchObject({ users: [{ online: true }] });
    expect(watcher.client.frames.filter((frame) => frame.type === 'presence' && !frame.user.online)).toHaveLength(0);
    watcher.client.send({ type: 'connect', to: a.identity.userId });
    expect(await replacement.client.next('connect')).toMatchObject({ from: { userId: watcher.identity.userId } });
    replacement.client.ws.terminate();
    expect(await watcher.client.next('presence')).toMatchObject({ user: { online: false } });
  });
  it('persists signed profile and lastSeen across database reopen but never persists online state', async () => {
    const path = mkdtempSync(join(tmpdir(), 'messenger-directory-')); tempDirs.push(path);
    const directoryDbPath = join(path, 'directory.sqlite');
    const first = await start({ directoryDbPath }); const a = await authenticated(first.url, 'alice');
    await first.server.close();
    const second = await start({ directoryDbPath }); const reader = await authenticated(second.url, 'reader');
    reader.client.send({ type: 'lookup', userIds: [a.identity.userId], requestId: requestId() });
    const result = await reader.client.next('results');
    expect(result).toMatchObject({ users: [{ userId: a.identity.userId, username: 'alice', displayName: 'alice', online: false }] });
    if (result.type !== 'results') throw new Error('results missing');
    expect(result.users[0]!.lastSeen).toBeGreaterThan(Date.now() - 5000);
    const updated = new Client(second.url);
    expect(await updated.auth(a.identity, 'alice_new', 'Alice renamed')).toMatchObject({ code: 'device-already-registered' });
    const canonical = new Client(second.url);
    expect(await canonical.auth(a.identity, 'alice', 'Stale cached name')).toMatchObject({ self: { username: 'alice', displayName: 'alice', online: true } });
    const occupied = new Client(second.url);
    expect(await occupied.auth(createDeviceIdentity(), 'alice')).toMatchObject({ code: 'username-taken' });
  });
  it('rejects chat/media/spoofed sender payloads and enforces watch/lookup/rate bounds', async () => {
    const { url } = await start({ frameLimit: 3 });
    const a = await authenticated(url, 'alice');
    a.client.send({ type: 'connect', to: '0'.repeat(64), from: { userId: '0'.repeat(64) }, text: 'No chat through control' });
    expect(await a.client.next('error')).toMatchObject({ code: 'invalid-frame' });
    const b = await authenticated(url, 'bob'); b.client.send({ type: 'watch', userIds: Array(201).fill('0'.repeat(64)) });
    expect(await b.client.next('error')).toMatchObject({ code: 'invalid-frame' });
    const c = await authenticated(url, 'carol');
    for (let i = 0; i < 3; i++) c.client.send({ type: 'search', query: '', requestId: requestId() });
    expect(await c.client.next('error')).toMatchObject({ code: 'rate-limit' });
  });
  it('bounds registrations and exposes explicit proxy-safe capacity env settings', async () => {
    const { url } = await start({ directoryMaxUsers: 1 }); await authenticated(url, 'alice');
    const full = new Client(url); expect(await full.auth(createDeviceIdentity(), 'bob')).toMatchObject({ code: 'directory-full' });
    expect(optionsFromEnv({ MAX_CONNECTIONS: '256', MAX_CONNECTIONS_PER_IP: '256', DIRECTORY_DB_PATH: '/data/directory.sqlite', MAX_ROOMS: '256' }))
      .toMatchObject({ maxConnections: 256, maxConnectionsPerIp: 256, directoryDbPath: '/data/directory.sqlite', maxRooms: 256 });
    expect(() => optionsFromEnv({ MAX_CONNECTIONS: 'infinite' })).toThrow('Invalid MAX_CONNECTIONS');
  });
});

describe('immutable installation registration and directory synchronization', () => {
  it('lets exactly one concurrent identity claim a username and keeps its original binding', async () => {
    const { url } = await start(); const one = createDeviceIdentity(), two = createDeviceIdentity();
    const a = new Client(url), b = new Client(url);
    const result = await Promise.all([a.auth(one, 'same_login', 'First'), b.auth(two, 'same_login', 'Second')]);
    expect(result.map(frame => frame.type).sort()).toEqual(['error', 'ready']);
    expect(result.find(frame => frame.type === 'error')).toMatchObject({ code: 'username-taken' });
    const winner = result[0]!.type === 'ready' ? one : two;
    const rename = new Client(url); expect(await rename.auth(winner, 'different_login')).toMatchObject({ code: 'device-already-registered' });
    const free = new Client(url); expect(await free.auth(createDeviceIdentity(), 'different_login')).toMatchObject({ type: 'ready' });
    const occupied = new Client(url); expect(await occupied.auth(createDeviceIdentity(), 'same_login')).toMatchObject({ code: 'username-taken' });
  });

  it('resolves only a valid purpose-separated one-use challenge without registering or changing presence', async () => {
    const { url } = await start(); const owner = await authenticated(url, 'owner'); const watcher = await authenticated(url, 'watcher');
    watcher.client.send({ type: 'watch', userIds: [owner.identity.userId] }); await watcher.client.next('presence');
    const before = await resolveDeviceProfile(url, owner.identity);
    expect(before).toMatchObject({ username: 'owner', online: true });
    const unknown = createDeviceIdentity(); expect(await resolveDeviceProfile(url, unknown)).toBeNull();
    watcher.client.send({ type: 'list-users', requestId: requestId() });
    const page = await watcher.client.next('users-page'); expect(page.type === 'users-page' && page.users).toHaveLength(2);
    expect(watcher.client.frames.filter(frame => frame.type === 'presence')).toHaveLength(1);
    expect(await resolveDeviceProfile(url, owner.identity)).toEqual(before);
    // Resolution did not replace the owner's authenticated directory socket.
    owner.client.send({ type: 'list-users', requestId: requestId() }); expect(await owner.client.next('users-page')).toMatchObject({ users: expect.any(Array) });
    const resolver = new Client(url); const challenge = await resolver.next('challenge');
    if (challenge.type !== 'challenge') throw new Error('Missing challenge');
    const signed = { type: 'resolve-profile', publicKey: owner.identity.publicKey, signature: signProfileResolve(owner.identity, challenge.challenge) };
    resolver.send(signed); expect(await resolver.next('profile')).toMatchObject({ user: { username: 'owner' } });
    const replay = new Client(url); await replay.next('challenge'); replay.send(signed); expect(await replay.next('error')).toMatchObject({ code: 'auth-failed' });
    const crossPurpose = new Client(url); const c = await crossPurpose.next('challenge');
    if (c.type !== 'challenge') throw new Error('Missing challenge');
    crossPurpose.send({ ...signed, signature: signAuthentication(owner.identity, c.challenge, 'owner', 'owner') });
    expect(await crossPurpose.next('error')).toMatchObject({ code: 'auth-failed' });
    const reverse = new Client(url); const d = await reverse.next('challenge');
    if (d.type !== 'challenge') throw new Error('Missing challenge');
    reverse.send({ type: 'authenticate', publicKey: unknown.publicKey, username: 'unknown', displayName: 'Unknown', signature: signProfileResolve(unknown, d.challenge) });
    expect(await reverse.next('error')).toMatchObject({ code: 'auth-failed' });
  });

  it('expires profile-resolution challenges and denies unauthenticated catalog reads', async () => {
    const { url } = await start({ directoryChallengeTtlMs: 20 });
    const client = new Client(url); const c = await client.next('challenge'); const identity = createDeviceIdentity();
    if (c.type !== 'challenge') throw new Error('Missing challenge');
    await new Promise(resolve => setTimeout(resolve, 25));
    client.send({ type: 'resolve-profile', publicKey: identity.publicKey, signature: signProfileResolve(identity, c.challenge) });
    expect(await client.next('error')).toMatchObject({ code: 'auth-expired' });
    const unauth = new Client(url); await unauth.next('challenge'); unauth.send({ type: 'list-users', requestId: requestId() });
    expect(await unauth.next('error')).toMatchObject({ code: 'not-authenticated' });
  });

  it('pages 100 canonical public profiles by keyset through real MessengerClient and preserves offline profiles', async () => {
    const path = mkdtempSync(join(tmpdir(), 'lastcall-catalog-')); tempDirs.push(path); const directoryDbPath = join(path, 'directory.sqlite');
    const { url } = await start({ directoryDbPath });
    // Fixture a larger catalog without making the test depend on connection/rate limits.
    const db = new DatabaseSync(directoryDbPath);
    try {
      const insert = db.prepare('INSERT INTO directory_users VALUES (?, ?, ?, ?, ?)');
      for (let i = 0; i < 103; i++) { const identity = createDeviceIdentity(); insert.run(identity.userId, identity.publicKey, `user_${String(i).padStart(3, '0')}`, 'Existing profile', 123); }
      expect(() => db.prepare("UPDATE directory_users SET username='renamed' WHERE username='user_000'").run()).toThrow('Immutable username');
    } finally { db.close(); }
    const identity = createDeviceIdentity();
    expect(await resolveDeviceProfile(url, identity)).toBeNull();
    const manager = new MessengerClient({ serverUrl: url, identity, username: 'reader', displayName: 'Canonical Reader' }); managers.push(manager);
    await manager.connect();
    const first = await manager.listUsers(); expect(first.users).toHaveLength(100); expect(first.nextCursor).toBe(first.users.at(-1)!.username);
    const second = await manager.listUsers(first.nextCursor); expect(second.users).toHaveLength(4); expect(second.nextCursor).toBeUndefined();
    const names = [...first.users, ...second.users].map(user => user.username);
    expect(names).toEqual([...names].sort()); expect(new Set(names).size).toBe(104);
    expect(first.users.find(user => user.username === 'user_000')).toMatchObject({ online: false, lastSeen: 123 });
    manager.disconnect();
    const stale = new MessengerClient({ serverUrl: url, identity, username: 'reader', displayName: 'Stale local name' }); managers.push(stale);
    await stale.connect(); expect(stale.getSnapshot().self?.displayName).toBe('Canonical Reader');
    expect(await resolveDeviceProfile(url, identity)).toMatchObject({ username: 'reader', displayName: 'Canonical Reader' });
    const rename = new MessengerClient({ serverUrl: url, identity, username: 'reader_renamed', displayName: 'Renamed' }); managers.push(rename);
    await expect(rename.connect()).rejects.toThrow('device-already-registered');
    expect((await stale.listUsers()).users.find(user => user.userId === identity.userId)?.username).toBe('reader');
  });

  it('folds Russian and compatibility names while keeping SQL wildcards literal and 48-character queries valid', async () => {
    const { url } = await start();
    const reader = await authenticated(url, 'reader'); const name = new Client(url);
    expect(await name.auth(createDeviceIdentity(), 'ivan', 'ИвАн Петров Ａ %_\\')).toMatchObject({ type: 'ready' });
    const query = async (value: string) => { reader.client.send({ type: 'search', query: value, requestId: requestId() }); const f = await reader.client.next('results'); if (f.type !== 'results') throw new Error('Missing results'); return f.users.map(user => user.username); };
    expect(await query('ИВАН пЕтРоВ a')).toEqual(['ivan']);
    expect(await query('%_\\')).toEqual(['ivan']);
    expect(await query('_')).toEqual(['ivan']);
    expect(await query('a'.repeat(48))).toEqual([]);
    expect(await query("%' OR 1=1 --")).toEqual([]);
  });
});
