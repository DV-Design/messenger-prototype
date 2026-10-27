import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { createSignalingServer, optionsFromEnv, type ServerOptions } from '../src/server.js';

const roomA = 'a'.repeat(64), roomB = 'b'.repeat(64);
const id = (n: number) => n.toString(16).padStart(32, '0');
const envelope = { version: 1, nonce: 'c'.repeat(48), ciphertext: 'd'.repeat(64) };
const servers: ReturnType<typeof createSignalingServer>[] = [];
const clients: WebSocket[] = [];
afterEach(async () => {
  for (const ws of clients.splice(0)) ws.terminate();
  await Promise.all(servers.splice(0).map((server) => server.close()));
});
async function start(options: ServerOptions = {}) {
  const server = createSignalingServer({ port: 0, ...options }); servers.push(server);
  return server.listen();
}
async function connect(url: string, origin?: string) {
  const ws = new WebSocket(url.replace('http', 'ws') + '/signal', origin ? { origin } : {});
  clients.push(ws);
  await new Promise<void>((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  return ws;
}
function message(ws: WebSocket): Promise<Record<string, any>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { ws.off('message', receive); reject(new Error('Message timeout')); }, 1500);
    function receive(data: Buffer) { clearTimeout(timer); resolve(JSON.parse(data.toString())); }
    ws.once('message', receive);
  });
}
async function join(ws: WebSocket, peer: number, roomId = roomA) {
  const response = message(ws);
  ws.send(JSON.stringify({ type: 'join', roomId, peerId: id(peer) }));
  return response;
}
async function closed(ws: WebSocket) {
  await new Promise<void>((resolve) => ws.once('close', () => resolve()));
}

describe('real websocket signaling', () => {
  it('exchanges sealed frames only between the two room occupants', async () => {
    const { url } = await start();
    const a = await connect(url), b = await connect(url), isolated = await connect(url);
    expect(await join(a, 1)).toMatchObject({ type: 'joined', role: 'initiator', peerPresent: false });
    const peerJoined = message(a);
    expect(await join(b, 2)).toMatchObject({ type: 'joined', role: 'responder', peerPresent: true });
    expect(await peerJoined).toEqual({ type: 'peer-joined', peerId: id(2) });
    await join(isolated, 3, roomB);
    let leaked = false; isolated.on('message', () => { leaked = true; });
    const signal = message(b);
    a.send(JSON.stringify({ type: 'signal', payload: envelope }));
    expect(await signal).toEqual({ type: 'signal', from: id(1), payload: envelope });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(leaked).toBe(false);
  });
  it('rejects a third occupant and permits joining after disconnect with complementary roles', async () => {
    const { url } = await start();
    const a = await connect(url), b = await connect(url), c = await connect(url);
    await join(a, 1); await join(b, 2);
    expect(await join(c, 3)).toMatchObject({ type: 'error', code: 'room-full' });
    const left = message(b); a.terminate();
    expect(await left).toEqual({ type: 'peer-left', peerId: id(1) });
    expect(await join(c, 3)).toMatchObject({ type: 'joined', role: 'initiator', peerPresent: true });
  });
  it('cleans empty rooms, supports leave/rejoin, and rejects duplicate peer IDs', async () => {
    const { url } = await start({ maxRooms: 1 });
    const a = await connect(url), b = await connect(url);
    await join(a, 1);
    expect(await join(b, 1)).toMatchObject({ code: 'duplicate-peer' });
    a.send(JSON.stringify({ type: 'leave' }));
    // Ordered messages on the same socket guarantee leave precedes join.
    expect(await join(a, 1, roomB)).toMatchObject({ type: 'joined', role: 'initiator' });
  });
  it('bounds room and socket capacity', async () => {
    const { url } = await start({ maxRooms: 1, maxConnections: 2 });
    const a = await connect(url), b = await connect(url);
    await join(a, 1);
    expect(await join(b, 2, roomB)).toMatchObject({ code: 'server-full' });
    await expect(connect(url)).rejects.toThrow('503');
  });
  it('rejects malformed and binary frames and blocks signaling before join', async () => {
    const { url } = await start(); const a = await connect(url);
    let response = message(a); a.send(JSON.stringify({ type: 'signal', payload: envelope }));
    expect(await response).toMatchObject({ code: 'not-joined' });
    response = message(a); a.send('{'); expect(await response).toMatchObject({ code: 'invalid-frame' });
    const b = await connect(url); response = message(b); b.send(Buffer.from('{}'));
    expect(await response).toMatchObject({ code: 'invalid-frame' });
  });
  it('bounds frame size and per-socket message rate', async () => {
    const { url } = await start({ frameLimit: 2 }); const a = await connect(url);
    await join(a, 1);
    let response = message(a); a.send(JSON.stringify({ type: 'join', roomId: roomA, peerId: id(1) }));
    expect(await response).toMatchObject({ code: 'already-joined' });
    response = message(a); a.send(JSON.stringify({ type: 'leave' }));
    expect(await response).toMatchObject({ code: 'rate-limit' });
    const b = await connect(url); const end = new Promise<number>((resolve) => b.once('close', resolve));
    b.send('x'.repeat(96 * 1024 + 1)); expect(await end).toBe(1009);
  });
  it('expires sockets that never join and terminates peers that do not pong', async () => {
    const { url } = await start({ heartbeatMs: 20, joinTimeoutMs: 40 });
    const a = await connect(url); await closed(a);
    const b = new WebSocket(url.replace('http', 'ws') + '/signal', { autoPong: false }); clients.push(b);
    await new Promise<void>((resolve) => b.once('open', resolve)); await join(b, 2); await closed(b);
  });
});

