import type { Conversation } from '@messenger/core';
export type NotificationDestination = { conversationId: string; scope: string };
export function parseNotificationDestination(value: unknown): NotificationDestination | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const data = value as Record<string, unknown>;
  if (Object.keys(data).length !== 2 || typeof data.conversationId !== 'string' || !/^(?:dm:[a-f0-9]{64}|group:[a-f0-9]{32})$/.test(data.conversationId)
    || typeof data.scope !== 'string' || !/^[a-f0-9]{64}$/.test(data.scope)) return null;
  return { conversationId: data.conversationId, scope: data.scope };
}
/** One explicit tap waits for local encrypted history; receipt itself never enters this queue. */
export class NotificationNavigationQueue {
  private pending?: NotificationDestination & { until: number };
  constructor(private readonly now = Date.now) {}
  offer(value: unknown): boolean {
    const destination = parseNotificationDestination(value);
    if (!destination) return false;
    this.pending = { ...destination, until: this.now() + 60_000 }; return true;
  }
  take(input: { ready: boolean; scope: string; userId: string; conversations: Pick<Conversation, 'id' | 'memberIds'>[] }): string | null {
    const pending = this.pending;
    if (!pending) return null;
    if (pending.until <= this.now()) { this.pending = undefined; return null; }
    if (!input.ready) return null;
    if (input.scope !== pending.scope) { this.pending = undefined; return null; }
    const conversation = input.conversations.find(item => item.id === pending.conversationId);
    if (!conversation) return null;
    this.pending = undefined;
    return conversation.memberIds.includes(input.userId) ? conversation.id : null;
  }
}
