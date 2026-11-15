import { Pressable, Text, View } from 'react-native';
import { t } from '../i18n';
import { colors } from '../styles';
import { IconButton } from './ui';

/**
 * Telegram-style quote strip: a colored bar, the quoted author's name and a one-line snippet.
 * Used both above the composer while replying (with a close button) and inside a sent
 * message's own bubble, above its text (tappable, to jump to the quoted message).
 */
export function ReplyChip({ authorName, text, own, onPress, onClose }: {
  authorName: string;
  text: string;
  /** Tints the bar like an outgoing accent when the chip sits inside one's own bubble. */
  own?: boolean;
  onPress?: () => void;
  onClose?: () => void;
}) {
  const content = <View style={{ flexDirection: 'row', alignItems: 'stretch', gap: 8, paddingVertical: 4 }}>
    <View style={{ width: 3, borderRadius: 2, backgroundColor: own ? colors.text : colors.accent }} />
    <View style={{ flex: 1, paddingVertical: 1 }}>
      <Text numberOfLines={1} style={{ color: own ? colors.text : colors.accent, fontWeight: '600', fontSize: 13 }}>{authorName}</Text>
      <Text numberOfLines={1} style={{ color: colors.secondary, fontSize: 13 }}>{text}</Text>
    </View>
    {onClose && <IconButton name="close" label={t('Cancel reply')} onPress={onClose} />}
  </View>;
  return onPress
    ? <Pressable accessibilityRole="button" accessibilityLabel={t('Go to the quoted message')} onPress={onPress}>{content}</Pressable>
    : content;
}
