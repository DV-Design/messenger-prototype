import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { createDeviceIdentity, directoryServerFrameSchema, signAuthentication, signEmailStart, verifyEmailChallenge, type DeviceIdentity, type DirectoryServerFrame } from '@messenger/core';
import { createSignalingServer, optionsFromEnv, type ServerOptions } from '../src/server.js';

const servers: ReturnType<typeof createSignalingServer>[] = [];
const sockets: WebSocket[] = [];
const paths: string[] = [];
let nextRequest = 0;

afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.terminate();
  await Promise.all(servers.splice(0).map(server => server.close()));
  for (const path of paths.splice(0)) rmSync(path, { recursive: true, force: true });
});

async function start(options: ServerOptions = {}) {
  const server = createSignalingServer({ port: 0, maxConnectionsPerIp: 32, requestLimit: 200, ...options });
  servers.push(server);
  return { server, ...(await server.listen()) };
}

function fileDb() {
  const dir = mkdtempSync(join(tmpdir(), 'lastcall-registration-'));
  paths.push(dir);
  return join(dir, 'directory.sqlite');
}

class Client {
  readonly socket: WebSocket;
  private readonly frames: DirectoryServerFrame[] = [];

  constructor(url: string, headers?: Record<string, string>) {
    this.socket = new WebSocket(url.replace(/^http/, 'ws') + '/directory', { headers });
    sockets.push(this.socket);
    this.socket.on('message', raw => this.frames.push(directoryServerFrameSchema.parse(JSON.parse(raw.toString()))));
  }

  private async next(predicate: (frame: DirectoryServerFrame) => boolean) {
    const deadline = Date.now() + 1500;
    do {
      const index = this.frames.findIndex(predicate);
      if (index >= 0) return this.frames.splice(index, 1)[0]!;
      await new Promise(resolve => setTimeout(resolve, 4));
    } while (Date.now() < deadline);
    throw new Error('Missing directory response');
  }

  private send(frame: object) {
    this.socket.send(JSON.stringify(frame));
  }

  private async challenge() {
    const frame = await this.next(candidate => candidate.type === 'challenge');
    if (frame.type !== 'challenge') throw new Error('Missing challenge');
    return frame.challenge;
  }

  async auth(identity: DeviceIdentity, username: string, inviteCode?: string, emailProof?: string, countryHints?: string[]) {
    const challenge = await this.challenge();
    const signature = signAuthentication(identity, challenge, username, username);
    this.send({ type: 'authenticate', publicKey: identity.publicKey, username, displayName: username, signature, inviteCode, emailProof, countryHints });
    return this.next(frame => frame.type === 'ready' || frame.type === 'error');
  }

  async email(identity: DeviceIdentity, address: string, purpose: 'register' | 'recover', inviteCode?: string) {
    const challenge = await this.challenge();
    const signature = signEmailStart(identity, challenge, purpose, address, 'en');
    this.send({ type: 'email-start', publicKey: identity.publicKey, email: address, purpose, locale: 'en', signature, inviteCode });
    return this.next(frame => frame.type === 'email-started' || frame.type === 'error');
  }

  request(type: string, data: object = {}) {
    const requestId = (++nextRequest).toString(16).padStart(32, '0');
    this.send({ ...data, type, requestId });
    return this.next(frame => 'requestId' in frame && frame.requestId === requestId);
  }

  async createInvite() {
    const reply = await this.request('invite-create');
    if (reply.type !== 'invite-created') throw new Error('Invite could not be created');
    return reply;
  }
}

async function connect(url: string, username: string, identity = createDeviceIdentity()) {
  const client = new Client(url);
  expect(await client.auth(identity, username)).toMatchObject({ type: 'ready' });
  return { client, identity };
}

