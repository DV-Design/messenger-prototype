import { LinkifyIt } from 'linkify-it';

export type MessagePart = { text: string; url?: string };
const OPENABLE = new Set(['http:', 'https:', 'mailto:']);
// Bare domains such as lienad.ru link as in Telegram; IP addresses and version numbers do not.
const linkify = new LinkifyIt({ fuzzyLink: true, fuzzyEmail: true, fuzzyIP: false }).add('ftp:', null).add('//', null);

/** Splits message text into plain runs and links that open in the browser or mail app. Nothing else is linked. */
export function messageParts(text: string): MessagePart[] {
  const matches = linkify.match(text) ?? [];
  const parts: MessagePart[] = []; let at = 0;
  for (const match of matches) {
    let url: URL;
    try { url = new URL(match.url); } catch { continue; }
    if (!OPENABLE.has(url.protocol)) continue;
    if (match.index > at) parts.push({ text: text.slice(at, match.index) });
    parts.push({ text: match.raw, url: match.url });
    at = match.lastIndex;
  }
  if (at < text.length || !parts.length) parts.push({ text: text.slice(at) });
  return parts;
}
