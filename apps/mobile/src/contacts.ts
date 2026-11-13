import * as Contacts from 'expo-contacts';
import { t } from './i18n';
import { formatContactText } from './location-contact';

/**
 * The system contact picker (ACTION_PICK on Android, CNContactPickerViewController on iOS) runs
 * out of process and hands back only the one contact the person chose — no READ_CONTACTS /
 * contacts runtime permission is requested or needed, and LastCall never reads the address book.
 */
export async function pickContactText(): Promise<string | undefined> {
  const result = await Contacts.presentContactPickerAsync();
  if (!result) return;
  const name = [result.firstName, result.lastName].filter(Boolean).join(' ').trim() || result.name?.trim() || t('Unnamed contact');
  const phones = (result.phoneNumbers ?? []).map(entry => entry.number).filter((value): value is string => !!value?.trim());
  if (!phones.length) throw new Error(t('This contact has no phone number.'));
  return formatContactText(name, phones);
}
