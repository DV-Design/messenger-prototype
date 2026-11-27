import { useState } from 'react';
import { router } from 'expo-router';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import * as Contacts from 'expo-contacts';
import type { DirectoryUser } from '@messenger/core';
import { readPhoneBook } from '../contact-book';
import { rememberFoundContacts } from '../contact-joins';
import { Avatar, Button, SettingsPage } from '../components/ui';
import { client, errorText, findContactsByPhone, useMessenger } from '../runtime';
import { colors, styles } from '../styles';
import { t } from '../i18n';

interface Match { name: string; user: DirectoryUser }

/** Reads the phone book only after the person taps the button and allows access; numbers are not kept. */
export default function FindFriends() {
  const { phone } = useMessenger();
  const [state, setState] = useState<'idle' | 'reading' | 'done' | 'denied'>('idle');
  const [matches, setMatches] = useState<Match[]>([]);
  const [error, setError] = useState('');
  async function search() {
    setError(''); setState('reading');
    try {
      const permission = await Contacts.requestPermissionsAsync();
      if (permission.status !== 'granted') { setState('denied'); return; }
      const names = await readPhoneBook();
      const found = names.size ? await findContactsByPhone([...names.keys()].slice(0, 5000)) : [];
      rememberFoundContacts(found);
      const own = client().getSnapshot().contacts.map(contact => contact.userId);
      setMatches(found.filter(match => !own.includes(match.user.userId)).map(match => ({ name: names.get(match.phone) ?? match.user.displayName, user: match.user })));
      setState('done');
    } catch (cause) {
      setState('idle');
      setError(/phone-required/.test(errorText(cause)) ? t('Link your phone number first.') : errorText(cause));
    }
  }
  async function write(user: DirectoryUser) {
    try { const id = await client().addContact(user); router.replace({ pathname: '/chat/[id]', params: { id } }); }
    catch (cause) { setError(errorText(cause)); }
  }
  return <SettingsPage title={t('Find friends from contacts')}>
    <View style={[styles.content, { gap: 12 }]}>
      <Text style={styles.body}>{t('LastCall checks which numbers from your phone book belong to LastCall users who allow it. The numbers are sent once over an encrypted connection and are not stored.')}</Text>
      {!phone?.phone && <Text style={styles.info}>{t('Link your phone number first.')}</Text>}
      {!phone?.phone ? <Button secondary title={t('Link number through Telegram')} onPress={() => router.push('/settings/phone')} />
        : state === 'reading' ? <ActivityIndicator color={colors.accent} />
        : <Button title={state === 'done' ? t('Search again') : t('Find friends')} onPress={() => void search()} />}
      {state === 'denied' && <Text style={styles.error}>{t('LastCall needs access to contacts to find friends. You can allow it in the phone settings.')}</Text>}
      {state === 'done' && matches.length === 0 && <Text style={styles.info}>{t('None of your contacts can be found on LastCall yet.')}</Text>}
      {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
    </View>
    {matches.map(item => <Pressable key={item.user.userId} style={styles.listRow} accessibilityRole="button" onPress={() => void write(item.user)}>
      <Avatar name={item.user.displayName} id={item.user.userId} />
      <View style={styles.rowBody}><Text style={styles.rowName}>{item.name}</Text><Text style={styles.rowText}>@{item.user.username}</Text></View>
      <Text style={{ color: colors.accent }}>{t('Write')}</Text>
    </Pressable>)}
  </SettingsPage>;
}
