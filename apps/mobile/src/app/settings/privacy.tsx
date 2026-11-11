import { useState } from 'react';
import { router } from 'expo-router';
import { Text, View } from 'react-native';
import { ActionLink, MenuGroup, MenuRow, SettingsPage } from '../../components/ui';
import { client, errorText, useMessenger } from '../../runtime';
import { styles } from '../../styles';
import { t } from '../../i18n';

export default function PrivacySettings() {
  const { snapshot } = useMessenger();
  const [error, setError] = useState('');
  return <SettingsPage title={t('Privacy and safety')}>
    <MenuGroup><MenuRow icon="shield-checkmark-outline" title={t('App permissions')} subtitle={t('Microphone, camera, notifications, photos')} chevron onPress={() => router.push('/permissions')} /></MenuGroup>
    <Text style={styles.sectionTitle}>{t('BLOCKED CONTACTS')}</Text>
    <View style={[styles.section, { marginTop: 0 }]}>
      {snapshot.blockedContacts.length === 0 ? <View style={styles.content}><Text style={styles.body}>{t('No blocked contacts.')}</Text></View>
        : snapshot.blockedContacts.map((userId, index) => <View key={userId}>{index > 0 && <View style={styles.menuSeparator} />}<View style={[styles.menuRow, { justifyContent: 'space-between' }]}>
          <Text numberOfLines={1} style={[styles.menuText, styles.flex]}>{snapshot.contacts.find(item => item.userId === userId)?.displayName ?? userId}</Text>
          <ActionLink icon="lock-open-outline" title={t('Unblock')} onPress={() => { setError(''); void client().unblockContact(userId).catch(cause => setError(errorText(cause))); }} />
        </View></View>)}
    </View>
    {!!error && <Text accessibilityRole="alert" style={[styles.error, { marginHorizontal: 16, marginTop: 16 }]}>{error}</Text>}
    <Text style={[styles.info, { paddingHorizontal: 20, marginTop: 12 }]}>{t('Blocked people cannot call you, and their messages are hidden. Block or report from the menu in a chat.')}</Text>
  </SettingsPage>;
}
