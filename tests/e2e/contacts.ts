import type { Page } from '@playwright/test';
import type { DirectoryUser, MessengerClient } from '../../packages/core/src/index.js';

type ClientWindow = Window & { __messenger: MessengerClient };

/** Transport tests begin with a pair that added each other: both are contacts with full permissions. */
export async function connectContacts(a: Page, bob: DirectoryUser, b: Page, alice: DirectoryUser) {
  const add = (page: Page, user: DirectoryUser) => page.evaluate(contact =>
    (window as ClientWindow).__messenger.addContact(contact), user);
  const [chatId] = await Promise.all([add(a, bob), add(b, alice)]);
  return chatId;
}
