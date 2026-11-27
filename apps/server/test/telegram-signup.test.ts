import { afterEach, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { createDeviceIdentity, directoryServerFrameSchema, openMailboxItem, signAuthentication, signRequest, signedRequestFields, type DeviceIdentity, type DirectoryServerFrame } from '@messenger/core';
import { createSignalingServer, type ServerOptions } from '../src/server.js';
import { TelegramBot } from '../src/telegram-bot.js';
import type { RuUserRecord } from '../src/ru-store-client.js';

const servers: ReturnType<typeof createSignalingServer>[] = [];
const sockets: WebSocket[] = [];
let nextRequest = 0;
afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.terminate();
  await Promise.all(servers.splice(0).map(server => server.close()));
});

const SECRET = 'p'.repeat(40);
const ADMIN = createDeviceIdentity();
/** A bot stand-in: the test plays Telegram by calling the server's handlers directly. */
const bot = { linkFor: (token: string) => `https://t.me/LastCallTestBot?start=${token}` };

async function start(options: ServerOptions = {}) {
  const server = createSignalingServer({ port: 0, maxConnectionsPerIp: 64, requestLimit: 400, registrationMode: 'invite', emailRequired: false, phoneHashSecret: SECRET, telegramBot: bot, systemAccountKey: 'a1'.repeat(32), registrationAdminUserIds: [ADMIN.userId], ...options });
  servers.push(server);
  return { server, ...(await server.listen()) };
}

class Client {
  readonly socket: WebSocket;
  private readonly frames: DirectoryServerFrame[] = [];
  constructor(url: string) {
    this.socket = new WebSocket(url.replace(/^http/, 'ws') + '/directory');
    sockets.push(this.socket);
    this.socket.on('message', raw => this.frames.push(directoryServerFrameSchema.parse(JSON.parse(raw.toString()))));
  }
  async next(predicate: (frame: DirectoryServerFrame) => boolean) {
    const deadline = Date.now() + 2000;
    do {
      const index = this.frames.findIndex(predicate);
      if (index >= 0) return this.frames.splice(index, 1)[0]!;
      await new Promise(resolve => setTimeout(resolve, 4));
    } while (Date.now() < deadline);
    throw new Error('Missing directory response');
  }
  send(frame: object) { this.socket.send(JSON.stringify(frame)); }
  async challenge() {
    const frame = await this.next(candidate => candidate.type === 'challenge');
    if (frame.type !== 'challenge') throw new Error('Missing challenge');
    return frame.challenge;
  }
  async auth(identity: DeviceIdentity, username: string, extra: object = {}) {
    const challenge = await this.challenge();
    this.send({ type: 'authenticate', publicKey: identity.publicKey, username, displayName: username, signature: signAuthentication(identity, challenge, username, username), ...extra });
    return this.next(frame => frame.type === 'ready' || frame.type === 'error');
  }
  async signed(identity: DeviceIdentity, frame: { type: 'telegram-start' | 'telegram-check' | 'access-request' | 'access-check'; [key: string]: unknown }) {
    const challenge = await this.challenge();
    this.send({ ...frame, publicKey: identity.publicKey, signature: signRequest(identity, challenge, frame.type, signedRequestFields(frame as never)) });
    return this.next(reply => reply.type !== 'challenge');
  }
  request(type: string, data: object = {}) {
    const requestId = (++nextRequest).toString(16).padStart(32, '0');
    this.send({ ...data, type, requestId });
    return this.next(frame => 'requestId' in frame && frame.requestId === requestId);
  }
}
async function signed(url: string, identity: DeviceIdentity, frame: { type: 'telegram-start' | 'telegram-check' | 'access-request' | 'access-check'; [key: string]: unknown }) {
  return new Client(url).signed(identity, frame);
}
type Server = Awaited<ReturnType<typeof start>>;
let chat = 1000;
/** The whole bot round: link, /start, the person's own contact, then the app's check. */
async function confirmNumber(env: Server, identity: DeviceIdentity, purpose: 'register' | 'recover' | 'bind', phone: string) {
  const started = await signed(env.url, identity, { type: 'telegram-start', purpose });
  if (started.type !== 'telegram-started') throw new Error(`telegram-start: ${JSON.stringify(started)}`);
  const token = new URL(started.url).searchParams.get('start')!;
  const phoneAuth = directoryOf(env);
  const chatId = ++chat;
  expect(phoneAuth.onStart(token, chatId)).toBe(true);
  expect(await signed(env.url, identity, { type: 'telegram-check', sessionId: started.sessionId })).toMatchObject({ type: 'telegram-status', state: 'pending' });
  expect(phoneAuth.onContact(chatId, { phone: phone.replace('+', ''), ownerId: chatId, fromId: chatId })).toBe('ok');
  return signed(env.url, identity, { type: 'telegram-check', sessionId: started.sessionId });
}
// The directory is internal to the server; tests reach its phone handlers the way the bot does.
const directories = new WeakMap<object, { onStart(token: string, chatId: number): boolean; onContact(chatId: number, contact: { phone: string; ownerId: number | undefined; fromId: number }): string }>();
function directoryOf(env: Server) {
  const found = directories.get(env.server);
  if (!found) throw new Error('No directory handle');
  return found;
}
async function boot(options: ServerOptions = {}) {
  let handlers: { onStart(token: string, chatId: number): boolean; onContact(chatId: number, contact: { phone: string; ownerId: number | undefined; fromId: number }): string } | undefined;
  const env = await start({ ...options, telegramBot: { linkFor: bot.linkFor }, telegramHandlersForTests: value => { handlers = value; } });
  directories.set(env.server, { onStart: (token, chatId) => handlers!.onStart(token, chatId), onContact: (chatId, contact) => handlers!.onContact(chatId, contact) });
  return env;
}

