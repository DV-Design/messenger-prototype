/**
 * Stickers and GIFs travel as ordinary text messages (through the encrypted mailbox, no file
 * transfer), marked by an invisible separator so older apps simply show the emoji or the link.
 *
 * - Sticker: MARK + the emoji. The animation is bundled in the app (Noto, CC BY 4.0).
 * - GIF: MARK + the KLIPY media URL with its size as a fragment, e.g. `#lc=480x270`. The phone that
 *   shows it loads it from KLIPY's CDN.
 */
export const STICKER_MARK = '⁣';

export function formatSticker(emoji: string): string { return STICKER_MARK + emoji; }
/** The emoji of a sticker message, if this is one and the app has its animation. */
export function parseSticker(text: string, known: (emoji: string) => boolean): string | undefined {
  if (!text.startsWith(STICKER_MARK)) return undefined;
  const emoji = text.slice(STICKER_MARK.length);
  return emoji && emoji.length <= 16 && known(emoji) ? emoji : undefined;
}

/** `sticker`: a transparent KLIPY sticker, shown without a frame. */
export type GifRef = { url: string; width: number; height: number; sticker?: boolean };
const GIF_HOST = /^https:\/\/([a-z0-9-]+\.)*klipy\.com\//i;
export function formatGif(gif: GifRef): string {
  const width = Math.max(1, Math.round(gif.width)); const height = Math.max(1, Math.round(gif.height));
  return `${STICKER_MARK}${gif.url.split('#')[0]}#lc=${width}x${height}${gif.sticker ? ',s' : ''}`;
}
/** Only KLIPY's own HTTPS hosts are shown inline; anything else stays an ordinary link. */
export function parseGif(text: string): GifRef | undefined {
  if (!text.startsWith(STICKER_MARK)) return undefined;
  const value = text.slice(STICKER_MARK.length).trim();
  if (value.length > 2000 || /\s/.test(value) || !GIF_HOST.test(value)) return undefined;
  const [url, fragment = ''] = value.split('#');
  const size = /^lc=(\d{1,4})x(\d{1,4})(,s)?$/.exec(fragment);
  const width = size ? Number(size[1]) : 1; const height = size ? Number(size[2]) : 1;
  return { url: url!, width: width || 1, height: height || 1, ...(size?.[3] ? { sticker: true } : {}) };
}

/** Chat list and reply previews: a word instead of the mark and the link. */
export function richPreview(text: string, known: (emoji: string) => boolean, words: { sticker: string; gif: string }): string | undefined {
  const sticker = parseSticker(text, known);
  if (sticker) return `${sticker} ${words.sticker}`;
  if (parseGif(text)) return words.gif;
  return undefined;
}
