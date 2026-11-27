import { Contact, ContactField } from 'expo-contacts';
import { getLocales } from 'expo-localization';
import { normalizePhone } from '@messenger/core';
import { busyWith } from './stall-watch';

/** Numbers from the phone book (E.164) with the name they are saved under; never leaves the phone as is. */
export async function readPhoneBook(): Promise<Map<string, string>> {
  const end = busyWith('phone book');
  try { return await readNow(); } finally { end(); }
}
async function readNow(): Promise<Map<string, string>> {
  // The class API (expo-contacts 58); the old getContactsAsync now throws a deprecation error.
  const rows = await Contact.getAllDetails([ContactField.FULL_NAME, ContactField.PHONES]);
  const region = getLocales()[0]?.regionCode ?? undefined;
  const names = new Map<string, string>();
  for (const contact of rows) for (const phone of contact.phones ?? []) {
    try { const e164 = normalizePhone(phone.number ?? '', region); if (!names.has(e164)) names.set(e164, contact.fullName?.trim() || e164); }
    catch { /* Not a valid number. */ }
  }
  return names;
}