it('checks the same market policy on HTTP and WebSocket, ignoring spoofed headers and failing closed on an unknown IP', async () => {
  const openIp = '192.0.2.10';
  const restrictedIp = '2001:db8::20';
  const unknownIp = '192.0.2.30';
  const lookup = (ip: string) => ({ [openIp]: 'US', [restrictedIp]: 'RU', [unknownIp]: 'XX' })[ip];
  const config: ServerOptions = { registrationMode: 'market', registrationCountryForIp: lookup };
  const untrusted = await start(config);
  const spoofed = { 'x-forwarded-for': openIp, 'cf-ipcountry': 'US' };
  expect(await (await fetch(untrusted.url + '/registration-policy', { headers: spoofed })).json()).toEqual({ mode: 'invite', countryHints: true });
  expect(await new Client(untrusted.url, spoofed).auth(createDeviceIdentity(), 'spoofed')).toMatchObject({ type: 'error', code: 'invite-required' });
  const trusted = await start({ ...config, trustedProxyCidrs: ['127.0.0.0/8'] });
  for (const [ip, mode] of [[openIp, 'open'], [restrictedIp, 'invite'], [unknownIp, 'invite']] as const) {
    const headers = { 'x-forwarded-for': `${openIp}, ${ip}`, 'cf-ipcountry': 'US' };
    const result = await fetch(trusted.url + '/registration-policy', { headers });
    expect(result.headers.get('cache-control')).toBe('no-store');
    expect(await result.json()).toEqual({ mode, countryHints: true });
    expect(await new Client(trusted.url, headers).auth(createDeviceIdentity(), `market_${mode}_${++nextRequest}`))
      .toMatchObject(mode === 'open' ? { type: 'ready' } : { type: 'error', code: 'invite-required' });
  }
  expect(optionsFromEnv({}).registrationRestrictedCountries).toContain('RU');
  expect(() => optionsFromEnv({ REGISTRATION_MODE: 'market', REGISTRATION_GEOIP_DB: '/missing-lastcall-geoip.mmdb' }))
    .toThrow('Registration country database is unavailable');
  expect(() => optionsFromEnv({ REGISTRATION_MODE: 'anything' })).toThrow(/REGISTRATION_MODE/);
});

it('checks a required invite before sending mail and still needs it at final registration', async () => {
  const admin = createDeviceIdentity();
  const letters: Array<{ text: string }> = [];
  let restricted = false;
  const { url } = await start({
    registrationMode: 'market',
    registrationCountryForIp: () => restricted ? 'RU' : 'US',
    registrationAdminUserIds: [admin.userId],
    emailSender: { async send(letter) { letters.push(letter); } },
    emailHashSecret: 'test-only-email-secret-at-least-32-bytes',
  });
  const { client } = await connect(url, 'owner', admin);
  const { code } = await client.createInvite();
  restricted = true;
  const newIdentity = createDeviceIdentity();
  const address = 'invitee@example.test';
  expect(await new Client(url).email(newIdentity, address, 'register')).toMatchObject({ type: 'error', code: 'invite-required' });
  expect(await new Client(url).email(newIdentity, address, 'register', 'ab'.repeat(32))).toMatchObject({ type: 'error', code: 'invite-invalid' });
  expect(letters).toHaveLength(0);
  const email = await new Client(url).email(newIdentity, address, 'register', code);
  if (email.type !== 'email-started') throw new Error('Expected email challenge');
  const otp = /\b[0-9]{6}\b/.exec(letters[0]?.text ?? '')?.[0];
  if (!otp) throw new Error('Missing OTP');
  const { proof } = await verifyEmailChallenge(url, newIdentity, email.challengeId, otp);
  expect(await new Client(url).auth(newIdentity, 'invitee', undefined, proof)).toMatchObject({ type: 'error', code: 'invite-required' });
  expect(await new Client(url).auth(newIdentity, 'invitee', code, proof)).toMatchObject({ type: 'ready' });
  expect(await new Client(url).auth(newIdentity, 'invitee')).toMatchObject({ type: 'ready' });
});

