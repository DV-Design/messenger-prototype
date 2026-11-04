import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import { EmailAuthError, MessengerClient, createDeviceIdentity, directoryServerFrameSchema, resolveDeviceProfile, signAuthentication, signEmailStart, startEmailChallenge, verifyEmailChallenge, type DeviceIdentity, type DirectoryServerFrame, type EmailPurpose } from '@messenger/core';
import { EmailAuth } from '../src/email-auth.js';
import { createSignalingServer, optionsFromEnv, type ServerOptions } from '../src/server.js';

const servers: ReturnType<typeof createSignalingServer>[] = [];
const sockets: WebSocket[] = [];
const dirs: string[] = [];
const managers: MessengerClient[] = [];
afterEach(async () => {
  for (const manager of managers.splice(0)) manager.disconnect();
  for (const ws of sockets.splice(0)) ws.terminate();
  await Promise.all(servers.splice(0).map((server) => server.close()));
  for (const path of dirs.splice(0)) rmSync(path, { recursive: true, force: true });
  vi.restoreAllMocks();
});
type Letter = { to: string; subject: string; text: string };
const SECRET = 'email-hash-secret-for-tests-only-0123456789';
async function start(options: ServerOptions = {}) {
  const letters: Letter[] = [];
  const server = createSignalingServer({ port: 0, maxConnectionsPerIp: 256, maxConnections: 512, requestLimit: 10_000, emailHashSecret: SECRET, emailSender: { send: async (letter) => { letters.push(letter); } }, ...options });
  servers.push(server);
  return { server, letters, ...(await server.listen()) };
}
const until = async <T>(read: () => T | undefined | false, what = 'condition'): Promise<T> => {
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) { const value = read(); if (value) return value; await new Promise((resolve) => setTimeout(resolve, 5)); }
  throw new Error(`Timed out waiting for ${what}`);
};
class Client {
  ws: WebSocket;
  frames: DirectoryServerFrame[] = [];
  closed = false;
  constructor(url: string) {
    this.ws = new WebSocket(url.replace('http', 'ws') + '/directory'); sockets.push(this.ws);
    this.ws.on('message', (raw) => { this.frames.push(directoryServerFrameSchema.parse(JSON.parse(raw.toString()))); });
    this.ws.on('close', () => { this.closed = true; });
  }
  send(frame: unknown) { this.ws.send(JSON.stringify(frame)); }
  next(type: DirectoryServerFrame['type']) { return until(() => this.frames.find((frame) => frame.type === type), `frame ${type}`); }
  async auth(identity: DeviceIdentity, username: string, emailProof?: string, displayName = username) {
    const challenge = await this.next('challenge'); if (challenge.type !== 'challenge') throw new Error('Missing challenge');
    this.send({ type: 'authenticate', publicKey: identity.publicKey, username, displayName, signature: signAuthentication(identity, challenge.challenge, username, displayName), ...(emailProof ? { emailProof } : {}) });
    return until(() => this.frames.find((frame) => frame.type === 'ready' || frame.type === 'error'), 'auth reply');
  }
}
const newKey = () => createDeviceIdentity();
const codeOf = (letter: Letter) => /\b([0-9]{6})\b/.exec(letter.text)?.[1];
async function requestCode(env: { url: string; letters: Letter[] }, identity: DeviceIdentity, purpose: EmailPurpose, email: string, locale: 'en' | 'ru' = 'en') {
  const before = env.letters.length;
  const challengeId = await startEmailChallenge(env.url, identity, { purpose, email, locale });
  const letter = await until(() => env.letters[before], 'letter');
  return { challengeId, letter, code: codeOf(letter) };
}
async function register(env: { url: string; letters: Letter[] }, username: string, email: string, identity = newKey()) {
  const { challengeId, code } = await requestCode(env, identity, 'register', email);
  const { proof } = await verifyEmailChallenge(env.url, identity, challengeId, code!);
  const client = new Client(env.url);
  expect(await client.auth(identity, username, proof)).toMatchObject({ type: 'ready' });
  return { identity, client };
}
async function recover(env: { url: string; letters: Letter[] }, email: string, identity = newKey()) {
  const { challengeId, code } = await requestCode(env, identity, 'recover', email);
  const { user } = await verifyEmailChallenge(env.url, identity, challengeId, code!);
  return { identity, user: user! };
}
const refusal = (promise: Promise<unknown>) => promise.then(() => { throw new Error('Expected a refusal'); }, (error) => { expect(error).toBeInstanceOf(EmailAuthError); return (error as EmailAuthError).code; });
const fileDb = () => { const dir = mkdtempSync(join(tmpdir(), 'lastcall-email-')); dirs.push(dir); return { dir, path: join(dir, 'directory.sqlite') }; };

