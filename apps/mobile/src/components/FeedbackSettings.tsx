import { useEffect, useState } from 'react';
import { Switch, Text, View } from 'react-native';
import { styles, colors } from '../styles';
import { t } from '../i18n';
import { Icon } from './ui';
import { haptic, loadFeedbackPreferences, onFeedbackPreferences, playSound, saveFeedbackPreferences, type FeedbackPreferences } from '../feedback';

export function FeedbackSettings() {
  const [value, setValue] = useState<FeedbackPreferences>();
  useEffect(() => { let live = true; void loadFeedbackPreferences().then(next => { if (live) setValue(next); }); const off = onFeedbackPreferences(setValue); return () => { live = false; off(); }; }, []);
  if (!value) return null;
  function change(next: FeedbackPreferences) {
    void saveFeedbackPreferences(next).catch(() => {});
    if (next.haptics && !value!.haptics) haptic('confirm');
    if (next.sounds && !value!.sounds) playSound('incoming');
  }
  return <>
    <Text style={styles.sectionTitle}>{t('SOUNDS AND VIBRATION')}</Text>
    <View style={[styles.section, { marginTop: 0 }]}>
      <View style={styles.listRow}><Icon name="musical-notes-outline" /><View style={styles.rowBody}><Text style={styles.rowName}>{t('Sounds in chats')}</Text><Text style={styles.rowText}>{t('When a message is sent or arrives while the app is open. Silent when the phone is on silent.')}</Text></View>
        <Switch accessibilityLabel={t('Sounds in chats')} value={value.sounds} onValueChange={sounds => change({ ...value, sounds })} trackColor={{ true: colors.accent }} /></View>
      <View style={styles.listRow}><Icon name="phone-portrait-outline" /><View style={styles.rowBody}><Text style={styles.rowName}>{t('Vibration feedback')}</Text><Text style={styles.rowText}>{t('Holding a message, reactions, recording, connected and ended calls.')}</Text></View>
        <Switch accessibilityLabel={t('Vibration feedback')} value={value.haptics} onValueChange={haptics => change({ ...value, haptics })} trackColor={{ true: colors.accent }} /></View>
    </View>
  </>;
}
