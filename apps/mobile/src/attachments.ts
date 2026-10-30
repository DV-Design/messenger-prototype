import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import * as Sharing from 'expo-sharing';
import { Directory, File, Paths } from 'expo-file-system';
import type { MessengerClient, MessengerFile } from '@messenger/core';
import { client } from './runtime';
import { readMediaForSend, type createMediaScope } from './media-model';
const MAX_FILE = 5 * 1024 * 1024;
async function transmit(current: MessengerClient, conversationId: string, uri: string, name: string, mime: string, reportedSize?: number) {
  const file = new File(uri);
  try {
    if ((reportedSize ?? file.size) > MAX_FILE || file.size > MAX_FILE) throw new Error('Можно передавать файлы не больше 5 МиБ.');
    const data = await file.bytes();
    if (data.byteLength > MAX_FILE) throw new Error('Файл больше 5 МиБ.');
    if (client() !== current) throw new Error('Сервер изменён. Откройте чат ещё раз.');
    await current.sendFile(conversationId, { name, mime, data });
  } finally {
    // Remove picker-created cache copies, never the user's original document.
    if (file.uri.startsWith(`${Paths.cache.uri.replace(/\/$/, '')}/`) && file.exists) file.delete();
  }
}
export async function pickDocument(conversationId: string) {
  const current = client();
  const result = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, multiple: false });
  const asset = result.assets?.[0];
  if (!result.canceled && asset) await transmit(current, conversationId, asset.uri, asset.name, asset.mimeType ?? 'application/octet-stream', asset.size);
}
export async function pickMedia(conversationId: string) {
  const current = client();
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) throw new Error('Разрешите выбор фото и видео в настройках телефона.');
  const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images', 'videos'], allowsMultipleSelection: false });
  const asset = result.assets?.[0];
  if (!result.canceled && asset) await transmit(current, conversationId, asset.uri, asset.fileName ?? (asset.type === 'video' ? 'video.mp4' : 'photo.jpg'), asset.mimeType ?? (asset.type === 'video' ? 'video/mp4' : 'image/jpeg'), asset.fileSize);
}
export async function loadFileData(item: MessengerFile): Promise<Uint8Array | null> {
  if (item.deliveryStatus === 'expired') return null;
  const current = client();
  const data = item.data ?? await current.getFileData(item.conversationId, item.id, item.senderId);
  if (client() !== current) throw new Error('Сервер изменён. Откройте чат ещё раз.');
  return data;
}
export function deleteMediaCache(uri?: string | null) {
  if (!uri || !uri.startsWith(`${Paths.cache.uri.replace(/\/$/, '')}/`)) return;
  try { const file = new File(uri); if (file.exists) file.delete(); } catch { /* Cache cleanup is best effort, never delete outside cache. */ }
}
export function pruneMediaCache() {
  // Remove abandoned LastCall copies after a killed process. Native camera cache
  // is used only by this composer; never touch documents or encrypted blobs.
  for (const directory of [new Directory(Paths.cache), new Directory(Paths.cache, 'Audio'), new Directory(Paths.cache, 'ExpoAudio'), new Directory(Paths.cache, 'Camera')]) {
    try {
      if (!directory.exists) continue;
      for (const item of directory.list()) if (item instanceof File && (/^lastcall-(?:voice-|circle-|media-play-)/.test(item.name) || directory.name === 'Camera' && /\.(?:mp4|mov)$/i.test(item.name))) deleteMediaCache(item.uri);
    } catch { /* Cache may be concurrently evicted by the OS. */ }
  }
}
export async function sendRecordedMedia(current: MessengerClient, conversationId: string, draft: { uri: string; name: string; mime: string }, scope: ReturnType<typeof createMediaScope>) {
  const file = new File(draft.uri);
  const data = await readMediaForSend(draft, file.exists ? file.size : 0, () => file.bytes(), scope);
  if (client() !== current) throw new Error('Сервер изменён. Откройте чат ещё раз.');
  // sendFile seals the local durable outbox before resolving. Cancellation before
  // this boundary never submits; an accepted message stays in the outbox.
  await current.sendFile(conversationId, { name: draft.name, mime: draft.mime, data });
}
export async function shareFile(item: MessengerFile) {
  const data = await loadFileData(item);
  if (!data) throw new Error('Файл больше не хранится на этом устройстве.');
  if (!(await Sharing.isAvailableAsync())) throw new Error('На устройстве недоступно меню сохранения файлов.');
  const safeName = item.name.replace(/[^\p{L}\p{N}._ -]/gu, '_').slice(0, 100) || 'file';
  const file = new File(Paths.cache, `${item.id.replace(/[^a-zA-Z0-9-]/g, '')}-${safeName}`);
  await file.write(data);
  try { await Sharing.shareAsync(file.uri, { mimeType: item.mime, dialogTitle: 'Сохранить или открыть файл' }); }
  finally { if (file.exists) file.delete(); }
}
