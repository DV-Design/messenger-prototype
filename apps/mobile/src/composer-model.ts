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