describe('no account enumeration', () => {
  it('sends the right letter per contract row with one identical reply', async () => {
    const env = await start();
    await register(env, 'owner', 'taken@example.com');
    const rows: Array<[EmailPurpose, string, boolean]> = [['register', 'free1@example.com', true], ['register', 'taken@example.com', false], ['recover', 'free2@example.com', false], ['recover', 'taken@example.com', true]];
    for (const [purpose, email, hasCode] of rows) {
      const { challengeId, letter, code } = await requestCode(env, newKey(), purpose, email);
      expect(challengeId, `${purpose} ${email}`).toMatch(/^[0-9a-f]{32}$/);
      expect(letter.to).toBe(email);
      expect(Boolean(code), `${purpose} ${email}`).toBe(hasCode);
      expect(letter.subject).not.toMatch(/[0-9]{6}/);
    }
    const binder = await register(env, 'binder', 'binder@example.com');
    await register(env, 'owner2', 'taken2@example.com'); // Each address has its own hourly quota.
    const taken = await requestCode(env, binder.identity, 'bind', 'taken2@example.com');
    expect(taken.code).toBeUndefined();
    const free = await requestCode(env, binder.identity, 'bind', 'free3@example.com');
    expect(free.code).toBeDefined();
  });
  it('answers with the same frame keys and refuses codeless challenges like wrong codes', async () => {
    const env = await start();
    await register(env, 'owner', 'taken@example.com');
    const key = newKey();
    const noAccount = await startEmailChallenge(env.url, key, { purpose: 'recover', email: 'free@example.com', locale: 'en' });
    expect(await refusal(verifyEmailChallenge(env.url, key, noAccount, '000000'))).toBe('email-code-invalid');
    expect(await refusal(verifyEmailChallenge(env.url, key, 'ab'.repeat(16), '000000'))).toBe('email-code-invalid');
    const real = await requestCode(env, key, 'recover', 'taken@example.com');
    const wrong = real.code === '000000' ? '000001' : '000000';
    expect(await refusal(verifyEmailChallenge(env.url, key, real.challengeId, wrong))).toBe('email-code-invalid');
    expect(await refusal(verifyEmailChallenge(env.url, newKey(), real.challengeId, real.code!))).toBe('email-code-invalid');
  });
  it('replies before the letter is delivered', async () => {
    let release!: () => void; const pending = new Promise<void>((resolve) => { release = resolve; });
    const env = await start({ emailSender: { send: () => pending } });
    await expect(startEmailChallenge(env.url, newKey(), { purpose: 'register', email: 'slow@example.com', locale: 'en' })).resolves.toMatch(/^[0-9a-f]{32}$/);
    release();
  });
  it('closes the one-shot connection and refuses a replayed signature', async () => {
    const env = await start();
    const key = newKey();
    const client = new Client(env.url);
    const challenge = await client.next('challenge'); if (challenge.type !== 'challenge') throw new Error('Missing challenge');
    const signature = signEmailStart(key, challenge.challenge, 'register', 'one@example.com', 'en');
    client.send({ type: 'email-start', purpose: 'register', email: 'one@example.com', locale: 'en', publicKey: key.publicKey, signature });
    await client.next('email-started');
    await until(() => client.closed, 'server close');
    expect(client.frames.some((frame) => frame.type === 'ready')).toBe(false);
    const again = new Client(env.url); await again.next('challenge');
    again.send({ type: 'email-start', purpose: 'register', email: 'one@example.com', locale: 'en', publicKey: key.publicKey, signature });
    expect(await again.next('error')).toMatchObject({ code: 'auth-failed' });
  });
  it('reports email-unavailable when not configured', async () => {
    const env = await start({ emailSender: undefined, emailHashSecret: undefined });
    expect(await refusal(startEmailChallenge(env.url, newKey(), { purpose: 'register', email: 'a@example.com', locale: 'en' }))).toBe('email-unavailable');
  });
});

