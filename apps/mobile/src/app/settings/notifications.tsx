import { router } from 'expo-router';
import { Text, View } from 'react-native';
import { ActionLink, SettingsPage } from '../../components/ui';
import { FeedbackSettings } from '../../components/FeedbackSettings';
import { usePushStatus } from '../../components/PushBridge';
import { styles } from '../../styles';
import { t } from '../../i18n';

export default function NotificationSettings() {
  const pushStatus = usePushStatus();
  return <SettingsPage title={t('Notifications and sounds')}>
    <Text style={styles.sectionTitle}>{t('NOTIFICATIONS')}</Text>
    <View style={[styles.section, styles.content, { marginTop: 0, gap: 10 }]}>
      <Text style={styles.body}>{pushStatus}</Text>
      <ActionLink icon="shield-checkmark-outline" title={t('Configure permissions')} onPress={() => router.push('/permissions')} />
    </View>
    <FeedbackSettings />
  </SettingsPage>;
}
