import { Directory, File, FileMode, Paths } from 'expo-file-system';
import type { BulkFileStore, BulkSink } from '@messenger/core';
import { t } from './i18n';

/**
 * Large files (over 5 MiB, up to 1 GiB) live as ordinary files in the app's private documents,
 * one folder per attachment key: they stream in and out in 64 KiB chunks and are never held
 * whole in memory or re-encrypted at rest. The key already names author, message and chat, so
 * accounts and chats cannot collide. An unfinished download is `<name>.part` and resumes.
 */
const KEY = /^[0-9a-f]{64}$/;
const FREE_MARGIN = 64 * 1024 * 1024;
const root = () => new Directory(Paths.document, 'lastcall-bulk');
function folder(key: string): Directory {
  if (!KEY.test(key)) throw new Error(t('Invalid attachment key.'));
  return new Directory(root(), key);
}
export function bulkSafeName(name: string): string {
  return name.replace(/[^\p{L}\p{N}._ -]/gu, '_').replace(/^\.+/, '_').slice(0, 120) || 'file';
}
export function bulkFile(key: string, name: string): File { return new File(folder(key), bulkSafeName(name)); }
const partFile = (key: string, name: string) => new File(folder(key), `${bulkSafeName(name)}.part`);

/** Moves a picker's cache copy into place (or copies a file the app does not own), before the outbox records it. */
export function adoptBulkFile(key: string, name: string, sourceUri: string): void {
  const dir = folder(key);
  if (!dir.exists) dir.create({ intermediates: true });
  const source = new File(sourceUri);
  const target = bulkFile(key, name);
  if (target.exists) target.delete();
  if (sourceUri.startsWith(`${Paths.cache.uri.replace(/\/$/, '')}/`)) source.move(target);
  else source.copy(target);
}

export function deleteBulkFiles(key: string): void {
  try { const dir = folder(key); if (dir.exists) dir.delete(); } catch { /* best effort; the key may not be a large file */ }
}
/** Removes large-file folders no record points to any more (a crash between deleting the record and the file). */
export function pruneBulkFiles(keep: ReadonlySet<string>): void {
  try {
    const dir = root(); if (!dir.exists) return;
    for (const item of dir.list()) if (item instanceof Directory && KEY.test(item.name) && !keep.has(item.name)) item.delete();
  } catch { /* best effort */ }
}
export function deleteAllBulkFiles(): void { try { const dir = root(); if (dir.exists) dir.delete(); } catch { /* best effort */ } }

export const bulkFiles: BulkFileStore = {
  async read(key, name, offset, length) {
    const handle = bulkFile(key, name).open(FileMode.ReadOnly);
    try { handle.offset = offset; return await handle.readBytes(length); } finally { handle.close(); }
  },
  async openIncoming(key, name, size): Promise<BulkSink> {
    const final = bulkFile(key, name);
    // Already complete (the sender missed our acknowledgement): confirm without rewriting.
    if (final.exists && final.size === size) return { offset: size, write: async () => { throw new Error('File already complete'); }, finish: async () => {}, abort: async () => {} };
    const dir = folder(key);
    if (!dir.exists) dir.create({ intermediates: true });
    const part = partFile(key, name);
    if (!part.exists) part.create();
    const offset = Math.min(part.size ?? 0, size);
    if (Paths.availableDiskSpace < size - offset + FREE_MARGIN) throw new Error(t('Not enough free space on the phone. Free some space and try again.'));
    let handle: ReturnType<File['open']> | undefined = part.open(FileMode.ReadWrite);
    handle.offset = offset;
    const close = () => { try { handle?.close(); } catch { /* already closed */ } handle = undefined; };
    return {
      offset,
      write: async bytes => { if (!handle) throw new Error('Large file is closed'); await handle.writeBytes(bytes); },
      finish: async () => { close(); if (final.exists) final.delete(); part.move(final); },
      abort: async () => { close(); deleteBulkFiles(key); },
      pause: close,
    };
  },
};
