import { useEffect, useState } from 'react';
import { AppState, Modal, Platform, Text, View } from 'react-native';
import { useMessenger } from '../runtime';
import { dismissUpdate, downloadAndInstallUpdate, maybeAutoCheck, useUpdateState } from '../updates';
import { colors, styles } from '../styles';
import { Button, Icon } from './ui';

/**
 * A session-scoped offer to install a newer official APK. It never installs
 * anything itself and stays out of the way of active or ringing calls.
 */
export function UpdateNotice() {
  const { profile, snapshot } = useMessenger();
  const updateState = useUpdateState();
  const [failure, setFailure] = useState<{ versionCode: number; text: string }>();
  const [installing, setInstalling] = useState(false);
  const enabled = Platform.OS === 'android' && !!profile;

  useEffect(() => {
    if (!enabled) return;
    void maybeAutoCheck();
    const subscription = AppState.addEventListener('change', value => { if (value === 'active') void maybeAutoCheck(); });
    return () => subscription.remove();
  }, [enabled]);

  const update = updateState.status === 'available' ? updateState.update : undefined;
  const callState = snapshot.activeCall?.session.callState;
  const busy = (!!callState && callState !== 'idle') || !!snapshot.pendingIncomingCall;
  if (!enabled || !update || busy || updateState.dismissedVersionCode === update.versionCode) return null;
  const available = update;

  const error = failure && failure.versionCode === available.versionCode ? failure.text : '';
  async function download() {
    if (installing) return;
    setInstalling(true); setFailure(undefined);
    try {
      await downloadAndInstallUpdate(available);
    } catch {
      setFailure({ versionCode: available.versionCode, text: 'Не удалось скачать или проверить обновление. Повторите позже.' });
    } finally {
      setInstalling(false);
    }
  }

  return <Modal visible transparent animationType="fade" statusBarTranslucent onRequestClose={dismissUpdate}>
    <View style={{ flex: 1, backgroundColor: '#00000066', justifyContent: 'center', padding: 24 }}>
      <View accessibilityViewIsModal style={{ backgroundColor: colors.white, borderRadius: 22, padding: 22, gap: 14 }}>
        <View style={{ alignSelf: 'center', width: 64, height: 64, borderRadius: 20, backgroundColor: '#E4F1EC', alignItems: 'center', justifyContent: 'center' }}><Icon name="cloud-download-outline" size={31} /></View>
        <Text accessibilityRole="header" style={{ color: colors.text, fontSize: 21, fontWeight: '700', textAlign: 'center' }}>Доступно обновление</Text>
        <Text style={styles.body}>LastCall {available.version} уже вышла. Сейчас установлена {updateState.currentVersion || 'предыдущая версия'}.</Text>
        {!!available.notes && <Text style={styles.info}>{available.notes}</Text>}
        <Text style={styles.info}>APK скачается в приложении, SHA-256 сверится с манифестом, затем откроется системный установщик. Профиль, ключ, контакты и история сохранятся.</Text>
        {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
        <Button title={installing ? 'Скачиваем и проверяем…' : `Скачать и установить ${available.version}`} busy={installing} onPress={() => void download()} />
        <Button title="Позже" secondary disabled={installing} onPress={dismissUpdate} />
      </View>
    </View>
  </Modal>;
}
