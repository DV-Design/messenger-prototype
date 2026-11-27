/**
 * The text in the message field, read and emptied in one step. When the phone stalls, taps on
 * the send button queue up and all run before the screen redraws; each saw the same text and sent
 * it again (eight copies of one message). Taking the text here lets only the first tap send it.
 */
export class ComposerText {
  constructor(private value = '') {}
  get current() { return this.value; }
  set(text: string) { this.value = text; }
  /** The text to send, or undefined when it is blank or another tap already took it. */
  take(): string | undefined {
    const text = this.value;
    if (!text.trim()) return undefined;
    this.value = '';
    return text;
  }
}

/** One moment when the app did not respond: no message text, only times and labels. */
export interface Stall { at: number; ms: number; busy: string[]; updates: number; state: string }
export const STALL_MS = 1000;
export const MAX_STALLS = 12;

/** Keeps the longest recent stalls, newest last. */
export function addStall(list: readonly Stall[], stall: Stall): Stall[] {
  return [...list, stall].slice(-MAX_STALLS);
}

export function formatStall(stall: Stall, offsetMinutes = 0): string {
  const time = new Date(stall.at - offsetMinutes * 60_000).toISOString().slice(5, 19).replace('T', ' ');
  return `${time} · ${(stall.ms / 1000).toFixed(1)} s · ${stall.state} · ${stall.busy.length ? stall.busy.join(', ') : '—'} · updates ${stall.updates}`;
}
