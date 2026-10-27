import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import * as Sharing from 'expo-sharing';
import { File, Paths } from 'expo-file-system';
import type { MessengerClient, MessengerFile } from '@messenger/core';
import { client } from './runtime';
const MAX_FILE = 5 * 1024 * 1024;
async function transmit(current: MessengerClient, conversationId: string, uri: string, name: string, mime: string, reportedSize?: number) {
  const file = new File(uri);
  if ((reportedSize ?? file.size) > MAX_FILE || file.size > MAX_FILE) throw new Error('Можно передавать файлы не больше 5 МиБ.');
  const data = await file.bytes();
  if (data.byteLength > MAX_FILE) throw new Error('Файл больше 5 МиБ.');
  if (client() !== current) throw new Error('Сервер изменён. Откройте чат ещё раз.');
  await current.sendFile(conversationId, { name, mime, data });
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
export async function shareFile(item: MessengerFile) {
  if (!item.data) throw new Error('Файл доступен только в текущем запуске приложения.');
  if (!(await Sharing.isAvailableAsync())) throw new Error('На устройстве недоступно меню сохранения файлов.');
  const safeName = item.name.replace(/[^\p{L}\p{N}._ -]/gu, '_').slice(0, 100) || 'file';
  const file = new File(Paths.cache, `${item.id.replace(/[^a-zA-Z0-9-]/g, '')}-${safeName}`);
  await file.write(item.data);
  try { await Sharing.shareAsync(file.uri, { mimeType: item.mime, dialogTitle: 'Сохранить или открыть файл' }); }
  finally { if (file.exists) file.delete(); }
}
