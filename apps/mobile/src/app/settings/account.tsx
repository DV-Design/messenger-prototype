import { useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { ActionLink, SettingsPage } from '../../components/ui';
import { AccountMovedNotice } from '../../components/AccountMovedNotice';
import { EmailBinding } from '../../components/EmailBinding';
import { deleteAccount, errorText, useMessenger } from '../../runtime';
import { styles } from '../../styles';
import { t } from '../../i18n';

export default function AccountSettings() {
  const { retired } = useMessenger();
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');
  return <SettingsPage title={t('Account')}>
    {retired && <AccountMovedNotice />}
    {!retired && <>
      <Text style={styles.sectionTitle}>{t('EMAIL')}</Text>
      <View style={[styles.section, styles.content, { marginTop: 0 }]}><EmailBinding /></View>
      <Text style={styles.sectionTitle}>{t('DELETE ACCOUNT')}</Text>
      <View style={[styles.section, styles.content, { marginTop: 0, gap: 10 }]}>
        <Text style={styles.body}>{t('Deleting the account removes the profile and push consents on the server, plus the device key, contacts and history on this phone. This cannot be undone.')}</Text>
        <ActionLink icon="trash-outline" danger busy={deleting} title={deleting ? t('Deleting…') : t('Delete account')} onPress={() => Alert.alert(
          t('Delete account?'),
          t('The profile, key, contacts and history will be deleted. This action is irreversible.'),
          [{ text: t('Cancel'), style: 'cancel' }, { text: t('Delete'), style: 'destructive', onPress: () => {
            if (deleting) return;
            setDeleting(true); setError('');
            void deleteAccount().catch(cause => setError(errorText(cause))).finally(() => setDeleting(false));
          } }],
        )} />
        {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
      </View>
    </>}
    <Text style={[styles.info, { paddingHorizontal: 20, marginTop: 16 }]}>{t('Login is confirmed by the server and bound to this device key.')}</Text>
  </SettingsPage>;
}