describe('codes', () => {
  it('expire after ten minutes', async () => {
    let now = 1_000_000_000_000;
    const env = await start({ serviceNow: () => now });
    const key = newKey();
    const { challengeId, code } = await requestCode(env, key, 'register', 'late@example.com');
    now += 600_000;
    expect(await refusal(verifyEmailChallenge(env.url, key, challengeId, code!))).toBe('email-code-invalid');
  });
  it('allow five attempts, then even the right code fails', async () => {
    const env = await start();
    const key = newKey();
    const { challengeId, code } = await requestCode(env, key, 'register', 'tries@example.com');
    const wrong = code === '000000' ? '000001' : '000000';
    for (let attempt = 0; attempt < 5; attempt++) expect(await refusal(verifyEmailChallenge(env.url, key, challengeId, wrong))).toBe('email-code-invalid');
    expect(await refusal(verifyEmailChallenge(env.url, key, challengeId, code!))).toBe('email-code-invalid');
  });
  it('work once, and a newer request replaces the older challenge', async () => {
    const env = await start();
    const key = newKey();
    const first = await requestCode(env, key, 'register', 'twice@example.com');
    const second = await requestCode(env, key, 'register', 'twice@example.com');
    expect(await refusal(verifyEmailChallenge(env.url, key, first.challengeId, first.code!))).toBe('email-code-invalid');
    expect((await verifyEmailChallenge(env.url, key, second.challengeId, second.code!)).proof).toMatch(/^[0-9a-f]{64}$/);
    expect(await refusal(verifyEmailChallenge(env.url, key, second.challengeId, second.code!))).toBe('email-code-invalid');
  });
});

describe('registration gate and proofs', () => {
  it('requires a proof for new keys when required, but never for existing profiles', async () => {
    const { path } = fileDb();
    const open = await start({ directoryDbPath: path });
    const old = new Client(open.url); const oldKey = newKey();
    expect(await old.auth(oldKey, 'legacy')).toMatchObject({ type: 'ready' });
    old.ws.terminate(); await servers.pop()!.close();
    const env = await start({ directoryDbPath: path, emailRequired: true });
    const again = new Client(env.url);
    expect(await again.auth(oldKey, 'legacy')).toMatchObject({ type: 'ready' });
    const fresh = new Client(env.url);
    expect(await fresh.auth(newKey(), 'fresh')).toMatchObject({ type: 'error', code: 'email-required' });
    await register(env, 'proven', 'proven@example.com');
  });
  it('binds a valid proof with the flag off and registers plainly without one', async () => {
    const env = await start();
    const plain = new Client(env.url);
    expect(await plain.auth(newKey(), 'plain')).toMatchObject({ type: 'ready' });
    await register(env, 'bound', 'bound@example.com');
    expect((await recover(env, 'bound@example.com')).user.username).toBe('bound');
  });
  it('binds proofs to their key, spends them once and keeps them across username-taken', async () => {
    const env = await start();
    await register(env, 'first', 'first@example.com');
    const key = newKey();
    const { challengeId, code } = await requestCode(env, key, 'register', 'second@example.com');
    const { proof } = await verifyEmailChallenge(env.url, key, challengeId, code!);
    expect(await new Client(env.url).auth(newKey(), 'thief', proof)).toMatchObject({ type: 'error', code: 'email-required' });
    expect(await new Client(env.url).auth(key, 'first', proof)).toMatchObject({ type: 'error', code: 'username-taken' });
    const done = new Client(env.url);
    expect(await done.auth(key, 'second', proof)).toMatchObject({ type: 'ready' });
    done.ws.terminate();
    const other = newKey();
    expect(await new Client(env.url).auth(other, 'replay', proof)).toMatchObject({ type: 'error', code: 'email-required' });
  });
  it('expires proofs after fifteen minutes', async () => {
    let now = 1_000_000_000_000;
    const env = await start({ serviceNow: () => now });
    const key = newKey();
    const { challengeId, code } = await requestCode(env, key, 'register', 'slowpoke@example.com');
    const { proof } = await verifyEmailChallenge(env.url, key, challengeId, code!);
    now += 900_000;
    expect(await new Client(env.url).auth(key, 'slowpoke', proof)).toMatchObject({ type: 'error', code: 'email-required' });
  });
  it('refuses a proof when the address was bound in the meantime', async () => {
    const env = await start();
    const a = newKey(), b = newKey();
    const ra = await requestCode(env, a, 'register', 'race@example.com');
    const pa = (await verifyEmailChallenge(env.url, a, ra.challengeId, ra.code!)).proof;
    const rb = await requestCode(env, b, 'register', 'race@example.com');
    const pb = (await verifyEmailChallenge(env.url, b, rb.challengeId, rb.code!)).proof;
    expect(await new Client(env.url).auth(a, 'alpha', pa)).toMatchObject({ type: 'ready' });
    expect(await new Client(env.url).auth(b, 'bravo', pb)).toMatchObject({ type: 'error', code: 'email-taken' });
  });
  it('refuses a key that already owns a profile', async () => {
    const env = await start();
    const { identity } = await register(env, 'owner', 'owner@example.com');
    expect(await refusal(startEmailChallenge(env.url, identity, { purpose: 'register', email: 'x@example.com', locale: 'en' }))).toBe('device-already-registered');
    expect(await refusal(startEmailChallenge(env.url, identity, { purpose: 'recover', email: 'x@example.com', locale: 'en' }))).toBe('device-already-registered');
  });
});

