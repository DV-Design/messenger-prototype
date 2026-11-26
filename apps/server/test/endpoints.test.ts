import { afterEach, describe, expect, it } from 'vitest';
import { createDeviceIdentity, MessengerClient } from '@messenger/core';
import { createSignalingServer } from '../src/server.js';

const servers: ReturnType<typeof createSignalingServer>[] = [];
const clients: MessengerClient[] = [];
afterEach(async () => {
  for (const client of clients.splice(0)) client.disconnect();
  await Promise.all(servers.splice(0).map(server => server.close()));
});

describe('server addresses for signed-in clients', () => {
  it('are given only to clients that ask, after sign-in, and never otherwise', async () => {
    const endpoints = ['https://primary.example:4443', 'https://fallback.example'];
    const server = createSignalingServer({ port: 0, clientEndpoints: endpoints }); servers.push(server);
    const { url } = await server.listen();
    const seen: string[][] = [];
    const asking = new MessengerClient({ serverUrl: url, identity: createDeviceIdentity(), username: 'asker', displayName: 'Asker', onEndpoints: list => seen.push(list) }); clients.push(asking);
    await asking.connect();
    const capabilities = await asking.getServices();
    expect(capabilities.endpoints).toEqual(endpoints);
    expect(seen).toEqual([endpoints]);
    const plain = new MessengerClient({ serverUrl: url, identity: createDeviceIdentity(), username: 'plain', displayName: 'Plain' }); clients.push(plain);
    await plain.connect();
    expect((await plain.getServices()).endpoints).toBeUndefined();
  });

  it('are not configured unless the server sets them', async () => {
    const server = createSignalingServer({ port: 0 }); servers.push(server);
    const { url } = await server.listen();
    const asking = new MessengerClient({ serverUrl: url, identity: createDeviceIdentity(), username: 'asker', displayName: 'Asker', onEndpoints: () => { throw new Error('unexpected'); } }); clients.push(asking);
    await asking.connect();
    expect((await asking.getServices()).endpoints).toBeUndefined();
  });
});
