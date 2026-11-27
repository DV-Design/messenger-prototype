import { router } from 'expo-router';
import { Text, View } from 'react-native';
import { useState } from 'react';
import { ActionLink, MenuGroup, SettingsPage, SwitchRow } from '../../components/ui';
import { contactJoinNoticesEnabled, setContactJoinNotices } from '../../contact-joins';
import { FeedbackSettings } from '../../components/FeedbackSettings';
import { usePushStatus } from '../../components/PushBridge';
import { styles } from '../../styles';
import { t } from '../../i18n';

export default function NotificationSettings() {
  const pushStatus = usePushStatus();
  const [joins, setJoins] = useState(contactJoinNoticesEnabled);
  return <SettingsPage title={t('Notifications and sounds')}>
    <Text style={styles.sectionTitle}>{t('NOTIFICATIONS')}</Text>
    <View style={[styles.section, styles.content, { marginTop: 0, gap: 10 }]}>
      <Text style={styles.body}>{pushStatus}</Text>
      <ActionLink icon="shield-checkmark-outline" title={t('Configure permissions')} onPress={() => router.push('/permissions')} />
    </View>
    <MenuGroup><SwitchRow icon="person-add-outline" title={t('Contacts joining LastCall')} subtitle={t('A notice when someone from your phone book joins. The phone checks itself every few hours; the server keeps no phone books.')} value={joins} onValueChange={value => { setJoins(value); setContactJoinNotices(value); }} /></MenuGroup>
    <FeedbackSettings />
  </SettingsPage>;
}
