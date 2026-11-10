/**
 * Decides when the app gives sound/vibration feedback, as Telegram does:
 * an incoming message, a call that connects and a call that ends.
 * Pure logic; playback lives in feedback.ts.
 */
export interface FeedbackConversation { id: string; messages: readonly { id: string; from: string }[]; files: readonly { id: string; senderId: string }[] }
export interface FeedbackSnapshot {
  conversations: readonly FeedbackConversation[];
  blockedContacts: readonly string[];
  activeCall?: { session: { callState: 'idle' | 'outgoing' | 'incoming' | 'active' } };
}
export interface FeedbackState { scope: string; seen: ReadonlySet<string>; callActive: boolean }
export type FeedbackEvent =
  | { kind: 'incoming'; conversationIds: string[] }
  | { kind: 'callConnected' }
  | { kind: 'callEnded' };

/** The first snapshot of an account (or after switching accounts) is a baseline: history already on the phone is not "new". */
export function observeFeedback(previous: FeedbackState | undefined, scope: string, snapshot: FeedbackSnapshot, selfId: string | undefined): { state: FeedbackState; events: FeedbackEvent[] } {
  const blocked = new Set(snapshot.blockedContacts);
  const seen = new Set<string>();
  const fresh = new Set<string>();
  const baseline = !previous || previous.scope !== scope;
  for (const conversation of snapshot.conversations) {
    const incoming = [
      ...conversation.messages.filter(item => item.from !== selfId && !blocked.has(item.from)).map(item => `m:${conversation.id}:${item.id}`),
      ...conversation.files.filter(item => item.senderId !== selfId && !blocked.has(item.senderId)).map(item => `f:${conversation.id}:${item.id}`),
    ];
    for (const key of incoming) {
      seen.add(key);
      if (!baseline && !previous.seen.has(key)) fresh.add(conversation.id);
    }
  }
  const callActive = snapshot.activeCall?.session.callState === 'active';
  const events: FeedbackEvent[] = [];
  if (fresh.size) events.push({ kind: 'incoming', conversationIds: [...fresh] });
  if (!baseline && callActive && !previous.callActive) events.push({ kind: 'callConnected' });
  if (!baseline && !callActive && previous.callActive) events.push({ kind: 'callEnded' });
  return { state: { scope, seen, callActive }, events };
}

export type IncomingCue = 'chat' | 'app' | 'none';
/** In the open chat: the in-chat sound only. Elsewhere in the open app: sound and a short vibration. In a call or in the background: nothing (the notification handles it). */
export function incomingCue(conversationIds: readonly string[], openChat: string | undefined, foreground: boolean, inCall: boolean): IncomingCue {
  if (!foreground || inCall || !conversationIds.length) return 'none';
  return openChat && conversationIds.every(id => id === openChat) ? 'chat' : 'app';
}

/** At most one cue per interval, so syncing a backlog plays once instead of a burst. */
export class CueThrottle {
  private last = -Infinity;
  constructor(private readonly intervalMs: number) {}
  allow(now: number): boolean {
    if (now - this.last < this.intervalMs) return false;
    this.last = now;
    return true;
  }
}
