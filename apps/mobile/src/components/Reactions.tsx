import { Pressable, Text, View } from 'react-native';
import { REACTION_EMOJI, type ReactionEmoji, type ReactionView } from '@messenger/core';
import { t } from '../i18n';
import { reactionCounts } from '../reaction-model';
import { colors } from '../styles';

/** Pills under a message. Tapping one sets that reaction or takes yours back. */
export function ReactionBar({ reactions, selfId, blocked, names, own, onChoose }: { reactions?: ReactionView[]; selfId?: string; blocked?: ReadonlySet<string>; names: (userId: string) => string; own: boolean; onChoose: (emoji: ReactionEmoji) => void }) {
  const counts = reactionCounts(reactions, selfId, blocked);
  if (!counts.length) return null;
  return <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginTop: 6, alignSelf: own ? 'flex-end' : 'flex-start' }}>
    {counts.map(item => <Pressable key={item.emoji} accessibilityRole="button" accessibilityState={{ selected: item.mine }}
      accessibilityLabel={t('{emoji} {count}: {names}', { emoji: item.emoji, count: item.count, names: item.userIds.map(id => id === selfId ? t('you') : names(id)).join(', ') })}
      accessibilityHint={item.mine ? t('Tap to remove your reaction') : t('Tap to react the same way')}
      onPress={() => onChoose(item.emoji)} hitSlop={4}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 12, borderWidth: 1, borderColor: item.mine ? colors.accent : 'transparent', backgroundColor: item.mine ? '#DDF0E6' : 'rgba(43, 74, 62, 0.08)' }}>
      <Text style={{ fontSize: 15 }}>{item.emoji}</Text>
      {item.count > 1 && <Text style={{ fontSize: 12, fontWeight: '600', color: item.mine ? colors.accent : '#4E7161' }}>{item.count}</Text>}
    </Pressable>)}
  </View>;
}

/** The emoji row at the top of the message menu. Your current choice is highlighted. */
export function ReactionPicker({ current, onChoose }: { current?: ReactionEmoji; onChoose: (emoji: ReactionEmoji) => void }) {
  return <View accessibilityRole="toolbar" accessibilityLabel={t('Reactions')} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
    {REACTION_EMOJI.map(emoji => <Pressable key={emoji} accessibilityRole="button" accessibilityState={{ selected: current === emoji }}
      accessibilityLabel={current === emoji ? t('Remove reaction {emoji}', { emoji }) : t('React with {emoji}', { emoji })} onPress={() => onChoose(emoji)}
      style={{ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: current === emoji ? '#DDF0E6' : 'transparent', borderWidth: current === emoji ? 1 : 0, borderColor: colors.accent }}>
      <Text style={{ fontSize: 25 }}>{emoji}</Text>
    </Pressable>)}
  </View>;
}