describe('binding', () => {
  it('binds an existing profile, replaces the address and recovers by the new one only', async () => {
    const env = await start();
    const client = new Client(env.url); const key = newKey();
    expect(await client.auth(key, 'legacy')).toMatchObject({ type: 'ready' });
    const first = await requestCode(env, key, 'bind', 'old@example.com');
    expect(await verifyEmailChallenge(env.url, key, first.challengeId, first.code!)).toEqual({});
    const second = await requestCode(env, key, 'bind', 'new@example.com');
    await verifyEmailChallenge(env.url, key, second.challengeId, second.code!);
    expect((await requestCode(env, newKey(), 'recover', 'old@example.com')).code).toBeUndefined();
    expect((await recover(env, 'new@example.com')).user.username).toBe('legacy');
  });
  it('needs a profile and sends a code for your own address', async () => {
    const env = await start();
    expect(await refusal(startEmailChallenge(env.url, newKey(), { purpose: 'bind', email: 'a@example.com', locale: 'en' }))).toBe('profile-required');
    const a = await register(env, 'alpha', 'alpha@example.com');
    const own = await requestCode(env, a.identity, 'bind', 'alpha@example.com');
    expect(await verifyEmailChallenge(env.url, a.identity, own.challengeId, own.code!)).toEqual({});
  });
  it('returns email-taken from verify when another account holds the address', async () => {
    const env = await start();
    const client = new Client(env.url); const key = newKey();
    expect(await client.auth(key, 'bravo')).toMatchObject({ type: 'ready' });
    const pending = await requestCode(env, key, 'bind', 'contested@example.com');
    await register(env, 'alpha', 'contested@example.com');
    // A concurrent start for the same address and purpose would replace it; register has its own slot.
    expect(await refusal(verifyEmailChallenge(env.url, key, pending.challengeId, pending.code!))).toBe('email-taken');
  });
});

