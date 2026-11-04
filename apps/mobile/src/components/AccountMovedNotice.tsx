import { Alert, Text, View } from 'react-native';
import { removeRetiredDeviceData, useMessenger } from '../runtime';
import { styles } from '../styles';
import { t } from '../i18n';
import { Button, Icon } from './ui';

/** The key was retired on the server, so reconnecting cannot help. */
export function AccountMovedNotice() {
  const { busy, error } = useMessenger();
  return <View style={{ gap: 12, padding: 15, backgroundColor: '#FDECEF' }} accessibilityRole="alert">
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><Icon name="alert-circle-outline" size={19} color="#A22D3B" /><Text style={[styles.rowName, { flex: 1, color: '#A22D3B' }]}>{t('This account was restored on another device')}</Text></View>
    <Text style={[styles.info, { color: '#A22D3B' }]}>{t('This phone can no longer use it: messages are not sent or received here. Your local history stays readable until you remove it. If you did not do this, your mailbox may be compromised: secure it, then restore the account on this phone.')}</Text>
    <Button secondary busy={busy} title={t('Remove data from this phone')} onPress={() => Alert.alert(
      t('Remove data from this phone?'),
      t('Local chat history and contacts will be deleted and cannot be brought back. Afterwards you can restore the account here using your email.'),
      [{ text: t('Cancel'), style: 'cancel' }, { text: t('Remove'), style: 'destructive', onPress: () => { void removeRetiredDeviceData().catch(() => { /* Shown from runtime state. */ }); } }],
    )} />
    {!!error && !/^account-moved\b/.test(error) && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
  </View>;
}
