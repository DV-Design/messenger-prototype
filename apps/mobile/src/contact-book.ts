import * as Contacts from 'expo-contacts';
import { getLocales } from 'expo-localization';
import { normalizePhone } from '@messenger/core';

/** Numbers from the phone book (E.164) with the name they are saved under; never leaves the phone as is. */
export async function readPhoneBook(): Promise<Map<string, string>> {
  const { data } = await Contacts.getContactsAsync({ fields: [Contacts.Fields.PhoneNumbers, Contacts.Fields.Name] });
  const region = getLocales()[0]?.regionCode ?? undefined;
  const names = new Map<string, string>();
  for (const contact of data) for (const number of contact.phoneNumbers ?? []) {
    try { const e164 = normalizePhone(number.number ?? number.digits ?? '', region); if (!names.has(e164)) names.set(e164, contact.name ?? e164); }
    catch { /* Not a valid number. */ }
  }
  return names;
}
