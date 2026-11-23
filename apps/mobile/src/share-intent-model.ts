import { MAX_TEXT_CHARS } from '@messenger/core';

/** What another app handed to LastCall through "Share" or the text selection menu. */
export interface SharedItem { text: string | null; files: SharedFile[]; /** Files the sharing app offered but did not let LastCall read. */ failed?: number }
export interface SharedFile { uri: string; name: string; mime: string; size: number | null }
export const MAX_SHARED_FILES = 10;
const MAX_SHARED_TEXT = 4 * MAX_TEXT_CHARS;

type Incoming = { text?: string | null; webUrl?: string | null; failed?: number; files?: { path?: string | null; fileName?: string | null; mimeType?: string | null; size?: number | string | null }[] | null } | null | undefined;

/** Only local copies in this app's storage are accepted; names are reduced to a safe last segment. */
export function sharedItem(value: Incoming): SharedItem | null {
  if (!value) return null;
  const text = typeof value.text === 'string' && value.text.trim() ? value.text.trim().slice(0, MAX_SHARED_TEXT) : (typeof value.webUrl === 'string' && value.webUrl.trim() ? value.webUrl.trim() : null);
  const files: SharedFile[] = [];
  for (const file of value.files ?? []) {
    if (files.length >= MAX_SHARED_FILES) break;
    const path = typeof file?.path === 'string' ? file.path : '';
    if (!path) continue;
    const uri = path.startsWith('file://') ? path : path.startsWith('/') ? `file://${path}` : '';
    if (!uri) continue;
    const name = (typeof file.fileName === 'string' && file.fileName.split(/[\\/]/).pop()?.trim()) || uri.split('/').pop() || 'file';
    files.push({ uri, name: name.slice(0, 255), mime: (typeof file.mimeType === 'string' && file.mimeType.length <= 127 ? file.mimeType : '') || 'application/octet-stream', size: typeof file.size === 'number' && Number.isFinite(file.size) ? file.size : (typeof file.size === 'string' && /^\d+$/.test(file.size) ? Number(file.size) : null) });
  }
  if (!text && !files.length) return null;
  const failed = typeof value.failed === 'number' && value.failed > 0 ? Math.floor(value.failed) : 0;
  return failed ? { text, files, failed } : { text, files };
}

/** A long shared text goes as several messages, split on line or word breaks where possible. */
export function splitText(text: string, limit = MAX_TEXT_CHARS): string[] {
  const parts: string[] = []; let rest = text.trim();
  while (rest.length > limit) {
    const window = rest.slice(0, limit);
    const at = Math.max(window.lastIndexOf('\n'), window.lastIndexOf(' '));
    const cut = at > limit / 2 ? at : limit;
    parts.push(rest.slice(0, cut).trim()); rest = rest.slice(cut).trim();
  }
  if (rest) parts.push(rest);
  return parts;
}

/** Conversations a share may go to: newest first, without groups this phone was removed from. */
export function shareTargets<T extends { id: string; title: string; removed?: boolean; updatedAt: number; hidden?: boolean }>(conversations: readonly T[], query = ''): T[] {
  const needle = query.trim().toLowerCase();
  return conversations.filter(item => !item.removed && (!needle || item.title.toLowerCase().includes(needle))).sort((a, b) => b.updatedAt - a.updatedAt);
}