it('signs up through Telegram without an invitation or email, and the number cannot be used twice', async () => {
  const env = await boot();
  const alice = createDeviceIdentity();
  const verified = await confirmNumber(env, alice, 'register', '+381641234567');
  expect(verified).toMatchObject({ type: 'telegram-status', state: 'verified', phone: '+381 ••• ••• 67' });
  if (verified.type !== 'telegram-status' || !verified.proof) throw new Error('No proof');
  // Invite mode, yet the confirmed number is enough.
  expect(await new Client(env.url).auth(alice, 'alice_tg', { phoneProof: verified.proof })).toMatchObject({ type: 'ready' });
  const other = createDeviceIdentity();
  expect(await confirmNumber(env, other, 'register', '+381641234567')).toMatchObject({ type: 'error', code: 'phone-taken' });
  // Without a proof the invitation is still required.
  expect(await new Client(env.url).auth(createDeviceIdentity(), 'nobody_tg')).toMatchObject({ type: 'error', code: 'invite-required' });
});

it('accepts only the sender\'s own number and refuses anonymous +888 numbers', async () => {
  const env = await boot();
  const started = await signed(env.url, createDeviceIdentity(), { type: 'telegram-start', purpose: 'register' });
  if (started.type !== 'telegram-started') throw new Error('no session');
  const token = new URL(started.url).searchParams.get('start')!;
  const handlers = directoryOf(env);
  expect(handlers.onStart(token, 77)).toBe(true);
  expect(handlers.onContact(77, { phone: '79161234567', ownerId: 12, fromId: 77 })).toBe('not-own');
  expect(handlers.onContact(77, { phone: '79161234567', ownerId: undefined, fromId: 77 })).toBe('not-own');
  expect(handlers.onContact(77, { phone: '88801234567', ownerId: 77, fromId: 77 })).toBe('anonymous');
  expect(handlers.onContact(78, { phone: '79161234567', ownerId: 78, fromId: 78 })).toBe('no-session');
  expect(handlers.onStart('x'.repeat(32), 79)).toBe(false);
});

it('restores an account by number onto a new device key, keeping its username', async () => {
  const env = await boot();
  const old = createDeviceIdentity();
  const first = await confirmNumber(env, old, 'register', '+381651112233');
  if (first.type !== 'telegram-status' || !first.proof) throw new Error('No proof');
  expect(await new Client(env.url).auth(old, 'restore_me', { phoneProof: first.proof })).toMatchObject({ type: 'ready' });
  const fresh = createDeviceIdentity();
  const restored = await confirmNumber(env, fresh, 'recover', '+381651112233');
  expect(restored).toMatchObject({ type: 'telegram-status', state: 'verified', user: { userId: fresh.userId, username: 'restore_me' } });
  expect(await new Client(env.url).auth(fresh, 'restore_me')).toMatchObject({ type: 'ready' });
  expect(await new Client(env.url).auth(old, 'restore_me')).toMatchObject({ type: 'error', code: 'account-moved' });
  expect(await confirmNumber(env, createDeviceIdentity(), 'recover', '+381659998877')).toMatchObject({ type: 'error', code: 'phone-no-account' });
});

