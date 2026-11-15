import { t } from './i18n';
import { parseContactText, parseLocationText } from './location-contact';

/**
 * A reply is a plain text message whose text opens with a recognizable, backward-compatible
 * marker line naming the quoted record (type/author/id), the same convention as
 * location-contact.ts: no core/protocol change, no stored-state version bump. An older
 * client shows the marker line as plain (if odd-looking) text, with the actual reply body
 * right below it, fully readable either way.
 */
const REPLY_RE = /^↩️ (message|file):([0-9a-f]{64}):([0-9a-f]{32})\n([\s\S]*)$/;

export interface ReplyTarget { type: 'message' | 'file'; author: string; id: string }
export interface ParsedReply extends ReplyTarget { text: string }

export function formatReplyText(target: ReplyTarget, text: string): string {
  return `↩️ ${target.type}:${target.author}:${target.id}\n${text}`;
}

export function parseReplyText(text: string): ParsedReply | undefined {
  const match = REPLY_RE.exec(text);
  if (!match) return;
  const [, type, author, id, body] = match;
  if (!author || !id || body === undefined) return;
  return { type: type as 'message' | 'file', author, id, text: body };
}

/** The reply body with any one level of its own quote marker stripped, for a message's own rendering. */
export const replyBody = (text: string): string => parseReplyText(text)?.text ?? text;

/** A short, one-line description of a quoted message's text content (not used for a quoted file). */
export function quotedMessageSnippet(text: string): string {
  const body = replyBody(text);
  const location = parseLocationText(body);
  if (location) return location.live ? t('Live location') : t('Location');
  const contact = parseContactText(body);
  if (contact) return `👤 ${contact.name}`;
  return body.replace(/\s+/g, ' ').trim();
}