describe('quotas', () => {
  it('limits an address to three requests an hour whether or not it has an account', async () => {
    const env = await start();
    await register(env, 'owner', 'owned@example.com'); // One request is already spent on this address.
    for (const email of ['owned@example.com', 'unowned@example.com']) {
      const allowed = email === 'owned@example.com' ? 2 : 3;
      for (let index = 0; index < allowed; index++) await startEmailChallenge(env.url, newKey(), { purpose: 'recover', email, locale: 'en' });
      expect(await refusal(startEmailChallenge(env.url, newKey(), { purpose: 'recover', email, locale: 'en' })), email).toBe('email-rate-limited');
    }
  });
  it('limits a key to five and a client to twenty', async () => {
    const env = await start();
    const key = newKey();
    for (let index = 0; index < 5; index++) await startEmailChallenge(env.url, key, { purpose: 'register', email: `k${index}@example.com`, locale: 'en' });
    expect(await refusal(startEmailChallenge(env.url, key, { purpose: 'register', email: 'k9@example.com', locale: 'en' }))).toBe('email-rate-limited');
    for (let index = 0; index < 15; index++) await startEmailChallenge(env.url, newKey(), { purpose: 'register', email: `i${index}@example.com`, locale: 'en' });
    expect(await refusal(startEmailChallenge(env.url, newKey(), { purpose: 'register', email: 'last@example.com', locale: 'en' }))).toBe('email-rate-limited');
  });
  it('requests the contract limits including the global one', () => {
    const db = new DatabaseSync(':memory:');
    db.exec('CREATE TABLE directory_users (user_id TEXT PRIMARY KEY)');
    const quotas: Array<{ scope: string; limit: number }> = [];
    const auth = new EmailAuth(db, { emailHashSecret: SECRET, emailSender: { send: async () => {} } }, (list) => { quotas.push(...list); });
    auth.start({ purpose: 'register', email: 'a@example.com', locale: 'en', publicKey: newKey().publicKey, userId: 'u', ip: '1.2.3.4' });
    expect(quotas.map(({ scope, limit }) => [scope, limit])).toEqual([['email-address', 3], ['email-key', 5], ['email-ip', 20], ['email-global', 200]]);
    db.close();
  });
  it('lets the global limit follow the mail provider allowance', () => {
    const db = new DatabaseSync(':memory:');
    db.exec('CREATE TABLE directory_users (user_id TEXT PRIMARY KEY)');
    const quotas: Array<{ scope: string; limit: number }> = [];
    const auth = new EmailAuth(db, { emailHashSecret: SECRET, emailGlobalPerHour: 40, emailSender: { send: async () => {} } }, (list) => { quotas.push(...list); });
    auth.start({ purpose: 'register', email: 'a@example.com', locale: 'en', publicKey: newKey().publicKey, userId: 'u', ip: '1.2.3.4' });
    expect(quotas.find(({ scope }) => scope === 'email-global')?.limit).toBe(40);
    db.close();
  });
});

