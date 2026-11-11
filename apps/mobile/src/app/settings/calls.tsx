import { useState } from 'react';
import { Text, View } from 'react-native';
import { ActionLink, SettingsPage } from '../../components/ui';
import { OemCallSetup } from '../../components/OemCallSetup';
import { enableSystemCalls, useSystemCallStatus } from '../../system-calls';
import { errorText } from '../../runtime';
import { styles } from '../../styles';
import { t } from '../../i18n';

export default function CallSettings() {
  const callStatus = useSystemCallStatus();
  const [error, setError] = useState('');
  return <SettingsPage title={t('Calls')}>
    <Text style={styles.sectionTitle}>{t('SYSTEM CALLS')}</Text>
    <View style={[styles.section, styles.content, { marginTop: 0, gap: 10 }]}>
      <Text style={styles.body}>{callStatus}</Text>
      <ActionLink icon="call-outline" title={t('Open call settings')} onPress={() => void enableSystemCalls().catch(cause => setError(errorText(cause)))} />
      {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
      <Text style={styles.info}>{t('On Android 8+ LastCall registers its own phone account and shows its own incoming-call screen; no manual setup in the Phone app is needed. The screen appears after the encrypted call invitation is verified; connecting the peer may continue after you answer. On Android 14+ allow full-screen notifications, otherwise the call stays a normal notification. The microphone is enabled only after you answer. On Android 7 LastCall uses its own notification and screen without the Phone app.')}</Text>
      <OemCallSetup />
    </View>
  </SettingsPage>;
}
