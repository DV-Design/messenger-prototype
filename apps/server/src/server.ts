import { createHmac, randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import { clientFrameSchema } from '@messenger/core';

export interface ServerOptions {
  host?: string;
  port?: number;
  allowedOrigins?: string[];
  maxConnections?: number;
  maxConnectionsPerIp?: number;
  maxRooms?: number;
  maxBufferedBytes?: number;
  frameLimit?: number;
  bytesLimit?: number;
  rateWindowMs?: number;
  requestLimit?: number;
  heartbeatMs?: number;
  joinTimeoutMs?: number;
  turnSharedSecret?: string;
  turnUrls?: string[];
  stunUrls?: string[];
  turnTtlSeconds?: number;
}
type Role = 'initiator' | 'responder';
interface Peer {
  ws: WebSocket;
  ip: string;
  alive: boolean;
  openedAt: number;
  windowAt: number;
  frames: number;
  bytes: number;
  roomId?: string;
  peerId?: string;
  role?: Role;
  cleaned: boolean;
}
const MAX_FRAME_BYTES = 96 * 1024;

export function createSignalingServer(options: ServerOptions = {}) {
  const config = {
    host: options.host ?? '127.0.0.1', port: options.port ?? 8787,
    allowedOrigins: options.allowedOrigins ?? ['http://localhost:5173', 'http://127.0.0.1:5173'],
    maxConnections: options.maxConnections ?? 128,
    maxConnectionsPerIp: options.maxConnectionsPerIp ?? 8,
    maxRooms: options.maxRooms ?? 64,
    maxBufferedBytes: options.maxBufferedBytes ?? 256 * 1024,
    frameLimit: options.frameLimit ?? 120, bytesLimit: options.bytesLimit ?? 512 * 1024,
    rateWindowMs: options.rateWindowMs ?? 10_000, requestLimit: options.requestLimit ?? 120,
    heartbeatMs: options.heartbeatMs ?? 30_000, joinTimeoutMs: options.joinTimeoutMs ?? 15_000,
    turnTtlSeconds: options.turnTtlSeconds ?? 600,
  };
  if (config.turnTtlSeconds < 60 || config.turnTtlSeconds > 3600) throw new Error('TURN TTL must be 60–3600 seconds');
  const peers = new Map<WebSocket, Peer>();
  const rooms = new Map<string, Map<string, Peer>>();
  // Bounded, expiring anti-abuse metadata only; no messages, keys or durable storage.
  const requests = new Map<string, { at: number; count: number }>();
  const allowed = new Set(config.allowedOrigins);
  let closing = false;
  const originAllowed = (request: IncomingMessage) => request.headers.origin === undefined || allowed.has(request.headers.origin);
  const ipOf = (request: IncomingMessage) => request.socket.remoteAddress ?? 'unknown'; // Do not trust X-Forwarded-For.
  function acceptRequest(request: IncomingMessage) {
    const now = Date.now();
    const ip = ipOf(request);
    let bucket = requests.get(ip);
    if (bucket && now - bucket.at >= config.rateWindowMs) { requests.delete(ip); bucket = undefined; }
    if (!bucket) {
      if (requests.size >= 1024) {
        for (const [key, value] of requests) if (now - value.at >= config.rateWindowMs) requests.delete(key);
        if (requests.size >= 1024) return false;
      }
      bucket = { at: now, count: 0 }; requests.set(ip, bucket);
    }
    return ++bucket.count <= config.requestLimit;
  }
  const http = createServer({ maxHeaderSize: 8 * 1024 }, (request, response) => {
    const respond = (status: number, body: unknown) => {
      response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      response.end(JSON.stringify(body));
    };
    if (!originAllowed(request)) return respond(403, { error: 'Origin is not allowed' });
    if (!acceptRequest(request)) return respond(429, { error: 'Request rate exceeded' });
    if (request.headers.origin) {
      response.setHeader('Access-Control-Allow-Origin', request.headers.origin);
      response.setHeader('Vary', 'Origin');
    }
    if (request.method !== 'GET') return respond(405, { error: 'GET required' });
    if (request.url === '/health') return respond(200, { status: 'ok' });
    if (request.url === '/ice') {
      const iceServers: { urls: string[]; username?: string; credential?: string }[] = [];
      if (options.stunUrls?.length) iceServers.push({ urls: options.stunUrls });
      if (options.turnSharedSecret && options.turnUrls?.length) {
        const username = `${Math.floor(Date.now() / 1000) + config.turnTtlSeconds}:${randomBytes(12).toString('hex')}`;
        const credential = createHmac('sha1', options.turnSharedSecret).update(username).digest('base64');
        iceServers.push({ urls: options.turnUrls, username, credential });
      }
      return respond(200, { iceServers });
    }
    respond(404, { error: 'Not found' });
  });
  http.maxConnections = config.maxConnections * 2;
  http.headersTimeout = 10_000;
  http.requestTimeout = 10_000;
  http.keepAliveTimeout = 5_000;
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_FRAME_BYTES, perMessageDeflate: false });
  function send(peer: Peer, frame: unknown) {
    if (peer.cleaned || peer.ws.readyState !== WebSocket.OPEN) return;
    const data = JSON.stringify(frame);
    if (peer.ws.bufferedAmount + Buffer.byteLength(data) > config.maxBufferedBytes) {
      cleanup(peer); peer.ws.terminate(); return;
    }
    peer.ws.send(data, (error) => { if (error) { cleanup(peer); peer.ws.terminate(); } });
  }
  function leave(peer: Peer) {
    const { roomId, peerId } = peer;
    peer.roomId = undefined; peer.peerId = undefined; peer.role = undefined;
    if (!roomId || !peerId) return;
    const room = rooms.get(roomId);
    // Identity check prevents an old close/error callback removing a newly joined occupant.
    if (room?.get(peerId) !== peer) return;
    room.delete(peerId);
    if (room.size === 0) rooms.delete(roomId);
    else for (const other of room.values()) send(other, { type: 'peer-left', peerId });
  }
  function cleanup(peer: Peer) {
    if (peer.cleaned) return;
    peer.cleaned = true;
    leave(peer);
    peers.delete(peer.ws);
  }
  function reject(peer: Peer, code: string, message: string, close = false) {
    send(peer, { type: 'error', code, message });
    if (close) { cleanup(peer); peer.ws.close(1008, code); }
  }
  http.on('upgrade', (request, socket, head) => {
    socket.on('error', () => undefined);
    const deny = (status: number) => { socket.end(`HTTP/1.1 ${status} Rejected\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`); };
    if (closing || request.url !== '/signal') return deny(404);
    if (!originAllowed(request)) return deny(403);
    if (!acceptRequest(request)) return deny(429);
    const ip = ipOf(request);
    let ipCount = 0;
    for (const peer of peers.values()) if (peer.ip === ip) ipCount++;
    if (peers.size >= config.maxConnections || ipCount >= config.maxConnectionsPerIp) return deny(503);
    wss.handleUpgrade(request, socket, head, (ws) => {
      const now = Date.now();
      const peer: Peer = { ws, ip, alive: true, openedAt: now, windowAt: now, frames: 0, bytes: 0, cleaned: false };
      peers.set(ws, peer);
      ws.on('error', () => { cleanup(peer); ws.terminate(); });
      ws.on('close', () => cleanup(peer));
      ws.on('pong', () => { peer.alive = true; });
      ws.on('message', (data, binary) => {
        if (peer.cleaned) return;
        const now = Date.now();
        if (now - peer.windowAt >= config.rateWindowMs) { peer.windowAt = now; peer.frames = 0; peer.bytes = 0; }
        const bytes = Array.isArray(data) ? data.reduce((sum, part) => sum + part.length, 0) : data.byteLength;
        if (++peer.frames > config.frameLimit || (peer.bytes += bytes) > config.bytesLimit) return reject(peer, 'rate-limit', 'Signaling rate exceeded', true);
        if (binary || bytes > MAX_FRAME_BYTES) return reject(peer, 'invalid-frame', 'Text JSON frame required', true);
        let json: unknown;
        try { json = JSON.parse(data.toString()); } catch { return reject(peer, 'invalid-frame', 'Invalid JSON', true); }
        const result = clientFrameSchema.safeParse(json);
        if (!result.success) return reject(peer, 'invalid-frame', 'Invalid signaling frame', true);
        const frame = result.data;
        if (frame.type === 'leave') { leave(peer); return; }
        if (frame.type === 'join') {
          if (peer.roomId) return reject(peer, 'already-joined', 'Leave the current room first');
          let room = rooms.get(frame.roomId);
          if (room?.has(frame.peerId)) return reject(peer, 'duplicate-peer', 'Peer identifier is already present');
          if (room && room.size >= 2) return reject(peer, 'room-full', 'Room already has two peers');
          if (!room && rooms.size >= config.maxRooms) return reject(peer, 'server-full', 'Room capacity reached');
          if (!room) { room = new Map(); rooms.set(frame.roomId, room); }
          const other = room.values().next().value as Peer | undefined;
          peer.roomId = frame.roomId; peer.peerId = frame.peerId;
          peer.role = other?.role === 'initiator' ? 'responder' : 'initiator';
          room.set(frame.peerId, peer);
          send(peer, { type: 'joined', roomId: frame.roomId, peerId: frame.peerId, role: peer.role, peerPresent: Boolean(other) });
          if (other) send(other, { type: 'peer-joined', peerId: frame.peerId });
          return;
        }
        if (!peer.roomId || !peer.peerId) return reject(peer, 'not-joined', 'Join a room first');
        const room = rooms.get(peer.roomId);
        const other = room && [...room.values()].find((entry) => entry !== peer);
        if (!other) return reject(peer, 'peer-unavailable', 'The other peer is not connected');
        send(other, { type: 'signal', from: peer.peerId, payload: frame.payload });
      });
    });
  });
  const heartbeat = setInterval(() => {
    const now = Date.now();
    for (const [ip, bucket] of requests) if (now - bucket.at >= config.rateWindowMs) requests.delete(ip);
    for (const peer of peers.values()) {
      if (!peer.alive || (!peer.roomId && now - peer.openedAt >= config.joinTimeoutMs)) { cleanup(peer); peer.ws.terminate(); continue; }
      peer.alive = false; peer.ws.ping();
    }
  }, Math.min(config.heartbeatMs, config.joinTimeoutMs));
  heartbeat.unref();
  return {
    http,
    async listen() {
      await new Promise<void>((resolve, reject) => {
        http.once('error', reject);
        http.listen(config.port, config.host, () => { http.off('error', reject); resolve(); });
      });
      const address = http.address();
      if (!address || typeof address === 'string') throw new Error('TCP listener unavailable');
      return { host: config.host, port: address.port, url: `http://${config.host.includes(':') ? `[${config.host}]` : config.host}:${address.port}` };
    },
    async close() {
      closing = true; clearInterval(heartbeat);
      for (const peer of peers.values()) { cleanup(peer); peer.ws.terminate(); }
      requests.clear();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      if (http.listening) await new Promise<void>((resolve, reject) => http.close((error) => error ? reject(error) : resolve()));
    },
  };
}

