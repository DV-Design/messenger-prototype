import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDeviceIdentity, directoryClientFrameSchema, fetchRegistrationPolicy, fetchRegistrationPolicyInfo, InviteRequestError, type DirectoryClientFrame } from './directory.js';
import { MessengerClient } from './messenger.js';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const base = 'https://example.test/messenger';
const identity = createDeviceIdentity(size => new Uint8Array(size).fill(31));
const inviteCode = 'ab'.repeat(32);

describe('registration policy discovery', () => {
  it('distinguishes a real open policy from a missing legacy route', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response('{"mode":"open"}'))
      .mockResolvedValueOnce(new Response('', { status: 404 }));
    vi.stubGlobal('fetch', fetch);
    await expect(fetchRegistrationPolicyInfo(base)).resolves.toEqual({ mode: 'open', supportsInvites: true });
    await expect(fetchRegistrationPolicyInfo(base)).resolves.toEqual({ mode: 'open', supportsInvites: false });
    expect(fetch).toHaveBeenCalledWith(`${base}/registration-policy?v=2`, expect.objectContaining({ redirect: 'error' }));
    expect(fetch.mock.calls[0]?.[1]).not.toHaveProperty('cache');
  });

  it('accepts a response whose URL only gained a query (React Native cache busting)', async () => {
    const fetch = vi.fn().mockResolvedValueOnce({ url: `${base}/registration-policy?_=1763456789000`, redirected: false, ok: true, status: 200, text: async () => '{"mode":"invite","countryHints":true}' });
    vi.stubGlobal('fetch', fetch);
    await expect(fetchRegistrationPolicyInfo(base, ['RS'])).resolves.toEqual({ mode: 'invite', countryHints: true, supportsInvites: true });
  });

  it('rejects other HTTP errors, unknown policy values and cross-origin responses', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValueOnce(new Response('{"mode":"unexpected"}'))
      .mockResolvedValueOnce({ url: 'https://other.test/registration-policy', redirected: true, status: 404 });
    vi.stubGlobal('fetch', fetch);
    await expect(fetchRegistrationPolicy(base)).rejects.toThrow(/request failed/);
    await expect(fetchRegistrationPolicy(base)).rejects.toThrow(/Invalid registration policy/);
    await expect(fetchRegistrationPolicy(base)).rejects.toThrow(/redirected/);
  });

  it('aborts a stalled request', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', (_url: string, { signal }: RequestInit) => new Promise((_resolve, reject) => {
      signal?.addEventListener('abort', () => reject(new Error('aborted')));
    }));
    const result = expect(fetchRegistrationPolicy(base)).rejects.toThrow('aborted');
    await vi.advanceTimersByTimeAsync(10_000);
    await result;
    expect(vi.getTimerCount()).toBe(0);
  });
});

function fixture(failure?: string) {
  const sent: DirectoryClientFrame[] = [];
  const sockets: Socket[] = [];
  let request = 0;
  class Socket {
    readyState = 1;
    onmessage: ((event: { data: string }) => void) | null = null;
    onclose: (() => void) | null = null;
    constructor() {
      sockets.push(this);
      queueMicrotask(() => this.push({ type: 'challenge', challenge: 'cd'.repeat(32) }));
    }
    send(raw: string) {
      const frame = directoryClientFrameSchema.parse(JSON.parse(raw));
      sent.push(frame);
      if (frame.type !== 'authenticate') return;
      queueMicrotask(() => this.push(failure ? { type: 'error', code: failure, message: 'Registration refused' } : {
        type: 'ready', self: { userId: identity.userId, publicKey: identity.publicKey, username: 'alice', displayName: 'Alice', online: true, lastSeen: 1 },
      }));
    }
    push(frame: unknown) { this.onmessage?.({ data: JSON.stringify(frame) }); }
    close() {
      this.readyState = 3;
      queueMicrotask(() => this.onclose?.());
    }
  }
  vi.stubGlobal('WebSocket', Socket);
  const client = new MessengerClient({
    serverUrl: base, identity, username: 'alice', displayName: 'Alice', inviteCode,
    randomBytes: size => new Uint8Array(size).fill(++request),
  });
  return { client, sent, sockets };
}

describe('directory client invitations', () => {
  it('discards the successful registration credential before reconnecting', async () => {
    const { client, sent, sockets } = fixture();
    try {
      await client.connect();
      sockets[0]!.close();
      await Promise.resolve();
      await client.connect();
      const auth = sent.filter(frame => frame.type === 'authenticate');
      expect(auth).toHaveLength(2);
      expect(auth[0]!.inviteCode).toBe(inviteCode);
      expect(auth[1]).not.toHaveProperty('inviteCode');
    } finally { client.disconnect(); }
  });

  it.each(['invite-invalid', 'registration-closed', 'invite-required'])('treats %s as a terminal registration refusal', async code => {
    const { client, sockets } = fixture(code);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      await expect(client.connect()).rejects.toThrow(code);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(sockets).toHaveLength(1);
      expect(client.getSnapshot()).toMatchObject({ status: 'error' });
    } finally { client.disconnect(); }
  });

  it('correlates simultaneous status and creation replies and exposes a permission refusal', async () => {
    const { client, sent, sockets } = fixture();
    try {
      await client.connect();
      const status = client.getInviteStatus();
      const statusRequest = sent.at(-1)!;
      const created = client.createInvite();
      const createRequest = sent.at(-1)!;
      if (statusRequest.type !== 'invite-status' || createRequest.type !== 'invite-create') throw new Error('missing invitation requests');
      const id = 'ef'.repeat(16);
      sockets[0]!.push({ type: 'invite-created', requestId: createRequest.requestId, id, code: inviteCode, expiresAt: 2 });
      sockets[0]!.push({ type: 'invite-status', requestId: statusRequest.requestId, isAdmin: false, canInvite: true, remaining: 4, resetAt: 3, active: [{ id, expiresAt: 2 }], granted: [] });
      await expect(created).resolves.toEqual({ id, code: inviteCode, expiresAt: 2 });
      await expect(status).resolves.toEqual({ isAdmin: false, canInvite: true, remaining: 4, resetAt: 3, active: [{ id, expiresAt: 2 }], granted: [] });

      const grant = client.grantInvites('bob', true);
      const grantRequest = sent.at(-1)!;
      if (grantRequest.type !== 'invite-grant') throw new Error('missing grant request');
      sockets[0]!.push({ type: 'error', requestId: grantRequest.requestId, code: 'invite-not-allowed', message: 'Permission denied' });
      const error: unknown = await grant.catch(cause => cause);
      expect(error).toBeInstanceOf(InviteRequestError);
      expect(error).toMatchObject({ code: 'invite-not-allowed', message: 'Permission denied' });
    } finally { client.disconnect(); }
  });
});