it('writes a Russian user to the Russian store first and refuses the sign-up when it is down', async () => {
  const records: RuUserRecord[] = [];
  let up = false;
  const env = await boot({ ruStore: { putUser: async record => { if (!up) throw new Error('down'); records.push(record); }, deleteUser: async () => undefined } });
  const ivan = createDeviceIdentity();
  const verified = await confirmNumber(env, ivan, 'register', '+79161234567');
  if (verified.type !== 'telegram-status' || !verified.proof) throw new Error('No proof');
  expect(await new Client(env.url).auth(ivan, 'ivan_ru', { phoneProof: verified.proof })).toMatchObject({ type: 'error', code: 'region-unavailable' });
  up = true;
  expect(await new Client(env.url).auth(ivan, 'ivan_ru', { phoneProof: verified.proof })).toMatchObject({ type: 'ready' });
  expect(records).toEqual([expect.objectContaining({ userId: ivan.userId, username: 'ivan_ru', phone: '+79161234567' })]);
  // A Serbian number never reaches the Russian store.
  const ana = createDeviceIdentity();
  const serbian = await confirmNumber(env, ana, 'register', '+381601234567');
  if (serbian.type !== 'telegram-status' || !serbian.proof) throw new Error('No proof');
  expect(await new Client(env.url).auth(ana, 'ana_rs', { phoneProof: serbian.proof })).toMatchObject({ type: 'ready' });
  expect(records).toHaveLength(1);
});

it('finds people by number according to their visibility setting', async () => {
  const env = await boot();
  const people = [['finder', '+381611111111'], ['open_one', '+381622222222'], ['hidden_one', '+381633333333']] as const;
  const clients: Record<string, { client: Client; identity: DeviceIdentity }> = {};
  for (const [name, phone] of people) {
    const identity = createDeviceIdentity();
    const verified = await confirmNumber(env, identity, 'register', phone);
    if (verified.type !== 'telegram-status' || !verified.proof) throw new Error('No proof');
    const client = new Client(env.url);
    expect(await client.auth(identity, name, { phoneProof: verified.proof })).toMatchObject({ type: 'ready' });
    clients[name] = { client, identity };
  }
  expect(await clients.hidden_one!.client.request('phone-visibility', { visibility: 'nobody' })).toMatchObject({ type: 'phone-state', visibility: 'nobody', phone: '+381 ••• ••• 33' });
  const found = await clients.finder!.client.request('phone-find', { phones: ['+381622222222', '+381633333333', '+381644444444'] });
  expect(found).toMatchObject({ type: 'phone-found', matches: [{ phone: '+381622222222', user: { username: 'open_one' } }] });
  if (found.type === 'phone-found') expect(found.matches).toHaveLength(1);
});