describe('HTTP and policy', () => {
  it('has no implicit public ICE infrastructure and never caches credentials', async () => {
    const { url } = await start();
    expect(await (await fetch(url + '/health')).json()).toEqual({ status: 'ok' });
    const response = await fetch(url + '/ice');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ iceServers: [] });
  });
  it('generates coturn REST expiring HMAC credentials and optional explicit STUN', async () => {
    const { url } = await start({ turnSharedSecret: 'test-only-secret', turnUrls: ['turn:127.0.0.1:3478'], stunUrls: ['stun:127.0.0.1:3478'], turnTtlSeconds: 60 });
    const { iceServers } = await (await fetch(url + '/ice')).json() as { iceServers: any[] };
    expect(iceServers[0]).toEqual({ urls: ['stun:127.0.0.1:3478'] });
    const turn = iceServers[1];
    expect(turn.credential).toBe(createHmac('sha1', 'test-only-secret').update(turn.username).digest('base64'));
    expect(Number(turn.username.split(':')[0])).toBeGreaterThan(Math.floor(Date.now() / 1000) + 58);
  });
  it('allows configured browser origins and native clients without Origin', async () => {
    const { url } = await start({ allowedOrigins: ['https://allowed.test'] });
    expect((await fetch(url + '/ice', { headers: { Origin: 'https://blocked.test' } })).status).toBe(403);
    const good = await fetch(url + '/ice', { headers: { Origin: 'https://allowed.test' } });
    expect(good.headers.get('access-control-allow-origin')).toBe('https://allowed.test');
    await expect(connect(url, 'https://blocked.test')).rejects.toThrow('403');
    await connect(url); await connect(url, 'https://allowed.test');
  });
  it('limits HTTP requests including ICE credential minting', async () => {
    const { url } = await start({ requestLimit: 1 });
    expect((await fetch(url + '/health')).status).toBe(200);
    expect((await fetch(url + '/ice')).status).toBe(429);
  });
  it('validates env configuration without disclosing secrets in errors', () => {
    expect(optionsFromEnv({})).toMatchObject({ host: '127.0.0.1', port: 8787, turnUrls: [], stunUrls: [] });
    expect(() => optionsFromEnv({ TURN_SHARED_SECRET: 'do-not-print' })).toThrow('configured together');
    expect(() => optionsFromEnv({ TURN_TTL_SECONDS: 'infinite' })).toThrow('Invalid TURN_TTL_SECONDS');
  });
});
