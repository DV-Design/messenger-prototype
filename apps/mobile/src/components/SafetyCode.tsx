import { Modal, Text, View } from 'react-native';
import { colors, styles } from '../styles';
import { t } from '../i18n';
import { Button, Icon, IconButton } from './ui';

export function SafetyCode({ visible, title, code, verified, sessionReady, onVerify, onClose }: {
  visible: boolean;
  title: string;
  code: string;
  verified: boolean;
  sessionReady: boolean;
  onVerify: () => void;
  onClose: () => void;
}) {
  return <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
    <View style={{ flex: 1, backgroundColor: '#00000066', justifyContent: 'center', padding: 24 }}>
      <View accessibilityViewIsModal style={{ backgroundColor: colors.white, borderRadius: 22, padding: 22, gap: 14 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <View style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: '#E4F1EC', alignItems: 'center', justifyContent: 'center' }}><Icon name={verified ? 'shield-checkmark' : 'shield-outline'} size={25} /></View>
          <View style={styles.flex}><Text accessibilityRole="header" style={{ color: colors.text, fontSize: 20, fontWeight: '700' }}> {t('Safety code')}</Text><Text style={styles.info}>{title}</Text></View>
          <IconButton name="close" label={t('Close safety code')} onPress={onClose} />
        </View>
        <Text selectable accessibilityLabel={t('Safety code: {code}', { code })} style={{ color: colors.text, fontSize: 38, lineHeight: 50, letterSpacing: 4, textAlign: 'center' }}>{code}</Text>
        <Text style={styles.body}> {t('Compare these emoji with your contact over another channel, by voice or in person. A matching sequence confirms the keys were not substituted.')}</Text>
        <Text style={styles.info}>{sessionReady ? t('This connection uses end-to-end content encryption.') : t('The end-to-end session is not established yet. Messages will not send until your contact updates LastCall.')}</Text>
        {verified ? <Text style={[styles.info, { color: colors.accent }]}> {t('Key marked as verified.')}</Text> : <Button title={t('I have compared the code')} onPress={onVerify} />}
      </View>
    </View>
  </Modal>;
}
