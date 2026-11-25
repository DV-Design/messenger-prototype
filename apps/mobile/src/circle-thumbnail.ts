import { useEffect, useState } from 'react';
import * as Crypto from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';
import { getThumbnailAsync } from 'expo-video-thumbnails';
import type { MessengerFile } from '@messenger/core';
import { deleteMediaCache, loadFileData } from './attachments';
import { MAX_MEDIA_BYTES } from './media-model';

/**
 * The first frame of a video circle, shown while it is not playing (as Telegram does), instead of a
 * dark disc. Made once from the stored recording, kept as a small JPEG in the app cache and reused.
 */
const folder = () => new Directory(Paths.cache, 'lastcall-thumbs');
const made = new Map<string, string | null>();
const pending = new Map<string, Promise<string | null>>();

function stableName(key: string) {
  // The file key holds chat and user ids; the cache file name does not need to.
  let hash = 2166136261;
  for (let i = 0; i < key.length; i++) { hash ^= key.charCodeAt(i); hash = Math.imul(hash, 16777619) >>> 0; }
  return `${hash.toString(16)}-${key.length}.jpg`;
}

async function makeThumbnail(file: MessengerFile, key: string): Promise<string | null> {
  const dir = folder();
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  const target = new File(dir, stableName(key));
  if (target.exists) return target.uri;
  const nonce = Array.from(Crypto.getRandomBytes(12), byte => byte.toString(16).padStart(2, '0')).join('');
  const video = new File(Paths.cache, `lastcall-media-play-thumb-${nonce}.${file.mime === 'video/quicktime' ? 'mov' : 'mp4'}`);
  try {
    const bytes = await loadFileData(file);
    if (!bytes?.byteLength || bytes.byteLength > MAX_MEDIA_BYTES) return null;
    await video.write(bytes);
    const result = await getThumbnailAsync(video.uri, { time: 0, quality: 0.6 });
    const frame = new File(result.uri);
    if (target.exists) target.delete();
    frame.move(target);
    return target.uri;
  } catch { return null; } finally { deleteMediaCache(video.uri); }
}

export function useCircleThumbnail(file: MessengerFile, enabled: boolean): string | undefined {
  const key = `${file.conversationId}:${file.senderId}:${file.id}`;
  const [, setVersion] = useState(0);
  const value = made.get(key);
  useEffect(() => {
    if (!enabled || made.has(key)) return;
    let canceled = false;
    let job = pending.get(key);
    if (!job) { job = makeThumbnail(file, key).then(uri => { made.set(key, uri); pending.delete(key); return uri; }); pending.set(key, job); }
    void job.then(() => { if (!canceled) setVersion(version => version + 1); });
    return () => { canceled = true; };
    // The file object changes with every delivery tick; its key identifies the recording.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, key]);
  return value ?? undefined;
}

/** Previews older than a week are made again when needed. */
export function pruneCircleThumbnails() {
  try {
    const dir = folder();
    if (!dir.exists) return;
    for (const item of dir.list()) if (item instanceof File && Date.now() - (item.modificationTime ?? 0) > 7 * 86_400_000) item.delete();
  } catch { /* best effort */ }
}
