import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { colors, styles } from '../styles';
import { t } from '../i18n';

/** The fallback when the link does not reach the bot: the person types this code into the bot. */
export function TelegramCode({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  return <View style={{ gap: 6, padding: 12, borderRadius: 12, backgroundColor: '#F4F6F8' }}>
    <Text style={styles.info}>{t('If Telegram closes by itself, open @LastCall_app_bot in Telegram and send it this code:')}</Text>
    <Pressable accessibilityRole="button" accessibilityLabel={t('Copy code {code}', { code })} onPress={() => { void Clipboard.setStringAsync(code).then(() => setCopied(true)); }}>
      <Text selectable style={{ fontSize: 26, fontWeight: '700', letterSpacing: 3, color: colors.text, textAlign: 'center' }}>{code}</Text>
      <Text style={[styles.info, { textAlign: 'center', color: colors.accent }]}>{copied ? t('Copied') : t('Tap to copy')}</Text>
    </Pressable>
  </View>;
}
