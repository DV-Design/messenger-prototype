import { useState } from 'react';
import { router, type Href } from 'expo-router';
import { Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from '../../components/SafeArea';
import * as Clipboard from 'expo-clipboard';
import Constants from 'expo-constants';
import { Avatar, MenuGroup, MenuRow, ScreenHeader, connectionLabel, fileSize } from '../../components/ui';
import { AccountMovedNotice } from '../../components/AccountMovedNotice';
import { errorText, useMessenger } from '../../runtime';
import { connectionNeedsUser } from '../../connection-supervisor';
import { directUpdates, useUpdateState } from '../../updates';
import { useMyLanguage } from '../../my-language';
import { storageFolders, storageTotals } from '../../storage-model';
import { styles } from '../../styles';
import { t } from '../../i18n';

/** The main settings list. Each topic opens its own page so the list stays short. */
export default function Settings() {
  const { profile, identity, snapshot, error, boundEmail, retired } = useMessenger();
  const updateState = useUpdateState();
  const language = useMyLanguage();
  const [copied, setCopied] = useState(false);
  const [localError, setLocalError] = useState('');
  const totals = storageTotals(storageFolders(snapshot, identity?.userId));
  const open = (href: Href) => () => router.push(href);
  const connection = snapshot.status === 'error' && connectionNeedsUser(snapshot.error ?? error) ? t('Not connected') : connectionLabel[snapshot.status];

  return <SafeAreaView style={styles.screen} edges={['top']}><ScreenHeader title={t('Settings')} />
    <ScrollView contentContainerStyle={{ paddingBottom: 35 }}>
      <View style={styles.profile}><Avatar name={profile?.displayName ?? ''} id={identity?.userId} size={72} /><Text style={styles.profileName}>{profile?.displayName}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel={t('Copy username')} onPress={() => { void Clipboard.setStringAsync(`@${profile?.username ?? ''}`).then(() => setCopied(true)).catch(cause => setLocalError(errorText(cause))); }}><Text style={styles.profileUsername}>@{profile?.username}</Text></Pressable>
        {copied && <Text style={styles.info}>{t('Username copied')}</Text>}{!!localError && <Text style={styles.error}>{localError}</Text>}</View>
      {retired && <AccountMovedNotice />}
      <MenuGroup>
        <MenuRow icon="person-circle-outline" title={t('Account')} subtitle={boundEmail?.email ?? t('Email not added')} chevron onPress={open('/settings/account')} />
        <MenuRow icon="lock-closed-outline" title={t('Privacy and safety')} subtitle={snapshot.blockedContacts.length ? t('Blocked: {count}', { count: snapshot.blockedContacts.length }) : t('Blocked contacts and app permissions')} chevron onPress={open('/settings/privacy')} />
      </MenuGroup>
      <MenuGroup>
        <MenuRow icon="notifications-outline" title={t('Notifications and sounds')} chevron onPress={open('/settings/notifications')} />
        {Platform.OS === 'android' && <MenuRow icon="call-outline" title={t('Calls')} chevron onPress={open('/settings/calls')} />}
        <MenuRow icon="language-outline" title={t('Language and translation')} value={language.label} chevron onPress={open('/settings/language')} />
        <MenuRow icon="folder-open-outline" title={t('Data and storage')} value={fileSize(totals.bytes)} chevron onPress={open('/settings/storage')} />
      </MenuGroup>
      <MenuGroup>
        <MenuRow icon={snapshot.status === 'online' ? 'cloud-done-outline' : 'cloud-offline-outline'} title={t('Connection')} value={connection} chevron onPress={open('/settings/connection')} />
        {directUpdates && Platform.OS === 'android' && <MenuRow icon="cloud-download-outline" title={t('Updates')} value={updateState.status === 'available' ? t('Available') : undefined} chevron onPress={open('/settings/updates')} />}
        <MenuRow icon="information-circle-outline" title={t('About LastCall')} value={Constants.expoConfig?.version} chevron onPress={open('/settings/about')} />
      </MenuGroup>
    </ScrollView>
  </SafeAreaView>;
}
