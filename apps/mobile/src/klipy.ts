import Constants from 'expo-constants';
import * as Crypto from 'expo-crypto';
import { File, Paths } from 'expo-file-system';
import { intlLocale } from './i18n';
import type { GifRef } from './sticker-model';

/**
 * GIF and sticker search through KLIPY, called straight from the phone (no load on our server).
 * KLIPY sees the phone's address, the search words and a random id of this installation, never the
 * account. No advertising parameters are sent; ad items, if any, are dropped.
 */
const KEY = String(Constants.expoConfig?.extra?.klipyKey ?? '');
export const klipyEnabled = /^[A-Za-z0-9_-]{16,128}$/.test(KEY);
export type KlipyKind = 'gifs' | 'stickers';
export type KlipyItem = { slug: string; title: string; preview: GifRef; send: GifRef };

let customer: string | undefined;
/** A random id for this installation only (KLIPY needs one for recents); not tied to the account. */
function customerId(): string {
  if (customer) return customer;
  const file = new File(Paths.document, 'klipy-customer-id');
  try { if (file.exists) { const saved = file.textSync().trim(); if (/^[a-f0-9]{32}$/.test(saved)) return (customer = saved); } } catch { /* make a new one */ }
  customer = Array.from(Crypto.getRandomBytes(16), byte => byte.toString(16).padStart(2, '0')).join('');
  try { file.write(customer); } catch { /* kept for this run */ }
  return customer;
}

type Media = { url?: string; width?: number; height?: number };
type Sizes = Partial<Record<'hd' | 'md' | 'sm' | 'xs', Partial<Record<'gif' | 'webp' | 'mp4' | 'png', Media>>>>;
function pick(file: Sizes | undefined, order: ('hd' | 'md' | 'sm' | 'xs')[]): GifRef | undefined {
  for (const size of order) for (const format of ['webp', 'gif', 'png'] as const) {
    const media = file?.[size]?.[format];
    if (media?.url && /^https:\/\//.test(media.url)) return { url: media.url, width: media.width || 1, height: media.height || 1 };
  }
  return undefined;
}

export async function klipyList(kind: KlipyKind, query: string, page = 1, signal?: AbortSignal): Promise<{ items: KlipyItem[]; more: boolean }> {
  if (!klipyEnabled) return { items: [], more: false };
  const params = new URLSearchParams({ page: String(page), per_page: '24', customer_id: customerId(), locale: intlLocale.split('-')[0] ?? 'en' });
  if (query.trim()) params.set('q', query.trim().slice(0, 100));
  const response = await fetch(`https://api.klipy.com/api/v1/${KEY}/${kind}/${query.trim() ? 'search' : 'trending'}?${params}`, { signal });
  if (!response.ok) throw new Error(`KLIPY ${response.status}`);
  const body = await response.json() as { data?: { data?: { slug?: string; title?: string; type?: string; file?: Sizes }[]; has_next?: boolean } };
  const items: KlipyItem[] = [];
  for (const item of body.data?.data ?? []) {
    if (!item.slug || item.type === 'ad') continue;
    const preview = pick(item.file, ['sm', 'xs', 'md']); const send = pick(item.file, ['md', 'sm', 'hd']);
    if (preview && send) items.push({ slug: item.slug, title: item.title ?? '', preview, send });
  }
  return { items, more: !!body.data?.has_next };
}

/** KLIPY counts shares (their terms); failures are ignored. */
export function klipyShared(kind: KlipyKind, slug: string) {
  if (!klipyEnabled) return;
  void fetch(`https://api.klipy.com/api/v1/${KEY}/${kind}/share/${encodeURIComponent(slug)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ customer_id: customerId() }) }).catch(() => {});
}
