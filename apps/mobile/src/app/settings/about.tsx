import { useState } from 'react';
import { Linking, Text, View } from 'react-native';
import Constants from 'expo-constants';
import { MenuGroup, MenuRow, SettingsPage } from '../../components/ui';
import { styles } from '../../styles';
import { t } from '../../i18n';

export default function About() {
  const [error, setError] = useState('');
  return <SettingsPage title={t('About LastCall')}>
    <View style={[styles.section, { marginTop: 16, padding: 18, gap: 13 }]}><Text style={styles.rowName}>LastCall · {Constants.expoConfig?.version}</Text>
      <Text style={styles.body}>{t('The server stores your profile and helps find contacts. Text, files and calls travel over a protected connection between participants; WebRTC uses TURN when needed.')}</Text>
      <Text style={styles.body}>{t('Contacts, messages and files are encrypted on the device. The outbox waits for the recipient for up to 7 days and survives restarts. In groups, data syncs between participants. Limits: 5 MiB per file, up to 16 files waiting for delivery, up to 2000 stored files / 10 GiB in total and never the last 512 MB of free phone space. On a network change the app tries to preserve the session for 10 seconds.')}</Text>
      <Text style={styles.body}>{t('Android notifications work only when Firebase is configured in the build and on the server and you granted permission. Text delivery requires the sender to be reachable. After a force-stop, Android push does not work until the app is opened manually. Android system incoming calls use LastCall’s own phone account, registered automatically. iOS push/CallKit and group calls are not available yet.')}</Text>
      <Text style={styles.info}>{t('A direct connection reveals your IP to the peer. This preview has not passed an independent audit, does not use Double Ratchet and does not promise DPI invisibility. Removing the app can lose the key and local history.')}</Text>
    </View>
    <MenuGroup>
      <MenuRow icon="document-text-outline" accessibilityRole="link" title={t('Privacy policy')} chevron onPress={() => void Linking.openURL('https://p2p.lienad.ru/privacy.html').catch(() => setError(t('Could not open the privacy policy.')))} />
      <MenuRow icon="people-outline" accessibilityRole="link" title={t('Community guidelines')} chevron onPress={() => void Linking.openURL('https://p2p.lienad.ru/community.html').catch(() => setError(t('Could not open community guidelines.')))} />
    </MenuGroup>
    {!!error && <Text accessibilityRole="alert" style={[styles.error, { marginHorizontal: 16, marginTop: 16 }]}>{error}</Text>}
  </SettingsPage>;
}