function numberEnv(env: NodeJS.ProcessEnv, name: string, fallback: number, min: number, max: number) {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(`Invalid ${name}`);
  return value;
}
export function optionsFromEnv(env: NodeJS.ProcessEnv = process.env): ServerOptions {
  const list = (name: string) => (env[name] ?? '').split(',').map((value) => value.trim()).filter(Boolean);
  const turnUrls = list('TURN_URLS'); const stunUrls = list('STUN_URLS');
  if (turnUrls.some((url) => !/^turns?:[^\s]+$/.test(url)) || stunUrls.some((url) => !/^stuns?:[^\s]+$/.test(url))) throw new Error('Invalid ICE URL configuration');
  if (Boolean(env.TURN_SHARED_SECRET) !== Boolean(turnUrls.length)) throw new Error('TURN_URLS and TURN_SHARED_SECRET must be configured together');
  return {
    host: env.HOST || '127.0.0.1', port: numberEnv(env, 'PORT', 8787, 0, 65535),
    ...(env.ALLOWED_ORIGINS !== undefined ? { allowedOrigins: list('ALLOWED_ORIGINS') } : {}),
    turnSharedSecret: env.TURN_SHARED_SECRET, turnUrls, stunUrls,
    turnTtlSeconds: numberEnv(env, 'TURN_TTL_SECONDS', 600, 60, 3600),
  };
}
