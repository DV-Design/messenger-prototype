import { createHmac } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import { createDeviceIdentity, directoryServerFrameSchema, MessengerClient, phoneLookupHash, signAuthentication, type DeviceIdentity, type DirectoryServerFrame, type WakeIntent } from '@messenger/core';
import { createSignalingServer, optionsFromEnv, type ServerOptions } from '../src/server.js';
import { DirectoryServices } from '../src/services.js';
import { buildFcmWakeMessage, createFcmPushProvider, createSmsRuProvider, type PushProvider, type SMSProvider } from '../src/providers.js';

const servers: ReturnType<typeof createSignalingServer>[] = [], sockets: WebSocket[] = [], managers: MessengerClient[] = [];
const dirs: string[] = [];
const phoneA = '+79991234567', phoneB = '+79991234568', phoneC = '+79991234569';
const secret = 'private-test-hmac-secret-32-bytes-minimum';
let sequence = 0;
const requestId = () => (++sequence).toString(16).padStart(32, '0');
afterEach(async () => { for (const client of managers.splice(0)) client.disconnect(); for (const ws of sockets.splice(0)) ws.terminate(); await Promise.all(servers.splice(0).map(server => server.close())); for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
async function start(options: ServerOptions = {}) { const server = createSignalingServer({ port: 0, ...options }); servers.push(server); return { server, ...(await server.listen()) }; }
function providers() {
  const codes = new Map<string, string>(), pushes: string[] = [];
  const smsProvider: SMSProvider = { async sendCode(phone, code) { codes.set(phone, code); } };
  const pushProvider: PushProvider = { async sendWake(token) { pushes.push(token); } };
  return { codes, pushes, smsProvider, pushProvider, phoneVerificationSecret: secret, enableLegacyPhoneServices: true };
}
class Client {
  ws: WebSocket; frames: DirectoryServerFrame[] = []; private queue: DirectoryServerFrame[] = [];
  constructor(url: string) { this.ws = new WebSocket(url.replace('http', 'ws') + '/directory'); sockets.push(this.ws); this.ws.on('message', raw => { const frame = directoryServerFrameSchema.parse(JSON.parse(raw.toString())); this.frames.push(frame); this.queue.push(frame); }); }
  send(frame: unknown) { this.ws.send(JSON.stringify(frame)); }
  async next(predicate: (frame: DirectoryServerFrame) => boolean = () => true) {
    let result: DirectoryServerFrame | undefined;
    await expect.poll(() => { const index = this.queue.findIndex(predicate); if (index >= 0) result = this.queue.splice(index, 1)[0]; return Boolean(result); }, { timeout: 3000, interval: 5 }).toBe(true);
    return result!;
  }
  async rpc(type: string, fields: Record<string, unknown> = {}) { const id = requestId(); this.send({ type, ...fields, requestId: id }); return this.next(frame => 'requestId' in frame && frame.requestId === id); }
  async auth(identity: DeviceIdentity, username: string) { const f = await this.next(frame => frame.type === 'challenge'); if (f.type !== 'challenge') throw new Error('No challenge'); this.send({ type: 'authenticate', publicKey: identity.publicKey, username, displayName: username, signature: signAuthentication(identity, f.challenge, username, username) }); expect(await this.next(frame => frame.type === 'ready')).toMatchObject({ self: { userId: identity.userId } }); }
}
async function user(url: string, username: string, identity = createDeviceIdentity()) { const client = new Client(url); await client.auth(identity, username); return { client, identity }; }
async function begin(client: Client, phone: string) { const frame = await client.rpc('phone-start', { phone }); expect(frame.type).toBe('phone-challenge'); if (frame.type !== 'phone-challenge') throw new Error('No phone challenge'); return frame.challenge; }
async function verify(client: Client, phone: string, fake: ReturnType<typeof providers>) { const c = await begin(client, phone); expect(await client.rpc('phone-verify', { challengeId: c.challengeId, code: fake.codes.get(phone) })).toMatchObject({ type: 'phone-verified' }); }

describe('private-injected phone/push service contract over real WebSockets', () => {
  it('keeps absent services honestly disabled, correlates errors and never changes legacy ready', async () => {
    const { url } = await start(); const { client } = await user(url, 'alice');
    expect(await client.rpc('services')).toMatchObject({ capabilities: { phoneVerification: false, push: false, relay: false, phoneVerified: false } });
    expect(await client.rpc('phone-start', { phone: phoneA })).toMatchObject({ type: 'error', code: 'service-unavailable' });
    expect(await client.rpc('push-register', { token: 'private-test-token' })).toMatchObject({ code: 'service-unavailable' });
    expect(await client.rpc('phone-discover', { hashes: [phoneLookupHash(phoneA)] })).toMatchObject({ code: 'service-unavailable' });
    expect(client.frames.filter(frame => frame.type === 'ready')).toHaveLength(1);
    expect(optionsFromEnv({ SMSRU_API_ID: 'test-not-used', PHONE_VERIFICATION_SECRET: 'short' }).smsProvider).toBeUndefined();
    expect(createFcmPushProvider('/not/a/credential/file')).toBeUndefined();
  });
  it('binds random OTP to identity/challenge, rejects five bad attempts, expires and prevents replay', async () => {
    const fake = providers(); let now = Date.now(); const { url } = await start({ ...fake, serviceNow: () => now });
    const a = await user(url, 'alice'), b = await user(url, 'bob'); const c = await begin(a.client, phoneA);
    const code = fake.codes.get(phoneA)!; expect(/^\d{6}$/.test(code)).toBe(true);
    expect(await b.client.rpc('phone-verify', { challengeId: c.challengeId, code })).toMatchObject({ code: 'phone-code-invalid' });
    const wrong = ((Number(code) + 1) % 1_000_000).toString().padStart(6, '0');
    for (let i = 0; i < 5; i++) expect(await a.client.rpc('phone-verify', { challengeId: c.challengeId, code: wrong })).toMatchObject({ code: 'phone-code-invalid' });
    expect(await a.client.rpc('phone-verify', { challengeId: c.challengeId, code })).toMatchObject({ code: 'phone-code-invalid' });
    now += 60_001; const expired = await begin(a.client, phoneA); now += 300_001;
    expect(await a.client.rpc('phone-verify', { challengeId: expired.challengeId, code: fake.codes.get(phoneA) })).toMatchObject({ code: 'phone-challenge-expired' });
    const current = await begin(a.client, phoneA);
    expect(await a.client.rpc('phone-verify', { challengeId: current.challengeId, code: fake.codes.get(phoneA) })).toMatchObject({ type: 'phone-verified' });
    expect(await a.client.rpc('phone-verify', { challengeId: current.challengeId, code: fake.codes.get(phoneA) })).toMatchObject({ code: 'phone-code-invalid' });
    expect(await a.client.rpc('services')).toMatchObject({ capabilities: { phoneVerification: true, phoneVerified: true } });
  });
  it('retains identity/phone resend and hourly send quotas across socket reconnect', async () => {
    const fake = providers(); let now = Date.now(); const { url } = await start({ ...fake, serviceNow: () => now, smsIdentityMaxPerHour: 2, smsPhoneMaxPerHour: 2 });
    const a = await user(url, 'alice'), b = await user(url, 'bob'); await begin(a.client, phoneA);
    const replacement = await user(url, 'alice', a.identity);
    expect(await replacement.client.rpc('phone-start', { phone: phoneB })).toMatchObject({ code: 'service-rate-limit' });
    expect(await b.client.rpc('phone-start', { phone: phoneA })).toMatchObject({ code: 'service-rate-limit' });
    now += 60_001; await begin(replacement.client, phoneB); now += 60_001;
    expect(await replacement.client.rpc('phone-start', { phone: phoneC })).toMatchObject({ code: 'service-rate-limit' });
    await begin(b.client, phoneA); now += 60_001; const c = await user(url, 'carol');
    expect(await c.client.rpc('phone-start', { phone: phoneA })).toMatchObject({ code: 'service-rate-limit' });
  });
  it('returns no challenge or verification on provider rejection/late acceptance and conservatively bounds spend', async () => {
    let now = Date.now(); const fake = providers();
    const { url } = await start({ ...fake, smsProvider: { async sendCode() { throw new Error('provider detail must stay private'); } }, smsMaxPerHour: 1 });
    const a = await user(url, 'alice'), b = await user(url, 'bob');
    const failure = await a.client.rpc('phone-start', { phone: phoneA }); expect(failure).toMatchObject({ code: 'provider-failed' }); expect(JSON.stringify(failure).includes('provider detail')).toBe(false);
    expect(await b.client.rpc('phone-start', { phone: phoneB })).toMatchObject({ code: 'service-rate-limit' });
    expect(a.client.frames.some(frame => frame.type === 'phone-challenge')).toBe(false);
    const slow = await start({ ...fake, serviceNow: () => now, smsProvider: { async sendCode() { now += 300_001; } } });
    const late = await user(slow.url, 'late'); expect(await late.client.rpc('phone-start', { phone: phoneC })).toMatchObject({ code: 'phone-challenge-expired' });
    expect(await late.client.rpc('services')).toMatchObject({ capabilities: { phoneVerified: false } });
  });
  it('discovers exact hashes only after own verification and refuses silent phone reassignment', async () => {
    const fake = providers(); let now = Date.now(); const { url } = await start({ ...fake, serviceNow: () => now });
    const a = await user(url, 'alice'), b = await user(url, 'bob'); await verify(a.client, phoneA, fake); await verify(b.client, phoneB, fake);
    expect(await a.client.rpc('phone-discover', { hashes: [phoneLookupHash(phoneB), '0'.repeat(64)] })).toMatchObject({ type: 'phone-matches', matches: [{ hash: phoneLookupHash(phoneB), user: { userId: b.identity.userId } }] });
    now += 60_001; const conflict = await begin(a.client, phoneB);
    expect(await a.client.rpc('phone-verify', { challengeId: conflict.challengeId, code: fake.codes.get(phoneB) })).toMatchObject({ code: 'phone-already-bound' });
    const invalid = new Client(url); await invalid.auth(createDeviceIdentity(), 'invalid');
    invalid.send({ type: 'phone-discover', hashes: Array(101).fill('0'.repeat(64)), requestId: requestId() }); expect(await invalid.next(frame => frame.type === 'error')).toMatchObject({ code: 'invalid-frame' });
  });
  it('isolates tokens and requires persisted recipient watch consent for offline generic idempotent wakes', async () => {
    const fake = providers(); let now = Date.now(); const path = mkdtempSync(join(tmpdir(), 'lastcall-service-')); dirs.push(path); const dbPath = join(path, 'directory.sqlite');
    const first = await start({ ...fake, serviceNow: () => now, directoryDbPath: dbPath });
    const a = await user(first.url, 'alice'), b = await user(first.url, 'bob');
    expect(await b.client.rpc('push-register', { token: 'recipient-private-token' })).toMatchObject({ type: 'push-registered' });
    expect(await a.client.rpc('push-register', { token: 'recipient-private-token' })).toMatchObject({ code: 'push-token-in-use' });
    a.client.send({ type: 'wake', to: b.identity.userId }); expect(await a.client.next(frame => frame.type === 'error')).toMatchObject({ code: 'wake-not-allowed' });
    b.client.send({ type: 'watch', userIds: [a.identity.userId] }); await b.client.next(frame => frame.type === 'presence'); await verify(b.client, phoneB, fake);
    await first.server.close();
    const second = await start({ ...fake, serviceNow: () => now, directoryDbPath: dbPath }); const sender = await user(second.url, 'alice', a.identity);
    sender.client.send({ type: 'wake', to: b.identity.userId }); await expect.poll(() => fake.pushes.length).toBe(1);
    sender.client.send({ type: 'wake', to: b.identity.userId }); await sender.client.rpc('services'); expect(fake.pushes.length).toBe(1);
    now += 30_001; sender.client.send({ type: 'wake', to: b.identity.userId }); await expect.poll(() => fake.pushes.length).toBe(2);
    expect(fake.pushes.every(value => value === 'recipient-private-token')).toBe(true);
    expect(JSON.stringify(await sender.client.rpc('lookup', { userIds: [b.identity.userId] })).includes('recipient-private-token')).toBe(false);
    const recipient = await user(second.url, 'bob', b.identity); expect(await recipient.client.rpc('services')).toMatchObject({ capabilities: { phoneVerified: true } });
    recipient.client.send({ type: 'watch', userIds: [] }); await recipient.client.rpc('services');
    sender.client.send({ type: 'wake', to: b.identity.userId }); expect(await sender.client.next(frame => frame.type === 'error')).toMatchObject({ code: 'wake-not-allowed' });
    const db = new DatabaseSync(dbPath); try { const rows = db.prepare('SELECT phone_hash FROM verified_phones').all(); expect(rows).toEqual([{ phone_hash: phoneLookupHash(phoneB) }]); } finally { db.close(); }
  });
  it('restricts public ICE to STUN while authenticated quota-bound ICE returns valid TURN HMAC', async () => {
    const { url } = await start({ requireIceAuth: true, turnSharedSecret: secret, turnUrls: ['turn:127.0.0.1:3478'], stunUrls: ['stun:127.0.0.1:3478'] });
    expect(await (await fetch(url + '/ice')).json()).toEqual({ iceServers: [{ urls: ['stun:127.0.0.1:3478'] }] });
    const a = await user(url, 'alice'); const frame = await a.client.rpc('ice'); expect(frame.type).toBe('ice');
    if (frame.type !== 'ice') throw new Error('No ICE reply'); const turn = frame.iceServers[1]!;
    expect(turn.credential).toBe(createHmac('sha1', secret).update(turn.username!).digest('base64'));
    for (let i = 0; i < 59; i++) expect((await a.client.rpc('ice')).type).toBe('ice');
    expect(await a.client.rpc('ice')).toMatchObject({ code: 'service-rate-limit' });
    const unauth = new Client(url); await unauth.next(frame => frame.type === 'challenge'); unauth.send({ type: 'ice', requestId: requestId() }); expect(await unauth.next(frame => frame.type === 'error')).toMatchObject({ code: 'not-authenticated' });
  });
  it('bounds abandoned provider work and closes safely without unhandled rejection', async () => {
    const { url, server } = await start({ enableLegacyPhoneServices: true, phoneVerificationSecret: secret, smsProvider: { async sendCode() { return new Promise(() => {}); }, async dispose() { return new Promise(() => {}); } }, providerTimeoutMs: 25 });
    const a = await user(url, 'alice'); expect(await a.client.rpc('phone-start', { phone: phoneA })).toMatchObject({ code: 'provider-failed' });
    const before = Date.now(); await server.close(); expect(Date.now() - before).toBeLessThan(500);
  });
  it('bounds wake attempts per sender across recipients and hides push provider failures', async () => {
    const fake = providers(); let now = Math.floor(Date.now() / 3_600_000) * 3_600_000 + 1000;
    const { url } = await start({ ...fake, serviceNow: () => now, frameLimit: 500 });
    const sender = await user(url, 'sender'); const recipients = [];
    for (let i = 0; i < 3; i++) {
      const recipient = await user(url, `recipient_${i}`); recipients.push(recipient);
      await recipient.client.rpc('push-register', { token: `recipient-token-${i}` }); recipient.client.send({ type: 'watch', userIds: [sender.identity.userId] }); await recipient.client.next(frame => frame.type === 'presence');
    }
    for (let i = 0; i < 40; i++) {
      for (const recipient of recipients) sender.client.send({ type: 'wake', to: recipient.identity.userId });
      await expect.poll(() => fake.pushes.length).toBe((i + 1) * 3); now += 30_001;
    }
    sender.client.send({ type: 'wake', to: recipients[0]!.identity.userId }); expect(await sender.client.next(frame => frame.type === 'error')).toMatchObject({ code: 'service-rate-limit' });
    const failed = await start({ pushProvider: { async sendWake() { throw new Error('private SDK/token detail'); } } });
    const a = await user(failed.url, 'alice'), b = await user(failed.url, 'bob'); await b.client.rpc('push-register', { token: 'failure-token' }); b.client.send({ type: 'watch', userIds: [a.identity.userId] }); await b.client.next(frame => frame.type === 'presence');
    a.client.send({ type: 'wake', to: b.identity.userId }); const error = await a.client.next(frame => frame.type === 'error'); expect(error).toMatchObject({ code: 'provider-failed' }); expect(JSON.stringify(error).includes('private SDK')).toBe(false);
  });
  it('uses the real SMS.ru adapter POST contract and checks recipient acceptance without test mode', async () => {
    const fetcher = vi.fn<typeof fetch>(async (_url, options) => {
      const body = options?.body as URLSearchParams;
      expect(options?.method).toBe('POST'); expect(options?.redirect).toBe('error'); expect(body.has('test')).toBe(false); expect(body.get('to')).toBe(phoneA.slice(1));
      return new Response(JSON.stringify({ status: 'OK', status_code: 100, sms: { [phoneA.slice(1)]: { status: 'OK', status_code: 100 } } }));
    });
    await createSmsRuProvider('test-provider-key', fetcher).sendCode(phoneA, '123456'); expect(fetcher.mock.calls[0]?.[0]).toBe('https://sms.ru/sms/send');
    await expect(createSmsRuProvider('test-provider-key', async () => new Response(JSON.stringify({ status: 'OK', status_code: 100, sms: {} }))).sendCode(phoneA, '123456')).rejects.toThrow('could not accept');
  });
});

it('integrates real MessengerClient service APIs, verified discovery, offline wake and pending text without false delivery', async () => {
  const fake = providers(); const { url } = await start({ ...fake, requireIceAuth: true, stunUrls: ['stun:127.0.0.1:3478'], turnUrls: ['turn:127.0.0.1:3478'], turnSharedSecret: secret });
  // No P2P transport is claimed by this control-plane test; rtcFactory intentionally never opens its channel.
  const rtcFactory = () => ({ signalingState: 'stable', connectionState: 'new', getSenders: () => [], createDataChannel: () => ({ readyState: 'connecting', close() {} }), close() {}, async getStats() { return new Map(); } }) as unknown as RTCPeerConnection;
  const a = new MessengerClient({ serverUrl: url, identity: createDeviceIdentity(), username: 'manager_alice', displayName: 'Manager Alice', rtcFactory });
  const b = new MessengerClient({ serverUrl: url, identity: createDeviceIdentity(), username: 'manager_bob', displayName: 'Manager Bob', rtcFactory }); managers.push(a, b);
  await Promise.all([a.connect(), b.connect()]);
  expect(await a.getServices()).toEqual({ phoneVerification: true, push: true, relay: true, phoneVerified: false });
  const ca = await a.startPhoneVerification(phoneA); await a.verifyPhone(ca.challengeId, fake.codes.get(phoneA)!);
  const cb = await b.startPhoneVerification(phoneB); await b.verifyPhone(cb.challengeId, fake.codes.get(phoneB)!);
  expect((await a.discoverPhones([phoneLookupHash(phoneB)]))[0]?.user.userId).toBe(b.getSnapshot().self!.userId);
  expect((await a.getIceServers()).some(server => (Array.isArray(server.urls) ? server.urls : [server.urls]).some(value => value.startsWith('turn:')))).toBe(true);
  await b.registerPushToken('manager-recipient-token');
  await b.addContact(a.getSnapshot().self!); const conversation = await a.addContact(b.getSnapshot().self!);
  await b.getServices(); // Round-trip barrier after watch persisted consent.
  b.disconnect(); await expect.poll(() => a.getSnapshot().contacts.find(user => user.username === 'manager_bob')?.online).toBe(false);
  await a.sendText(conversation, 'synthetic pending integration message');
  await expect.poll(() => fake.pushes.length, { timeout: 5000 }).toBe(1);
  expect(fake.pushes[0] === 'manager-recipient-token').toBe(true);
  expect(a.getSnapshot().conversations.find(c => c.id === conversation)?.messages.at(-1)?.status).toBe('pending');
});

it('retires public phone features even with legacy secrets/provider injection and existing verified metadata', async () => {
  const fake = providers(); const path = mkdtempSync(join(tmpdir(), 'lastcall-retired-phone-')); dirs.push(path); const directoryDbPath = join(path, 'directory.sqlite');
  const legacy = await start({ ...fake, directoryDbPath }); const owner = await user(legacy.url, 'existing');
  await verify(owner.client, phoneA, fake); await legacy.server.close(); fake.codes.clear();
  // The explicit private test switch is absent on a normal/public factory.
  const publicServer = await start({ ...fake, enableLegacyPhoneServices: false, directoryDbPath });
  const current = await user(publicServer.url, 'existing', owner.identity);
  expect(await current.client.rpc('services')).toMatchObject({ capabilities: { phoneVerification: false, phoneVerified: false, push: true } });
  expect(await current.client.rpc('phone-start', { phone: phoneB })).toMatchObject({ code: 'service-unavailable' });
  expect(await current.client.rpc('phone-verify', { challengeId: '1'.repeat(32), code: '123456' })).toMatchObject({ code: 'service-unavailable' });
  expect(await current.client.rpc('phone-discover', { hashes: [phoneLookupHash(phoneA)] })).toMatchObject({ code: 'service-unavailable' });
  expect(fake.codes.size).toBe(0);
  const configured = optionsFromEnv({ SMSRU_API_ID: 'legacy-ignored', PHONE_VERIFICATION_SECRET: secret, SMS_MAX_PER_HOUR: 'invalid-ignored', ENABLE_LEGACY_PHONE_SERVICES: '1' });
  expect(configured.smsProvider).toBeUndefined(); expect(configured.phoneVerificationSecret).toBeUndefined(); expect(configured.enableLegacyPhoneServices).toBeUndefined();
  const db = new DatabaseSync(directoryDbPath); try { expect(db.prepare('SELECT COUNT(*) AS count FROM verified_phones').get()).toEqual({ count: 1 }); } finally { db.close(); }
});

describe('short-lived typed wake metadata', () => {
  it('keeps consent and legacy compatibility, bounds deadlines, deduplicates IDs and gives calls a separate cooldown', async () => {
    let now = Date.now(); const pushes: Array<{ token: string; intent?: WakeIntent }> = [];
    const { url } = await start({ serviceNow: () => now, pushProvider: { async sendWake(token, intent) { pushes.push({ token, intent }); } } });
    const sender = await user(url, 'sender'), recipient = await user(url, 'recipient');
    await recipient.client.rpc('push-register', { token: 'private-typed-token' });
    const typed = (kind: WakeIntent['kind'], intentId = requestId(), expiresAt = now + 600_000) => ({ type: 'wake', to: recipient.identity.userId, kind, intentId, expiresAt });
    sender.client.send(typed('call')); expect(await sender.client.next(frame => frame.type === 'error')).toMatchObject({ code: 'wake-not-allowed' });
    recipient.client.send({ type: 'watch', userIds: [sender.identity.userId] }); await recipient.client.next(frame => frame.type === 'presence');
    const message = typed('message'); sender.client.send(message); await expect.poll(() => pushes.length).toBe(1);
    expect(pushes[0]).toEqual({ token: 'private-typed-token', intent: { kind: 'message', intentId: message.intentId, expiresAt: now + 60_000 } });
    const call = typed('call'); sender.client.send(call); await expect.poll(() => pushes.length).toBe(2);
    expect(pushes[1]?.intent).toEqual({ kind: 'call', intentId: call.intentId, expiresAt: now + 30_000 });
    sender.client.send(typed('file')); sender.client.send(typed('call')); await sender.client.rpc('services'); expect(pushes).toHaveLength(2);
    now += 30_001;
    sender.client.send(message); await sender.client.rpc('services'); expect(pushes).toHaveLength(2); // ID still consumed after cooldown.
    sender.client.send(typed('file')); await expect.poll(() => pushes.length).toBe(3); expect(pushes[2]?.intent?.expiresAt).toBe(now + 60_000);
    sender.client.send(typed('call', requestId(), now)); expect(await sender.client.next(frame => frame.type === 'error')).toMatchObject({ code: 'wake-expired' });
    now += 30_001; sender.client.send({ type: 'wake', to: recipient.identity.userId }); await expect.poll(() => pushes.length).toBe(4); expect(pushes[3]?.intent).toBeUndefined();
    expect(sender.client.frames.some(frame => frame.type === 'ready' && Object.keys(frame).length !== 2)).toBe(false);
  });

  it('rejects partial metadata and extra content over real authenticated WebSockets', async () => {
    const { url } = await start();
    const invalid = [ { kind: 'call' }, { kind: 'message', intentId: requestId() }, { kind: 'file', intentId: requestId(), expiresAt: 1, filename: 'forbidden' }, { kind: 'call', intentId: requestId(), expiresAt: Number.MAX_SAFE_INTEGER + 1 } ];
    for (let i = 0; i < invalid.length; i++) {
      const sender = await user(url, `invalid_${i}`);
      sender.client.send({ type: 'wake', to: '1'.repeat(64), ...invalid[i] });
      expect(await sender.client.next(frame => frame.type === 'error')).toMatchObject({ code: 'invalid-frame' });
    }
  });

  it('consumes typed IDs before asynchronous provider failure and rechecks deadline before provider invocation', async () => {
    const db = new DatabaseSync(':memory:'); db.exec("CREATE TABLE directory_users(user_id TEXT PRIMARY KEY); INSERT INTO directory_users VALUES ('sender'), ('recipient')");
    const clock = vi.fn(() => 100_000); const sendWake = vi.fn(async () => { throw new Error('private provider detail'); });
    const services = new DirectoryServices(db, { serviceNow: clock, pushProvider: { sendWake } }, () => undefined, () => []);
    try {
      services.registerPush('recipient', 'private-token'); services.replaceWatchConsent('recipient', ['sender']);
      const intent: WakeIntent = { kind: 'message', intentId: requestId(), expiresAt: 160_000 };
      await expect(services.wake('sender', 'recipient', intent)).rejects.toThrow('Push provider did not accept notification');
      clock.mockImplementation(() => 131_000);
      await services.wake('sender', 'recipient', intent); expect(sendWake).toHaveBeenCalledTimes(1);
      // Time advances after initial validation/reservation but before the async SDK operation.
      clock.mockImplementationOnce(() => 131_000).mockImplementationOnce(() => 131_000).mockImplementationOnce(() => 131_000).mockImplementation(() => 161_001);
      await expect(services.wake('sender', 'recipient', { kind: 'call', intentId: requestId(), expiresAt: 150_000 })).rejects.toThrow('Notification intent expired');
      expect(sendWake).toHaveBeenCalledTimes(1);
    } finally { await services.close(); db.close(); }
  });

  it('constructs only generic FCM metadata with remaining TTL and never sends expired notifications', () => {
    const now = 100_000, intentId = requestId();
    for (const kind of ['message', 'file', 'call'] as const) {
      const message = buildFcmWakeMessage('private-device-token', { kind, intentId, expiresAt: now + 900_000 }, now)!;
      const ttl = kind === 'call' ? 30_000 : 60_000;
      expect(message.data).toEqual({ kind: 'lastcall-wake', intentKind: kind, intentId, expiresAt: String(now + ttl) });
      expect(message.android?.ttl).toBe(ttl); expect(message.android?.collapseKey).toBe(kind === 'call' ? 'lastcall-call' : 'lastcall-wake');
      expect(message.notification?.body).toContain(kind === 'call' ? 'Ожидается звонок' : kind === 'file' ? 'Ожидается отправка файла' : 'Ожидается отправка сообщения');
      expect(Object.keys(message).sort()).toEqual(['android', 'data', 'notification', 'token']);
      expect(buildFcmWakeMessage('private-device-token', { kind, intentId, expiresAt: now }, now)).toBeUndefined();
    }
    expect(buildFcmWakeMessage('legacy-token', undefined, now)?.data).toEqual({ kind: 'lastcall-wake' });
    expect(buildFcmWakeMessage('token', { kind: 'call', intentId, expiresAt: now + 1234 }, now)?.android?.ttl).toBe(1234);
  });
});

describe('opt-in background token routing over real WebSockets',()=>{
 it('forwards only the authenticated registered token capability and supports legacy reset',async()=>{
  const modes:boolean[]=[];let now=Date.now();const {url}=await start({serviceNow:()=>now,pushProvider:{async sendWake(_token,_intent,backgroundSync){modes.push(backgroundSync===true);}}});
  const a=await user(url,'background_sender'),b=await user(url,'background_recipient');expect(await b.client.rpc('push-register',{token:'background-token',backgroundSync:true})).toMatchObject({type:'push-registered'});b.client.send({type:'watch',userIds:[a.identity.userId]});await b.client.next(f=>f.type==='presence');
  a.client.send({type:'wake',to:b.identity.userId,kind:'message',intentId:requestId(),expiresAt:now+60000});await expect.poll(()=>modes).toEqual([true]);expect(await b.client.rpc('push-register',{token:'background-token'})).toMatchObject({type:'push-registered'});now+=30001;
  a.client.send({type:'wake',to:b.identity.userId,kind:'message',intentId:requestId(),expiresAt:now+60000});await expect.poll(()=>modes).toEqual([true,false]);
 });
});
