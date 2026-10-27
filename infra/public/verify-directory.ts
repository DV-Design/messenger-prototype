/** Live gateway smoke: no content or private identity material is logged. */
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import WebSocket from 'ws';
import { createDeviceIdentity, directoryServerFrameSchema, endpointUrl, signAuthentication, type DirectoryServerFrame } from '../../packages/core/src/index.js';

const base = new URL(process.env.PUBLIC_URL ?? 'https://lienad.ru/messenger');
const url = endpointUrl(base.href, 'directory'); url.protocol = 'wss:';
const sockets: WebSocket[] = [];
const deadline = setTimeout(() => { for (const socket of sockets) socket.terminate(); console.error('Directory smoke timed out'); process.exitCode = 1; }, 25_000);
async function client(suffix: string) {
  const identity = createDeviceIdentity(randomBytes);
  const username = `qa_${Date.now().toString(36)}_${suffix}`;
  const socket = new WebSocket(url, { origin: base.origin }); sockets.push(socket);
  const frames: DirectoryServerFrame[] = [];
  const waiters = new Set<() => void>();
  socket.on('message', data => { frames.push(directoryServerFrameSchema.parse(JSON.parse(data.toString()))); for (const wake of waiters) wake(); });
  const send = (frame: unknown) => socket.send(JSON.stringify(frame));
  async function next(type: DirectoryServerFrame['type']) {
    for (;;) {
      const index = frames.findIndex(f => f.type === type || f.type === 'error');
      if (index >= 0) {
        const frame = frames.splice(index, 1)[0]!;
        if (frame.type === 'error') throw new Error(`Directory error: ${frame.code}`);
        return frame;
      }
      await new Promise<void>((resolve, reject) => {
        const wake = () => { clearTimeout(timer); waiters.delete(wake); resolve(); };
        const timer = setTimeout(() => { waiters.delete(wake); reject(new Error(`Missing ${type}`)); }, 8_000);
        waiters.add(wake);
      });
    }
  }
  await new Promise<void>((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
  const challenge = await next('challenge'); assert.equal(challenge.type, 'challenge');
  if (challenge.type !== 'challenge') throw new Error('Missing challenge');
  send({ type: 'authenticate', publicKey: identity.publicKey, username, displayName: `QA ${suffix}`, signature: signAuthentication(identity, challenge.challenge, username, `QA ${suffix}`) });
  const ready = await next('ready'); assert.equal(ready.type, 'ready');
  return { socket, send, next, userId: identity.userId, username };
}
try {
  const a = await client('a'), b = await client('b'), c = await client('c');
  const requestId = randomBytes(16).toString('hex');
  a.send({ type: 'search', query: b.username, requestId });
  const results = await a.next('results'); assert.equal(results.type, 'results');
  if (results.type === 'results') { assert.equal(results.requestId, requestId); assert.equal(results.users[0]?.userId, b.userId); }
  a.send({ type: 'watch', userIds: [b.userId, c.userId] });
  for (let i = 0; i < 2; i++) { const presence = await a.next('presence'); if (presence.type === 'presence') assert.equal(presence.user.online, true); }
  a.send({ type: 'connect', to: b.userId }); a.send({ type: 'connect', to: c.userId });
  for (const peer of [b, c]) { const connect = await peer.next('connect'); assert.equal(connect.type, 'connect'); if (connect.type === 'connect') assert.equal(connect.from.userId, a.userId); }
  c.socket.close();
  const offline = await a.next('presence'); assert.equal(offline.type, 'presence');
  if (offline.type === 'presence') { assert.equal(offline.user.userId, c.userId); assert.equal(offline.user.online, false); }
  console.log('PASS: public directory gateway, three authenticated users, search, subscribed presence, independent connect notifications');
} finally { clearTimeout(deadline); for (const socket of sockets) socket.close(); }
