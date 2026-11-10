import { REACTION_EMOJI, type ReactionEmoji, type ReactionView } from '@messenger/core';

export interface ReactionCount { emoji: ReactionEmoji; count: number; mine: boolean; userIds: string[] }

/** One pill per emoji in the picker's order. Reactions from blocked people are not shown or counted. */
export function reactionCounts(reactions: readonly ReactionView[] | undefined, selfId: string | undefined, blocked: ReadonlySet<string> = new Set()): ReactionCount[] {
  const visible = (reactions ?? []).filter(item => !blocked.has(item.userId));
  return REACTION_EMOJI.flatMap(emoji => {
    const userIds = visible.filter(item => item.emoji === emoji).map(item => item.userId);
    return userIds.length ? [{ emoji, count: userIds.length, mine: !!selfId && userIds.includes(selfId), userIds }] : [];
  });
}

export function myReaction(reactions: readonly ReactionView[] | undefined, selfId: string | undefined): ReactionEmoji | undefined {
  return selfId ? reactions?.find(item => item.userId === selfId)?.emoji : undefined;
}

/** Like Telegram and WhatsApp: choosing your current reaction again takes it back; anything else replaces it. */
export function nextReaction(current: ReactionEmoji | undefined, chosen: ReactionEmoji): ReactionEmoji | undefined {
  return current === chosen ? undefined : chosen;
}
