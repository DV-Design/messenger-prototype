import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { createDeviceIdentity, directoryServerFrameSchema, signAuthentication, type DeviceIdentity, type DirectoryServerFrame } from '@messenger/core';
import { createSignalingServer, optionsFromEnv, type ServerOptions } from '../src/server.js';

const servers: ReturnType<typeof createSignalingServer>[] = [];
const sockets: WebSocket[] = [];
const tempDirs: string[] = [];
afterEach(async () => {
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
    expect(await updated.auth(a.identity, 'alice_new', 'Alice renamed')).toMatchObject({ self: { username: 'alice_new', displayName: 'Alice renamed', online: true } });
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
