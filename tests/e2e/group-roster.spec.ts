import { connectContacts } from './contacts.js';
import { expect, test, type Page } from '@playwright/test';
import type { DirectoryUser, MessengerClient, MessengerOptions, createDeviceIdentity } from '../../packages/core/src/index.js';

type W = Window & { __messenger: MessengerClient; __createMessenger: (options: MessengerOptions) => MessengerClient; __createIdentity: typeof createDeviceIdentity };
const serverUrl = process.env.PW_SIGNALING_URL ?? `http://127.0.0.1:${process.env.PW_SERVER_PORT || '8799'}`;
const group = (page: Page, id: string) => page.evaluate(id => { const c = (window as W).__messenger.getSnapshot().conversations.find(x => x.id === id); return c && { title: c.title, members: c.memberIds.length, removed: !!c.removed, texts: c.messages.map(m => m.text) }; }, id);

test('the owner renames, removes and adds members; everyone converges phone to phone', async ({ browser }) => {
  test.setTimeout(120_000);
  const contexts = await Promise.all([0, 1, 2, 3].map(() => browser.newContext()));
  const pages = await Promise.all(contexts.map(c => c.newPage()));
  const [a, b, c, d] = pages as [Page, Page, Page, Page];
  try {
    const stamp = Date.now().toString(36);
    const users = await Promise.all(pages.map(async (page, i) => {
      await page.goto('/');
      return page.evaluate(async ({ serverUrl, username }) => {
        const w = window as W; w.__messenger = w.__createMessenger({ serverUrl, identity: w.__createIdentity(), username, displayName: username });
        await w.__messenger.connect(); return w.__messenger.getSnapshot().self!;
      }, { serverUrl, username: `roster_${stamp}_${i}` });
    })) as DirectoryUser[];
    const [ua, ub, uc, ud] = users as [DirectoryUser, DirectoryUser, DirectoryUser, DirectoryUser];
    await connectContacts(a, ub, b, ua);
    await connectContacts(a, uc, c, ua);
    await connectContacts(a, ud, d, ua);
    await connectContacts(b, ud, d, ub);
    const id = await a.evaluate(ids => (window as W).__messenger.createGroup('Команда', ids), [ub!.userId, uc!.userId]);
    for (const page of [b, c]) await expect.poll(() => group(page, id)).toMatchObject({ members: 3 });

    await a.evaluate(({ id, remove }) => (window as W).__messenger.updateGroup(id, { title: 'Команда 2', remove: [remove] }), { id, remove: uc!.userId });
    await expect.poll(() => group(b, id)).toMatchObject({ title: 'Команда 2', members: 2, removed: false });
    await expect.poll(() => group(c, id)).toMatchObject({ removed: true });
    await a.evaluate(id => (window as W).__messenger.sendText(id, 'после удаления'), id);
    await expect.poll(async () => (await group(b, id))?.texts).toContain('после удаления');
    expect((await group(c, id))?.texts).not.toContain('после удаления');

    await a.evaluate(({ id, add }) => (window as W).__messenger.updateGroup(id, { add: [add] }), { id, add: ud!.userId });
    await expect.poll(() => group(d, id)).toMatchObject({ title: 'Команда 2', members: 3 });
    await expect.poll(() => group(b, id)).toMatchObject({ members: 3 });
    expect((await group(d, id))?.texts).not.toContain('после удаления'); // no history from before joining
    await d.evaluate(id => (window as W).__messenger.sendText(id, 'привет от нового'), id);
    for (const page of [a, b]) await expect.poll(async () => (await group(page, id))?.texts).toContain('привет от нового');
  } finally { await Promise.all(contexts.map(x => x.close())); }
});
