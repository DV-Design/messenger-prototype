import { Contact, ContactField, ContactsSortOrder } from 'expo-contacts';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { toDeviceContact } from './phonebook-model';
export const PHONEBOOK_PAGE_SIZE = 200;
const fields = [ContactField.FULL_NAME, ContactField.PHONES, ContactField.URL_ADDRESSES, ContactField.IM_ADDRESSES] as const;
export async function readDeviceContacts(offset: number, query = '') {
  const records = await Contact.getAllDetails(fields, { limit: PHONEBOOK_PAGE_SIZE, offset, name: query.trim() || undefined, sortOrder: ContactsSortOrder.GivenName });
  return { contacts: records.map(toDeviceContact), hasMore: records.length === PHONEBOOK_PAGE_SIZE };
}
async function linkKey(serverUrl: string, userId: string, contactId: string) {
  const hash = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, JSON.stringify(['lastcall/contact-link/v1', serverUrl, userId, contactId]));
  return `lastcall.contact.${hash}`;
}
export async function getContactLink(serverUrl: string, userId: string, contactId: string): Promise<string | null> {
  const value = await SecureStore.getItemAsync(await linkKey(serverUrl, userId, contactId));
  return value && /^[a-f0-9]{64}$/.test(value) ? value : null;
}
export async function saveContactLink(serverUrl: string, userId: string, contactId: string, directoryUserId: string): Promise<void> {
  if (!/^[a-f0-9]{64}$/.test(directoryUserId)) throw new Error('Некорректный профиль контакта.');
  // Each record is only 64 hex characters, below SecureStore platform limits.
  // No phone number, device-contact name or raw native contact ID is stored.
  await SecureStore.setItemAsync(await linkKey(serverUrl, userId, contactId), directoryUserId,
    { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY });
}
