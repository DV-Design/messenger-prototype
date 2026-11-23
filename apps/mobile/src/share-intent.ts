import { File, Paths } from 'expo-file-system';
import type { SharedItem } from './share-intent-model';

/** The one share waiting for a chat to be picked. A new share replaces it and removes its copies. */
let current: SharedItem | null = null;
const listeners = new Set<() => void>();
export function pendingShare(): SharedItem | null { return current; }
export function setPendingShare(next: SharedItem | null, keepFiles = false) {
  if (current && !keepFiles) discardCopies(current, next);
  current = next; listeners.forEach(listener => listener());
}
export function onPendingShare(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
/** The sharing app's files were copied into this app's cache; nothing outside the cache is touched. */
function discardCopies(item: SharedItem, keep: SharedItem | null) {
  const cache = `${Paths.cache.uri.replace(/\/$/, '')}/`;
  for (const file of item.files) {
    if (!file.uri.startsWith(cache) || keep?.files.some(other => other.uri === file.uri)) continue;
    try { const copy = new File(file.uri); if (copy.exists) copy.delete(); } catch { /* best effort */ }
  }
}
