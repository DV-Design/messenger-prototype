import { useEffect, useState } from 'react';
import { Image, Pressable, Text, View } from 'react-native';
import { File, Paths } from 'expo-file-system';
import * as Crypto from 'expo-crypto';
import type { MessengerFile } from '@messenger/core';
import { colors, styles } from '../styles';
import { Icon, fileSize } from './ui';

export function AttachmentCard({ file, self, sender, onOpen }: { file: MessengerFile; self: boolean; sender?: string; onOpen: () => void }) {
  const [preview, setPreview] = useState<string>();
  useEffect(() => {
    if (!file.data || !file.mime.startsWith('image/') || file.status !== 'complete') return;
    let canceled = false;
    const suffix = Array.from(Crypto.getRandomBytes(8), value => value.toString(16).padStart(2, '0')).join('');
    const temporary = new File(Paths.cache, `lastcall-preview-${suffix}`);
    void temporary.write(file.data).then(() => {
      if (canceled) { if (temporary.exists) temporary.delete(); }
      else setPreview(temporary.uri);
    }).catch(() => {});
    return () => { canceled = true; if (temporary.exists) temporary.delete(); };
  }, [file.data, file.mime, file.status]);
  const label = { sending: 'Отправляется…', receiving: 'Получение…', complete: 'Передан', error: 'Не удалось передать' }[file.status];
  return <Pressable accessibilityRole="button" accessibilityLabel={`Файл ${file.name}`} disabled={file.status !== 'complete' || !file.data} onPress={onOpen} style={[styles.bubble, self && styles.bubbleSelf]}>
    {!!sender && !self && <Text style={styles.senderName}>{sender}</Text>}
    {!!preview && <Image source={{ uri: preview }} style={styles.previewImage} resizeMode="cover" />}
    <View style={styles.row}><Icon name={file.mime.startsWith('video/') ? 'videocam-outline' : file.mime.startsWith('image/') ? 'image-outline' : 'document-text-outline'} size={25} /><View><Text numberOfLines={2} style={styles.fileName}>{file.name}</Text><Text style={styles.fileMeta}>{fileSize(file.size)} · {label}</Text>
      {file.status === 'receiving' && <Text style={styles.fileMeta}>{Math.min(100, Math.round(file.receivedBytes / Math.max(1, file.size) * 100))}%</Text>}
      {file.status === 'complete' && file.data && <Text style={[styles.fileMeta, { color: colors.accent }]}>Нажмите, чтобы открыть или сохранить</Text>}
    </View></View>
  </Pressable>;
}
