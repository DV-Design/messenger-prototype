import { expect, test, type Page } from '@playwright/test';
import type { DirectoryUser, MessengerClient, MessengerOptions, createDeviceIdentity } from '../../packages/core/src/index.js';

type ClientWindow = Window & {
  __messenger: MessengerClient;
  __createMessenger: (options: MessengerOptions) => MessengerClient;
  __createIdentity: typeof createDeviceIdentity;
};
const serverUrl = process.env.PW_SIGNALING_URL ?? `http://127.0.0.1:${process.env.PW_SERVER_PORT || '8799'}`;
async function state(page: Page) {
  return page.evaluate(() => {
    const s = (window as ClientWindow).__messenger.getSnapshot();
    return { status: s.status, contacts: s.contacts, conversations: s.conversations.map(c => ({
      id: c.id, kind: c.kind, title: c.title, messages: c.messages,
      status: c.session?.status, route: c.session?.route,
      files: c.files.map(f => ({ name: f.name, status: f.status, bytes: f.data ? Array.from(f.data) : undefined })),
    })), activeCall: s.activeCall ? { peerId: s.activeCall.peerId, state: s.activeCall.session.callState } : undefined };
  });
}
async function add(page: Page, user: DirectoryUser) {
  return page.evaluate(u => (window as ClientWindow).__messenger.addContact(u), user);
}
async function send(page: Page, id: string, text: string) {
  await page.evaluate(({ id, text }) => (window as ClientWindow).__messenger.sendText(id, text), { id, text });
}

test('three users retain parallel direct chats, fan out a private group and receive a call globally', async ({ browser }) => {
  const contexts = await Promise.all([0, 1, 2].map(() => browser.newContext({ permissions: ['microphone', 'camera'] })));
  const pages = await Promise.all(contexts.map(c => c.newPage()));
  const [a, b, c] = pages as [Page, Page, Page];
  try {
    const users = await Promise.all(pages.map(async (page, i) => {
      await page.goto('/');
      return page.evaluate(async ({ serverUrl, username }) => {
        const w = window as ClientWindow;
        w.__messenger = w.__createMessenger({ serverUrl, identity: w.__createIdentity(), username, displayName: username });
        await w.__messenger.connect();
        return w.__messenger.getSnapshot().self!;
      }, { serverUrl, username: `e2e_${Date.now().toString(36)}_${i}` });
    }));
    const [ua, ub, uc] = users as [DirectoryUser, DirectoryUser, DirectoryUser];
    const found = await a.evaluate(name => (window as ClientWindow).__messenger.search(name), ub.username);
    expect(found.some(u => u.userId === ub.userId)).toBe(true);
    const ab = await add(a, ub), ac = await add(a, uc);
    await expect.poll(async () => (await state(a)).conversations.filter(c => c.status === 'connected').length).toBe(2);
    await send(a, ab, 'Только для B');
    await send(a, ac, 'Только для C');
    await expect.poll(async () => (await state(b)).conversations.flatMap(c => c.messages).map(m => m.text)).toContain('Только для B');
    await expect.poll(async () => (await state(c)).conversations.flatMap(c => c.messages).map(m => m.text)).toContain('Только для C');
    expect((await state(c)).conversations.flatMap(c => c.messages).some(m => m.text === 'Только для B')).toBe(false);
    await expect.poll(async () => (await state(a)).conversations.find(c => c.id === ab)?.messages[0]?.status).toBe('delivered');

    const group = await a.evaluate(ids => (window as ClientWindow).__messenger.createGroup('Трое на связи', ids), [ub.userId, uc.userId]);
    for (const page of [b, c]) await expect.poll(async () => (await state(page)).conversations.some(c => c.id === group)).toBe(true);
    await send(a, group, 'Всем участникам напрямую');
    for (const page of [b, c]) await expect.poll(async () => (await state(page)).conversations.find(c => c.id === group)?.messages.map(m => m.text)).toContain('Всем участникам напрямую');
    await send(b, group, 'Ответ от B всем');
    for (const page of [a, c]) await expect.poll(async () => (await state(page)).conversations.find(c => c.id === group)?.messages.map(m => m.text)).toContain('Ответ от B всем');
    await expect.poll(async () => (await state(b)).conversations.find(c => c.id === group)?.messages.find(m => m.text === 'Ответ от B всем')?.status).toBe('delivered');

    const bytes = [0, 255, 1, 88, 10];
    await a.evaluate(({ id, bytes }) => (window as ClientWindow).__messenger.sendFile(id, { name: 'group.bin', mime: 'application/octet-stream', data: new Uint8Array(bytes) }), { id: group, bytes });
    for (const page of [b, c]) await expect.poll(async () => (await state(page)).conversations.find(c => c.id === group)?.files.find(f => f.name === 'group.bin')).toEqual({ name: 'group.bin', status: 'complete', bytes });
    // A recipient can send to the whole group without first opening individual chats.
    const replyBytes = [9, 0, 212, 73];
    await b.evaluate(({ id, bytes }) => (window as ClientWindow).__messenger.sendFile(id, { name: 'member.bin', mime: 'application/octet-stream', data: new Uint8Array(bytes) }), { id: group, bytes: replyBytes });
    for (const page of [a, c]) await expect.poll(async () => (await state(page)).conversations.find(c => c.id === group)?.files.find(f => f.name === 'member.bin')).toEqual({ name: 'member.bin', status: 'complete', bytes: replyBytes });

    // A's open conversation is a UI concern: the client receives B's call globally while A-C remains usable.
    await b.evaluate(id => (window as ClientWindow).__messenger.startCall(id), ab);
    await expect.poll(async () => (await state(a)).activeCall).toEqual({ peerId: ub.userId, state: 'incoming' });
    await a.evaluate(() => (window as ClientWindow).__messenger.acceptCall());
    await expect.poll(async () => (await state(a)).activeCall?.state).toBe('active');
    await send(a, ac, 'Чат C работает во время звонка с B');
    await expect.poll(async () => (await state(c)).conversations.flatMap(c => c.messages).map(m => m.text)).toContain('Чат C работает во время звонка с B');
    await a.evaluate(() => (window as ClientWindow).__messenger.endCall());
    await expect.poll(async () => (await state(b)).activeCall).toBeUndefined();
    await expect.poll(async () => (await state(a)).conversations.filter(c => c.kind === 'direct').every(c => c.route === 'direct')).toBe(true);

    await c.evaluate(() => (window as ClientWindow).__messenger.disconnect());
    await expect.poll(async () => (await state(a)).contacts.find(u => u.userId === uc.userId)?.online).toBe(false);
    await send(a, ac, 'Ждёт возвращения C');
    await expect.poll(async () => (await state(a)).conversations.find(c => c.id === ac)?.messages.at(-1)?.status).toBe('pending');
    await c.evaluate(() => (window as ClientWindow).__messenger.connect());
    await expect.poll(async () => (await state(c)).conversations.flatMap(c => c.messages).map(m => m.text)).toContain('Ждёт возвращения C');
    await expect.poll(async () => (await state(a)).conversations.find(c => c.id === ac)?.messages.at(-1)?.status).toBe('delivered');
    expect((await state(a)).contacts.find(u => u.userId === ua.userId)).toBeUndefined();
  } finally {
    await Promise.all(pages.map(p => p.evaluate(() => (window as ClientWindow).__messenger?.disconnect()).catch(() => undefined)));
    await Promise.all(contexts.map(c => c.close()));
  }
});
