/** Pure geometry for Telegram-style swipe-to-reply: drag a message left, release past the threshold. */
export const SWIPE_REPLY_MAX = 72;
export const SWIPE_REPLY_TRIGGER = 52;

/** Only a deliberate leftward, mostly horizontal drag is a reply swipe; anything else stays a scroll or a tap. */
export function isReplySwipe(dx: number, dy: number): boolean {
  return dx < -10 && Math.abs(dx) > Math.abs(dy) * 1.8;
}

/** Follows the finger 1:1 up to the threshold, then with resistance, never past the max or to the right. */
export function swipeReplyOffset(dx: number): number {
  if (dx >= 0) return 0;
  const pull = -dx;
  const eased = pull <= SWIPE_REPLY_TRIGGER ? pull : SWIPE_REPLY_TRIGGER + (pull - SWIPE_REPLY_TRIGGER) * 0.35;
  return -Math.min(SWIPE_REPLY_MAX, eased);
}

export function swipeReplyTriggered(dx: number): boolean { return -swipeReplyOffset(dx) >= SWIPE_REPLY_TRIGGER; }