it('limits delegated issuers to five per UTC day across restart and revoke/regrant, and distinguishes admin rights', async () => {
  const dbPath = fileDb();
  const admin = createDeviceIdentity();
  let now = Date.UTC(2026, 10, 16, 23, 59);
  const config: ServerOptions = { directoryDbPath: dbPath, registrationAdminUserIds: [admin.userId], serviceNow: () => now };
  const initial = await start(config);
  const { client: owner } = await connect(initial.url, 'owner', admin);
  const { client: member, identity } = await connect(initial.url, 'member');
  expect(await member.request('invite-status')).toMatchObject({ canInvite: false, isAdmin: false, remaining: 0, granted: [] });
  expect(await member.request('invite-grant', { username: 'member', enabled: true })).toMatchObject({ type: 'error', code: 'invite-not-allowed' });
  expect(await member.request('invite-create')).toMatchObject({ type: 'error', code: 'invite-not-allowed' });
  expect(await owner.request('invite-grant', { username: 'member', enabled: true })).toMatchObject({ type: 'invite-updated' });
  expect(await owner.request('invite-status')).toMatchObject({ isAdmin: true, granted: ['member'] });
  for (let index = 0; index < 5; index++) await member.createInvite();
  expect(await member.request('invite-create')).toMatchObject({ type: 'error', code: 'invite-limit' });
  await owner.request('invite-grant', { username: 'member', enabled: false });
  expect(await member.request('invite-status')).toMatchObject({ canInvite: false, active: [] });
  await owner.request('invite-grant', { username: 'member', enabled: true });
  await initial.server.close();
  servers.splice(servers.indexOf(initial.server), 1);

  const { url } = await start({ ...config, registrationMode: 'invite' });
  const reconnected = (await connect(url, 'member', identity)).client;
  expect(await reconnected.request('invite-status')).toMatchObject({ remaining: 0, resetAt: Date.UTC(2026, 10, 17), active: [] });
  now = Date.UTC(2026, 10, 17);
  expect(await reconnected.request('invite-status')).toMatchObject({ remaining: 5 });
  const { code } = await reconnected.createInvite();
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    expect(JSON.stringify(db.prepare('SELECT * FROM registration_invites').all())).not.toContain(code);
  } finally {
    db.close();
  }
});

it('consumes exactly once under concurrent registration and rolls back a failed profile insert', async () => {
  const dbPath = fileDb();
  const admin = createDeviceIdentity();
  let country = 'US';
  const { url } = await start({
    directoryDbPath: dbPath,
    registrationMode: 'market',
    registrationCountryForIp: () => country,
    registrationAdminUserIds: [admin.userId],
  });
  const { client } = await connect(url, 'owner', admin);
  const { code } = await client.createInvite();
  country = 'RU';
  const db = new DatabaseSync(dbPath);
  try {
    db.exec("CREATE TRIGGER fail_test_registration BEFORE INSERT ON directory_users WHEN NEW.username='blocked' BEGIN SELECT RAISE(ABORT, 'test refusal'); END");
  } finally {
    db.close();
  }
  expect(await new Client(url).auth(createDeviceIdentity(), 'blocked', code)).toMatchObject({ type: 'error', code: 'directory-error' });
  const replies = await Promise.all([
    new Client(url).auth(createDeviceIdentity(), 'first', code),
    new Client(url).auth(createDeviceIdentity(), 'second', code),
  ]);
  expect(replies.filter(reply => reply.type === 'ready')).toHaveLength(1);
  expect(replies.filter(reply => reply.type === 'error')).toEqual([expect.objectContaining({ code: 'invite-invalid' })]);
  expect(await client.request('invite-status')).toMatchObject({ active: [], remaining: 4 });
});

it('blocks a different issuer from revoking a code and invalidates it after the admin removes an issuer grant', async () => {
  const admin = createDeviceIdentity();
  const { url } = await start({ registrationAdminUserIds: [admin.userId] });
  const { client: owner } = await connect(url, 'owner', admin);
  const { client: alice } = await connect(url, 'alice');
  const { client: bob } = await connect(url, 'bobby');
  for (const username of ['alice', 'bobby']) await owner.request('invite-grant', { username, enabled: true });
  const first = await alice.createInvite();
  await bob.request('invite-revoke', { inviteId: first.id });
  expect(await alice.request('invite-status')).toMatchObject({ active: [{ id: first.id }] });
  await owner.request('invite-grant', { username: 'alice', enabled: false });
  expect(await new Client(url).auth(createDeviceIdentity(), 'invitee', first.code)).toMatchObject({ type: 'error', code: 'invite-invalid' });
  expect(await alice.request('invite-create')).toMatchObject({ type: 'error', code: 'invite-not-allowed' });
});

