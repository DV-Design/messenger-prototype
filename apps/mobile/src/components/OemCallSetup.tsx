import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { Button } from './ui';
import { styles } from '../styles';
import { t } from '../i18n';
import { callUiStatus, openCallNotificationSettings, openOemCallSettings } from '../system-calls';

/** vivo keeps its own lock-screen and background switches outside Android's permission APIs. */
export function OemCallSetup() {
  const [vivo, setVivo] = useState(false);
  useEffect(() => { let active = true; void callUiStatus().then(status => { if (active) setVivo(status?.oem === 'vivo'); }); return () => { active = false; }; }, []);
  if (!vivo) return null;
  return <View style={{ gap: 10 }}>
    <Text style={styles.rowName}>{t('Calls on vivo')}</Text>
    <Text style={styles.body}>{t('vivo has its own restrictions. Without these, a call on a locked phone may show only the app icon. In LastCall’s permissions allow display on the lock screen, background pop-ups and autostart, and remove battery restrictions. In the incoming calls notification settings allow lock screen, banners and sound. Names differ between system versions.')}</Text>
    <Button title={t('Open vivo permissions')} secondary onPress={() => openOemCallSettings()} />
    <Button title={t('Incoming call notifications')} secondary onPress={() => openCallNotificationSettings()} />
  </View>;
}
