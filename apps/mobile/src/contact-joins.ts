import { Platform } from 'react-native';
import { getPermissionsAsync } from 'expo-contacts';
import * as Notifications from 'expo-notifications';
import { AndroidImportance } from 'expo-notifications';
import { File, Paths } from 'expo-file-system';
import type { DirectoryUser } from '@messenger/core';
import { readPhoneBook } from './contact-book';
import { dueForJoinCheck, joinedSince, type JoinState } from './contact-join-model';
import { client, findContactsByPhone } from './runtime';
import { t } from './i18n';

export const CONTACT_JOINED_KIND = 'lastcall-contact-joined';
const CHANNEL = 'lastcall-contacts';
const stateFile = () => new File(Paths.document, 'contact-joins.json');
const settingFile = () => new File(Paths.document, 'contact-join-notices.json');

function readJson<T>(file: File): T | undefined { try { return file.exists ? JSON.parse(file.textSync()) as T : undefined; } catch { return undefined; } }
export function contactJoinNoticesEnabled(): boolean { return readJson<{ enabled: boolean }>(settingFile())?.enabled !== false; }
export function setContactJoinNotices(enabled: boolean) { try { settingFile().write(JSON.stringify({ enabled })); } catch { /* Kept as before. */ } }

/** The "Find friends" search remembers who it found, so later checks announce only newcomers. */
export function rememberFoundContacts(found: Array<{ user: DirectoryUser }>) {
  const { state } = joinedSince(readJson<JoinState>(stateFile()), found.map(item => item.user), new Set(), '', Date.now());
  try { stateFile().write(JSON.stringify(state)); } catch { /* The next check sets the baseline. */ }
}

let running = false;
/** At most every 4 hours, only with contacts access already granted and a linked number. */
export async function checkContactJoins(input: { phoneLinked: boolean; force?: boolean }): Promise<void> {
  if (running || !input.phoneLinked || !contactJoinNoticesEnabled()) return;
  const previous = readJson<JoinState>(stateFile());
  if (!dueForJoinCheck(previous, Date.now(), input.force)) return;
  running = true;
  try {
    if ((await getPermissionsAsync()).status !== 'granted') return;
    const names = await readPhoneBook();
    if (!names.size) return;
    const found = await findContactsByPhone([...names.keys()].slice(0, 5000));
    const snapshot = client().getSnapshot();
    const self = snapshot.self?.userId ?? '';
    const contacts = new Set(snapshot.contacts.map(contact => contact.userId));
    const { fresh, state } = joinedSince(previous, found.map(item => ({ ...item.user, name: names.get(item.phone) ?? item.user.displayName })), contacts, self, Date.now());
    stateFile().write(JSON.stringify(state));
    if (!fresh.length) return;
    if (Platform.OS === 'android') await Notifications.setNotificationChannelAsync(CHANNEL, { name: t('Contacts joining LastCall'), importance: AndroidImportance.DEFAULT });
    for (const user of fresh) {
      const { name, ...directory } = user;
      await Notifications.scheduleNotificationAsync({
        content: { title: t('{name} joined LastCall', { name }), body: t('Your contact is now on LastCall. Tap to write.'), data: { kind: CONTACT_JOINED_KIND, user: { userId: directory.userId, publicKey: directory.publicKey, username: directory.username, displayName: directory.displayName } } },
        trigger: Platform.OS === 'android' ? { channelId: CHANNEL } : null,
      });
    }
  } catch { /* Tried again next time. */ }
  finally { running = false; }
}
