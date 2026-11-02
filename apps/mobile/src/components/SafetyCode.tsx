import { Modal, Text, View } from 'react-native';
import { colors, styles } from '../styles';
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
          <View style={styles.flex}><Text accessibilityRole="header" style={{ color: colors.text, fontSize: 20, fontWeight: '700' }}>Код безопасности</Text><Text style={styles.info}>{title}</Text></View>
          <IconButton name="close" label="Закрыть код безопасности" onPress={onClose} />
        </View>
        <Text selectable accessibilityLabel={`Код безопасности: ${code}`} style={{ color: colors.text, fontSize: 38, lineHeight: 50, letterSpacing: 4, textAlign: 'center' }}>{code}</Text>
        <Text style={styles.body}>Сверьте эти эмодзи с собеседником по другому каналу — голосом или лично. Совпадающая последовательность подтверждает, что ключи не подменены.</Text>
        <Text style={styles.info}>{sessionReady ? 'Текущее соединение использует E2E-шифрование контента.' : 'E2E-сессия ещё не установлена. Сообщения не отправятся, пока собеседник не обновит LastCall.'}</Text>
        {verified ? <Text style={[styles.info, { color: colors.accent }]}>Ключ отмечен как сверенный.</Text> : <Button title="Я сверил(а) код" onPress={onVerify} />}
      </View>
    </View>
  </Modal>;
}