it('leaves email recovery available while refusing new registrations and drops privileges on key rotation', async () => {
  const dbPath = fileDb();
  const admin = createDeviceIdentity();
  const letters: Array<{ text: string }> = [];
  const config: ServerOptions = {
    directoryDbPath: dbPath,
    registrationAdminUserIds: [admin.userId],
    emailSender: { async send(letter) { letters.push(letter); } },
    emailHashSecret: 'test-only-recovery-secret-at-least-32-bytes',
  };
  const initial = await start(config);
  const { client: owner } = await connect(initial.url, 'owner', admin);
  const address = 'issuer@example.test';
  const oldKey = createDeviceIdentity();
  const email = await new Client(initial.url).email(oldKey, address, 'register');
  if (email.type !== 'email-started') throw new Error('Expected email challenge');
  const otp = /\b[0-9]{6}\b/.exec(letters[0]?.text ?? '')?.[0];
  if (!otp) throw new Error('Missing OTP');
  const { proof } = await verifyEmailChallenge(initial.url, oldKey, email.challengeId, otp);
  const issuer = new Client(initial.url);
  expect(await issuer.auth(oldKey, 'issuer', undefined, proof)).toMatchObject({ type: 'ready' });
  await owner.request('invite-grant', { username: 'issuer', enabled: true });
  await issuer.createInvite();
  await initial.server.close();
  servers.splice(servers.indexOf(initial.server), 1);

  const { url } = await start({ ...config, registrationMode: 'closed' });
  const newKey = createDeviceIdentity();
  expect(await new Client(url).email(newKey, 'new@example.test', 'register')).toMatchObject({ type: 'error', code: 'registration-closed' });
  const recovery = await new Client(url).email(newKey, address, 'recover');
  if (recovery.type !== 'email-started') throw new Error('Expected recovery challenge');
  const recoveryOtp = /\b[0-9]{6}\b/.exec(letters[1]?.text ?? '')?.[0];
  if (!recoveryOtp) throw new Error('Missing recovery OTP');
  const recovered = await verifyEmailChallenge(url, newKey, recovery.challengeId, recoveryOtp);
  expect(recovered.user?.username).toBe('issuer');
  const { client: current } = await connect(url, 'issuer', newKey);
  expect(await current.request('invite-status')).toMatchObject({ canInvite: false, active: [] });
  const { client: reconnectedAdmin } = await connect(url, 'owner', admin);
  expect(await reconnectedAdmin.request('invite-status')).toMatchObject({ granted: [] });
});

it('weighs countries the phone reports, only toward caution, on HTTP and at registration', async () => {
  // The production case: the server sees only a private proxy address, so the address alone is unknown.
  const server = await start({ registrationMode: 'market', registrationCountryForIp: () => undefined });
  const policy = async (hints?: string) => (await (await fetch(server.url + '/registration-policy', hints ? { headers: { 'x-lastcall-country-hints': hints } } : {})).json()).mode;
  expect(await policy()).toBe('invite');
  expect(await policy('RS')).toBe('open');
  expect(await policy('RS,DE')).toBe('open');
  expect(await policy('RS,RU')).toBe('invite'); // a Russian network or Play account anywhere in the list
  expect(await policy('rs')).toBe('invite'); // malformed hints are ignored, leaving the unknown address
  // React Native's fetch turns `cache: 'no-store'` into a `?_=<time>` suffix; the path still routes.
  expect(await (await fetch(server.url + '/registration-policy?_=1763456789000', { headers: { 'x-lastcall-country-hints': 'RS' } })).json()).toEqual({ mode: 'open', countryHints: true });
  expect(await new Client(server.url).auth(createDeviceIdentity(), `hint_open_${++nextRequest}`, undefined, undefined, ['RS'])).toMatchObject({ type: 'ready' });
  expect(await new Client(server.url).auth(createDeviceIdentity(), `hint_ru_${++nextRequest}`, undefined, undefined, ['RS', 'RU'])).toMatchObject({ type: 'error', code: 'invite-required' });
  expect(await new Client(server.url).auth(createDeviceIdentity(), `hint_none_${++nextRequest}`)).toMatchObject({ type: 'error', code: 'invite-required' });
  // A restricted address is not opened by hints from an open country.
  const russianAddress = await start({ registrationMode: 'market', registrationCountryForIp: () => 'RU' });
  expect(await new Client(russianAddress.url).auth(createDeviceIdentity(), `hint_addr_${++nextRequest}`, undefined, undefined, ['RS'])).toMatchObject({ type: 'error', code: 'invite-required' });
});

it('REGISTRATION_COUNTRY_SOURCE=play decides by the reported Google Play country only', async () => {
  const play = optionsFromEnv({ REGISTRATION_MODE: 'market', REGISTRATION_COUNTRY_SOURCE: 'play' });
  expect(play.registrationCountryForIp).toBeUndefined();
  const { registrationPolicy } = await import('../src/registration-invites.js');
  const decide = registrationPolicy(play);
  expect(decide('80.211.139.213', ['RS'])).toBe('open');
  expect(decide('80.211.139.213', ['RU'])).toBe('invite');
  expect(decide('80.211.139.213', [])).toBe('invite');
  expect(decide('80.211.139.213')).toBe('invite');
});
