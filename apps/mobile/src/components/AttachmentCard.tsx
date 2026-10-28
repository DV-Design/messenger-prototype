import { useEffect, useState } from 'react';
import { Image, Pressable, Text, View } from 'react-native';
import { File, Paths } from 'expo-file-system';
import * as Crypto from 'expo-crypto';
import type { MessengerFile } from '@messenger/core';
import { colors, styles } from '../styles';
import { Icon, fileSize } from './ui';
import { client } from '../runtime';
import { deliveryLabel } from '../delivery-model';

export function AttachmentCard({ file, self, group = false, sender, onOpen }: { file: MessengerFile; self: boolean; group?: boolean; sender?: string; onOpen: () => void }) {
  const [preview, setPreview] = useState<{ key: string; uri: string }>();
  const { id, senderId, conversationId, data, mime, blobKey, deliveryStatus } = file;
  const previewKey = `${conversationId}:${senderId}:${id}:${blobKey ?? ''}`;
  useEffect(() => {
    if ((!data && !blobKey) || !mime.startsWith('image/') || deliveryStatus === 'expired') return;
    let canceled = false;
    const current = client();
    const suffix = Array.from(Crypto.getRandomBytes(8), value => value.toString(16).padStart(2, '0')).join('');
    const temporary = new File(Paths.cache, `lastcall-preview-${suffix}`);
    void Promise.resolve(data ?? current.getFileData(conversationId, id, senderId)).then(async bytes => {
      if (!bytes || canceled || client() !== current) return;
      await temporary.write(bytes);
      if (canceled) { if (temporary.exists) temporary.delete(); }
      else setPreview({ key: previewKey, uri: temporary.uri });
    }).catch(() => {});
    return () => { canceled = true; if (temporary.exists) temporary.delete(); };
  }, [id, senderId, conversationId, data, mime, blobKey, deliveryStatus, previewKey]);
  const available = !!(file.data || file.blobKey) && file.deliveryStatus !== 'expired';
  const label = self ? deliveryLabel(file, group) : file.status === 'receiving' ? 'Получение…' : file.status === 'error' ? 'Не удалось получить' : 'Получено';
  return <Pressable accessibilityRole="button" accessibilityLabel={`Файл ${file.name}. ${label}`} disabled={!available} onPress={onOpen} style={[styles.bubble, self && styles.bubbleSelf]}>
    {!!sender && !self && <Text style={styles.senderName}>{sender}</Text>}
    {available && preview?.key === previewKey && <Image source={{ uri: preview.uri }} style={styles.previewImage} resizeMode="cover" />}
    <View style={styles.row}><Icon name={file.mime.startsWith('video/') ? 'videocam-outline' : file.mime.startsWith('image/') ? 'image-outline' : 'document-text-outline'} size={25} /><View><Text numberOfLines={2} style={styles.fileName}>{file.name}</Text><Text style={styles.fileMeta}>{fileSize(file.size)} · {label}</Text>
      {file.status === 'receiving' && <Text style={styles.fileMeta}>{Math.min(100, Math.round(file.receivedBytes / Math.max(1, file.size) * 100))}%</Text>}
      {available && <Text style={[styles.fileMeta, { color: colors.accent }]}>Нажмите, чтобы открыть или сохранить</Text>}
    </View></View>
  </Pressable>;
}