describe('moving an account', () => {
  it('moves username and name to the new key and retires the old key', async () => {
    const env = await start();
    const old = await register(env, 'mover', 'mover@example.com');
    const { identity, user } = await recover(env, 'mover@example.com');
    expect(user).toMatchObject({ userId: identity.userId, publicKey: identity.publicKey, username: 'mover', displayName: 'mover' });
    expect(await old.client.next('error')).toMatchObject({ code: 'account-moved' });
    await until(() => old.client.closed, 'old connection close');
    expect(await new Client(env.url).auth(identity, 'mover')).toMatchObject({ type: 'ready', self: { userId: identity.userId, username: 'mover' } });
    expect(await resolveDeviceProfile(env.url, old.identity)).toBeNull();
    expect(await new Client(env.url).auth(old.identity, 'mover')).toMatchObject({ type: 'error', code: 'account-moved' });
    expect(await new Client(env.url).auth(old.identity, 'another')).toMatchObject({ type: 'error', code: 'account-moved' });
    expect(await refusal(startEmailChallenge(env.url, old.identity, { purpose: 'register', email: 'z@example.com', locale: 'en' }))).toBe('account-moved');
  });
  it('sends a recovery notice in the chosen language', async () => {
    const env = await start();
    await register(env, 'mover', 'mover@example.com');
    const key = newKey();
    const { challengeId, code } = await requestCode(env, key, 'recover', 'mover@example.com', 'ru');
    const before = env.letters.length;
    await verifyEmailChallenge(env.url, key, challengeId, code!);
    const notice = await until(() => env.letters[before], 'notice');
    expect(notice).toMatchObject({ to: 'mover@example.com', subject: 'LastCall: аккаунт восстановлен' });
    expect(codeOf(notice)).toBeUndefined();
  });
  it('leaves the account intact when the new key took a profile after the code was sent', async () => {
    const env = await start();
    const old = await register(env, 'mover', 'mover@example.com');
    const key = newKey();
    const { challengeId, code } = await requestCode(env, key, 'recover', 'mover@example.com');
    expect(await new Client(env.url).auth(key, 'squatter')).toMatchObject({ type: 'ready' });
    expect(await refusal(verifyEmailChallenge(env.url, key, challengeId, code!))).toBe('device-already-registered');
    expect(await resolveDeviceProfile(env.url, old.identity)).toMatchObject({ username: 'mover' });
    expect(old.client.closed).toBe(false);
  });
  it('rolls back completely when any step of the move fails', async () => {
    const { path } = fileDb();
    const env = await start({ directoryDbPath: path });
    const old = await register(env, 'mover', 'mover@example.com');
    const db = new DatabaseSync(path);
    db.exec("CREATE TRIGGER fail_move BEFORE INSERT ON moved_identities BEGIN SELECT RAISE(ABORT, 'boom'); END;");
    db.close();
    const key = newKey();
    const { challengeId, code } = await requestCode(env, key, 'recover', 'mover@example.com');
    expect(await refusal(verifyEmailChallenge(env.url, key, challengeId, code!))).toBe('directory-error');
    expect(await resolveDeviceProfile(env.url, old.identity)).toMatchObject({ username: 'mover' });
    expect(await resolveDeviceProfile(env.url, key)).toBeNull();
    expect(old.client.closed).toBe(false);
    const check = new DatabaseSync(path);
    check.exec('DROP TRIGGER fail_move');
    expect(check.prepare('SELECT user_id FROM email_bindings').all()).toEqual([{ user_id: old.identity.userId }]);
    check.close();
    expect((await recover(env, 'mover@example.com')).user.username).toBe('mover');
  });
  it('repoints earlier retired keys on a repeat move', async () => {
    const env = await start();
    const first = await register(env, 'mover', 'mover@example.com');
    const second = await recover(env, 'mover@example.com');
    const third = await recover(env, 'mover@example.com');
    expect(third.user.userId).not.toBe(second.user.userId);
    for (const retired of [first.identity, second.identity]) expect(await new Client(env.url).auth(retired, 'mover')).toMatchObject({ type: 'error', code: 'account-moved' });
    const watcher = await register(env, 'watcher', 'watcher@example.com');
    watcher.client.send({ type: 'watch', userIds: [first.identity.userId, second.identity.userId], identityMovedV1: true });
    await until(() => watcher.client.frames.filter((frame) => frame.type === 'identity-moved').length === 2, 'both forwards');
    for (const frame of watcher.client.frames) if (frame.type === 'identity-moved') expect(frame.user.userId).toBe(third.identity.userId);
  });
});

describe('identity-moved reaches only clients that opted in', () => {
  it('stays silent for released clients and informs capable ones live and on watch', async () => {
    const env = await start();
    const mover = await register(env, 'mover', 'mover@example.com');
    const oldClient = await register(env, 'released', 'released@example.com');
    const capable = await register(env, 'capable', 'capable@example.com');
    oldClient.client.send({ type: 'watch', userIds: [mover.identity.userId] }); await oldClient.client.next('presence');
    capable.client.send({ type: 'watch', userIds: [mover.identity.userId], identityMovedV1: true }); await capable.client.next('presence');
    const { user } = await recover(env, 'mover@example.com');
    expect(await capable.client.next('identity-moved')).toMatchObject({ oldUserId: mover.identity.userId, user: { userId: user.userId, username: 'mover' } });
    oldClient.client.send({ type: 'watch', userIds: [mover.identity.userId, '0'.repeat(64)] });
    oldClient.client.send({ type: 'search', query: 'mover', requestId: 'ab'.repeat(16) });
    await oldClient.client.next('results');
    expect(oldClient.client.frames.some((frame) => frame.type === 'identity-moved')).toBe(false);
    expect(oldClient.client.closed).toBe(false);
    const late = await register(env, 'late', 'late@example.com');
    late.client.send({ type: 'watch', userIds: [mover.identity.userId, '0'.repeat(64)], identityMovedV1: true });
    expect(await late.client.next('identity-moved')).toMatchObject({ oldUserId: mover.identity.userId });
    expect(late.client.closed).toBe(false);
  });
});

