import { useState } from 'react';
import { Text, View } from 'react-native';
import { ActionLink, Icon, SettingsPage } from '../../components/ui';
import { checkForUpdate, downloadAndInstallUpdate, useUpdateState } from '../../updates';
import { colors, styles } from '../../styles';
import { t } from '../../i18n';

export default function UpdateSettings() {
  const updateState = useUpdateState();
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState('');
  const availableUpdate = updateState.status === 'available' ? updateState.update : undefined;
  const statusText = updateState.status === 'checking' ? t('Checking for updates…')
    : availableUpdate ? t('Version {version} is available', { version: availableUpdate.version })
      : updateState.status === 'current' ? t('You have the latest version')
        : updateState.status === 'error' ? t('Could not check for updates')
          : t('Not checked yet');
  return <SettingsPage title={t('Updates')}>
    <View style={[styles.section, { marginTop: 16 }]}>
      <View style={styles.listRow}><Icon name="cloud-download-outline" color={availableUpdate ? colors.accent : colors.secondary} /><View style={styles.rowBody}><Text style={styles.rowName}>LastCall · {updateState.currentVersion}</Text><Text style={styles.rowText}>{statusText}</Text></View></View>
      <View style={[styles.content, { gap: 10 }]}>
        {availableUpdate ? <>
          {!!availableUpdate.notes && <Text style={styles.body}>{availableUpdate.notes}</Text>}
          <ActionLink icon="download-outline" busy={updating} title={updating ? t('Downloading and verifying…') : t('Download and install {version}', { version: availableUpdate.version })} onPress={() => {
            if (updating) return;
            setUpdating(true); setError('');
            void downloadAndInstallUpdate(availableUpdate).catch(() => setError(t('Could not download or verify the update. Try again later.'))).finally(() => setUpdating(false));
          }} />
          <Text style={styles.info}>{t('The APK is downloaded in the app, verified by SHA-256, then handed to the Android system installer. Your profile, key, contacts and history are preserved.')}</Text>
        </> : <ActionLink icon="refresh-outline" busy={updateState.status === 'checking'} title={t('Check for updates')} onPress={() => void checkForUpdate(true)} />}
        {updateState.status === 'current' && <Text style={styles.info}>{t('You have the latest published version.')}</Text>}
        {!!(error || updateState.error) && <Text accessibilityRole="alert" style={styles.error}>{error || updateState.error}</Text>}
        <Text style={styles.info}>{t('The check uses the official LastCall website and does not use your profile server.')}</Text>
      </View>
    </View>
  </SettingsPage>;
}
