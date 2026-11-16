import { Contact, ContactField, ContactsSortOrder, requestPermissionsAsync } from 'expo-contacts';
import { t } from './i18n';
import { reportDenied } from './permission-notice';
import { AccessDenied } from './permission-notice-model';
import { uniquePhones, type PhoneContact } from './contacts-model';

/**
 * Asks for contacts access only when the person opens "Share contact", then reads names and
 * phone numbers for the in-app list. Nothing is uploaded or kept: the list lives in the picker
 * while it is open, and only the one contact the person taps is sent, as a text message.
 */
export async function loadPhoneContacts(): Promise<PhoneContact[]> {
  const permission = await requestPermissionsAsync();
  if (!permission.granted) { reportDenied('contacts'); throw new AccessDenied(t('Allow access to contacts in the phone settings.')); }
  const rows = await Contact.getAllDetails([ContactField.FULL_NAME, ContactField.PHONES], { sortOrder: ContactsSortOrder.UserDefault });
  const list: PhoneContact[] = [];
  for (const row of rows) {
    const phones = uniquePhones((row.phones ?? []).map(phone => phone.number));
    if (phones.length) list.push({ id: row.id, name: row.fullName?.trim() || t('Unnamed contact'), phones });
  }
  return list;
}