describe('MessengerClient', () => {
  const manager = (url: string, identity: DeviceIdentity, username: string, emailProof?: string) => {
    const client = new MessengerClient({ serverUrl: url, identity, username, displayName: username, ...(emailProof ? { emailProof } : {}) });
    managers.push(client); return client;
  };
  async function scenario() {
    const env = await start();
    const key = newKey();
    const { challengeId, code } = await requestCode(env, key, 'register', 'alice@example.com');
    const { proof } = await verifyEmailChallenge(env.url, key, challengeId, code!);
    const alice = manager(env.url, key, 'alice', proof);
    await alice.connect();
    const bob = await register(env, 'bob', 'bob@example.com');
    bob.client.ws.terminate();
    const bobUser = await resolveDeviceProfile(env.url, bob.identity);
    return { env, key, alice, bob, bobUser: { ...bobUser!, online: false } };
  }
  it('shows a prompt and opens a separate unverified chat, leaving the old one in place', async () => {
    const { env, alice, bob, bobUser } = await scenario();
    const oldChat = await alice.addContact(bobUser);
    await alice.markContactVerified(bob.identity.userId);
    const { identity, user } = await recover(env, 'bob@example.com');
    const seen = await until(() => alice.getSnapshot().movedContacts?.[bob.identity.userId], 'moved prompt');
    expect(seen.userId).toBe(user.userId);
    const newChat = await alice.acceptMovedContact(bob.identity.userId);
    expect(newChat).not.toBe(oldChat);
    const snapshot = alice.getSnapshot();
    expect(snapshot.conversations.map((c) => c.id)).toEqual(expect.arrayContaining([oldChat, newChat]));
    expect(snapshot.verifiedContacts).toContain(bob.identity.userId);
    expect(snapshot.verifiedContacts).not.toContain(identity.userId);
    await expect(alice.acceptMovedContact('ab'.repeat(32))).rejects.toThrow(/Unknown moved contact/);
  });
  it('blocks the new key instead of prompting when the old contact is blocked', async () => {
    const { env, alice, bob, bobUser } = await scenario();
    await alice.addContact(bobUser);
    await alice.blockContact(bob.identity.userId);
    const { identity } = await recover(env, 'bob@example.com');
    await until(() => alice.getSnapshot().blockedContacts.includes(identity.userId), 'propagated block');
    expect(alice.getSnapshot().movedContacts).toEqual({});
  });
  it('blocks the new key when the old contact is blocked after the prompt appeared', async () => {
    const { env, alice, bob, bobUser } = await scenario();
    await alice.addContact(bobUser);
    const { identity } = await recover(env, 'bob@example.com');
    await until(() => alice.getSnapshot().movedContacts?.[bob.identity.userId], 'moved prompt');
    await alice.blockContact(bob.identity.userId);
    expect(alice.getSnapshot().blockedContacts).toContain(identity.userId);
    expect(alice.getSnapshot().movedContacts).toEqual({});
  });
  it('stops reconnecting a retired key with a terminal account-moved error', async () => {
    const { env, key, alice } = await scenario();
    await recover(env, 'alice@example.com');
    await until(() => alice.getSnapshot().status === 'error', 'terminal state');
    expect(alice.getSnapshot().error).toMatch(/^account-moved:/);
    const retired = manager(env.url, key, 'alice');
    await expect(retired.connect()).rejects.toThrow(/^account-moved:/);
    expect(retired.getSnapshot().status).toBe('error');
  });
});

describe('deletion', () => {
  it('removes the binding and forwarding and frees the address', async () => {
    let now = 1_000_000_000_000;
    const env = await start({ serviceNow: () => now });
    const first = await register(env, 'gone', 'gone@example.com');
    const moved = await recover(env, 'gone@example.com');
    const live = new Client(env.url);
    expect(await live.auth(moved.identity, 'gone')).toMatchObject({ type: 'ready' });
    live.send({ type: 'delete-account', requestId: 'ab'.repeat(16) });
    await live.next('account-deleted');
    expect((await requestCode(env, newKey(), 'recover', 'gone@example.com')).code).toBeUndefined();
    const watcher = await register(env, 'watcher', 'watcher@example.com');
    watcher.client.send({ type: 'watch', userIds: [first.identity.userId], identityMovedV1: true });
    watcher.client.send({ type: 'search', query: 'gone', requestId: 'cd'.repeat(16) });
    const results = await watcher.client.next('results');
    expect(results.type === 'results' && results.users).toEqual([]);
    expect(watcher.client.frames.some((frame) => frame.type === 'identity-moved')).toBe(false);
    now += 3_600_000; // The address spent its hourly quota above.
    await register(env, 'gone', 'gone@example.com');
  });
});