it('sends an access request to the administrator, whose approval hands the code to the waiting app', async () => {
  const env = await boot();
  const admin = new Client(env.url);
  expect(await admin.auth(ADMIN, 'administrator', { inviteCode: undefined })).toMatchObject({ type: 'error', code: 'invite-required' });
  // The administrator registers through Telegram too, then opens the mailbox.
  const adminNumber = await confirmNumber(env, ADMIN, 'register', '+381600000001');
  if (adminNumber.type !== 'telegram-status' || !adminNumber.proof) throw new Error('No proof');
  const adminClient = new Client(env.url);
  expect(await adminClient.auth(ADMIN, 'administrator', { phoneProof: adminNumber.proof })).toMatchObject({ type: 'ready' });
  expect(await adminClient.request('services', { mailboxV1: true })).toMatchObject({ type: 'services' });

  const guest = createDeviceIdentity();
  expect(await signed(env.url, guest, { type: 'access-check' })).toMatchObject({ type: 'access-status', state: 'none' });
  expect(await signed(env.url, guest, { type: 'access-request', name: 'Guest', contact: 'guest@example.com', message: 'No Telegram here' })).toMatchObject({ type: 'access-requested' });
  expect(await signed(env.url, guest, { type: 'access-request', name: 'Guest', message: 'Again' })).toMatchObject({ type: 'error', code: 'access-pending' });
  expect(await signed(env.url, guest, { type: 'access-check' })).toMatchObject({ type: 'access-status', state: 'pending' });

  // The direct message from @lastcall opens with the pair key, like any other.
  const mail = await adminClient.request('mailbox-fetch');
  if (mail.type !== 'mailbox') throw new Error('No mailbox');
  const sender = mail.users.find(user => user.username === 'lastcall')!;
  const opened = openMailboxItem(ADMIN, sender.publicKey, mail.items[0]!);
  expect(opened).toMatchObject({ type: 'message' });
  if (opened.type === 'message') expect(opened.text).toContain('No Telegram here');

  const list = await adminClient.request('access-list');
  if (list.type !== 'access-requests') throw new Error('No list');
  expect(list.requests).toEqual([expect.objectContaining({ name: 'Guest', contact: 'guest@example.com', message: 'No Telegram here' })]);
  expect(await adminClient.request('access-decide', { id: list.requests[0]!.id, approve: true })).toMatchObject({ type: 'access-decided' });
  const approved = await signed(env.url, guest, { type: 'access-check' });
  if (approved.type !== 'access-status' || !approved.inviteCode) throw new Error('No code');
  expect(await new Client(env.url).auth(guest, 'guest_user', { inviteCode: approved.inviteCode })).toMatchObject({ type: 'ready' });
  // Only administrators may list.
  const guestClient = new Client(env.url);
  expect(await guestClient.auth(guest, 'guest_user')).toMatchObject({ type: 'ready' });
  expect(await guestClient.request('access-list')).toMatchObject({ type: 'error', code: 'invite-not-allowed' });
});

it('tells only 1.0.49 apps about Telegram sign-in and access requests', async () => {
  const env = await boot();
  expect(await (await fetch(`${env.url}/registration-policy`)).json()).toEqual({ mode: 'invite', countryHints: true });
  expect(await (await fetch(`${env.url}/registration-policy?v=2`)).json()).toEqual({ mode: 'invite', countryHints: true, telegram: true, accessRequests: true });
});

it('the bot answers /start with the number button and confirms only the own contact', async () => {
  const calls: Array<{ method: string; body: Record<string, unknown> }> = [];
  const replies: Record<string, unknown> = { getMe: { username: 'LastCallTestBot' }, sendMessage: {}, getUpdates: [] };
  const fakeFetch = async (url: string, init?: { body?: string }) => {
    const method = url.split('/').pop()!;
    calls.push({ method, body: JSON.parse(init?.body ?? '{}') });
    if (method === 'getUpdates') await new Promise(resolve => setTimeout(resolve, 20));
    return { ok: true, status: 200, json: async () => ({ ok: true, result: replies[method] }) };
  };
  const seen: string[] = [];
  const real = new TelegramBot('123456:' + 'A'.repeat(35), { start: token => { seen.push(token); return token === 'T'.repeat(20); }, contact: (_chat, contact) => contact.ownerId === contact.fromId ? 'ok' : 'not-own' }, fakeFetch);
  await real.start();
  expect(real.linkFor('abc')).toBe('https://t.me/LastCallTestBot?start=abc');
  await real.handle({ update_id: 1, message: { chat: { id: 5, type: 'private' }, from: { id: 5, language_code: 'ru' }, text: `/start ${'T'.repeat(20)}` } });
  const ask = calls.filter(call => call.method === 'sendMessage').at(-1)!.body;
  expect(ask).toMatchObject({ chat_id: 5, reply_markup: { keyboard: [[{ request_contact: true }]] } });
  await real.handle({ update_id: 2, message: { chat: { id: 5, type: 'private' }, from: { id: 5, language_code: 'ru' }, contact: { phone_number: '79161234567', user_id: 9 } } });
  expect(String(calls.filter(call => call.method === 'sendMessage').at(-1)!.body.text)).toContain('собственный номер');
  await real.handle({ update_id: 3, message: { chat: { id: 5, type: 'private' }, from: { id: 5 }, contact: { phone_number: '79161234567', user_id: 5 } } });
  expect(calls.filter(call => call.method === 'sendMessage').at(-1)!.body).toMatchObject({ text: 'Number confirmed. Go back to LastCall.', reply_markup: { remove_keyboard: true } });
  // Group chats are ignored.
  const before = calls.length;
  await real.handle({ update_id: 4, message: { chat: { id: -9, type: 'group' }, from: { id: 5 }, text: '/start x' } });
  expect(calls.length).toBe(before);
  await real.stop();
});
