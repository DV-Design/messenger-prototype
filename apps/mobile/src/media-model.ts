export type MediaKind = 'voice' | 'circle';
export const MAX_MEDIA_BYTES = 5 * 1024 * 1024;
export const MEDIA_SECONDS = { voice: 120, circle: 30 } as const;
export function mediaKind(name: string, mime: string): MediaKind | undefined {
  if (/^lastcall-voice-[a-f0-9]{32}\.m4a$/.test(name) && mime === 'audio/mp4') return 'voice';
  if (/^lastcall-circle-[a-f0-9]{32}\.mp4$/.test(name) && mime === 'video/mp4') return 'circle';
  if (/^lastcall-circle-[a-f0-9]{32}\.mov$/.test(name) && mime === 'video/quicktime') return 'circle';
}
export function mediaMetadata(kind: MediaKind, nonce: string, uri: string) {
  if (!/^[a-f0-9]{32}$/.test(nonce)) throw new Error('Некорректный идентификатор записи.');
  const mov = kind === 'circle' && uri.toLowerCase().endsWith('.mov');
  return { name: `lastcall-${kind}-${nonce}.${kind === 'voice' ? 'm4a' : mov ? 'mov' : 'mp4'}`, mime: kind === 'voice' ? 'audio/mp4' : mov ? 'video/quicktime' : 'video/mp4' };
}
export function validateMedia(size: number, duration: number, kind: MediaKind) {
  if (!Number.isFinite(size) || size <= 0 || size > MAX_MEDIA_BYTES) throw new Error('Запись должна быть не больше 5 МиБ.');
  if (!Number.isFinite(duration) || duration < 0.25 || duration > MEDIA_SECONDS[kind] + 0.5) throw new Error('Запись слишком короткая или превышает допустимое время.');
}
/** Revocation is permanent: late permission/record/read results must never send. */
export function createMediaScope() {
  let active = true;
  return { get active() { return active; }, cancel() { active = false; }, assert() { if (!active) throw new Error('Запись отменена.'); } };
}
export async function readMediaForSend(metadata: { name: string; mime: string }, size: number, read: () => Promise<Uint8Array>, scope: ReturnType<typeof createMediaScope>) {
  scope.assert();
  if (!mediaKind(metadata.name, metadata.mime)) throw new Error('Неизвестный формат записи.');
  if (!Number.isFinite(size) || size <= 0 || size > MAX_MEDIA_BYTES) throw new Error('Запись отсутствует или больше 5 МиБ.');
  const bytes = await read();
  scope.assert();
  if (!bytes.byteLength || bytes.byteLength > MAX_MEDIA_BYTES) throw new Error('Запись отсутствует или больше 5 МиБ.');
  return bytes;
}
export function mediaTime(seconds: number) {
  const value = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`;
}

/** Avoid reopening Android's permission Activity for access already granted elsewhere. */
export async function mediaPermission<T extends { granted: boolean; canAskAgain?: boolean }>(read: () => Promise<T>, request: () => Promise<T>, assertAllowed: () => void): Promise<T> {
  const current = await read(); assertAllowed();
  if (current.granted || current.canAskAgain === false) return current;
  const result = await request(); assertAllowed(); return result;
}