describe('privacy', () => {
  it('keeps no plaintext address or code in the database and none in logs', async () => {
    const { dir, path } = fileDb();
    const logged: unknown[][] = [];
    for (const method of ['log', 'info', 'warn', 'error'] as const) vi.spyOn(console, method).mockImplementation((...args: unknown[]) => { logged.push(args); });
    const env = await start({ directoryDbPath: path });
    const email = 'very.private.address@example.com';
    const key = newKey();
    const first = await requestCode(env, key, 'register', email);
    const { proof } = await verifyEmailChallenge(env.url, key, first.challengeId, first.code!);
    expect(await new Client(env.url).auth(key, 'privateuser', proof)).toMatchObject({ type: 'ready' });
    await recover(env, email);
    await servers.pop()!.close();
    for (const name of readdirSync(dir)) {
      const bytes = readFileSync(join(dir, name)).toString('latin1');
      expect(bytes, name).not.toContain(email);
      expect(bytes, name).not.toContain(proof!);
    }
    const db = new DatabaseSync(path);
    const rows = db.prepare('SELECT * FROM email_bindings').all() as Array<{ email_hash: string }>;
    expect(rows).toHaveLength(1); expect(rows[0]!.email_hash).toMatch(/^[0-9a-f]{64}$/);
    db.close();
    const text = JSON.stringify(logged);
    expect(text).not.toContain(email);
    expect(text).not.toContain(first.code!);
    expect(text).not.toContain(proof!);
  });
  it('logs a generic line when delivery fails and still answers', async () => {
    const logged: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => { logged.push(args.join(' ')); });
    const env = await start({ emailSender: { send: async () => { throw new Error('secret smtp reply for a@example.com'); } } });
    await expect(startEmailChallenge(env.url, newKey(), { purpose: 'register', email: 'a@example.com', locale: 'en' })).resolves.toBeTruthy();
    await until(() => logged.length > 0, 'log line');
    expect(logged).toEqual(['Email delivery failed']);
  });
});

describe('environment', () => {
  const full = { SMTP_HOST: 'smtp.example.com', SMTP_USER: 'u', SMTP_PASS: 'p', SMTP_FROM: 'LastCall <noreply@example.com>', EMAIL_HASH_SECRET: SECRET };
  it('turns email on only with every value set', () => {
    expect(optionsFromEnv({}).emailSender).toBeUndefined();
    expect(optionsFromEnv({}).emailRequired).toBe(false);
    const options = optionsFromEnv({ ...full, EMAIL_REQUIRED: '1' });
    expect(options.emailSender).toBeDefined(); expect(options.emailRequired).toBe(true);
    void options.emailSender?.dispose?.();
  });
  it('fails at startup on partial, weak or unusable configuration', () => {
    for (const name of Object.keys(full) as Array<keyof typeof full>) { const partial: Record<string, string> = { ...full }; delete partial[name]; expect(() => optionsFromEnv(partial), name).toThrow(/configured together/); }
    expect(() => optionsFromEnv({ ...full, EMAIL_HASH_SECRET: 'short' })).toThrow(/32 bytes/);
    expect(() => optionsFromEnv({ EMAIL_REQUIRED: '1' })).toThrow(/needs SMTP/);
    expect(() => optionsFromEnv({ ...full, SMTP_PORT: '70000' })).toThrow(/SMTP_PORT/);
    expect(() => createSignalingServer({ port: 0, emailSender: { send: async () => {} }, emailHashSecret: 'short' })).toThrow(/32 bytes/);
  });
  it('has no environment switch for the test sender', () => {
    expect(optionsFromEnv({ EMAIL_SENDER: 'mock', EMAIL_MOCK: '1', NODE_ENV: 'test' }).emailSender).toBeUndefined();
  });
});
