import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Pressable, Text, View } from 'react-native';
import { File, Paths } from 'expo-file-system';
import * as Crypto from 'expo-crypto';
import type { MessengerFile } from '@messenger/core';
import { deleteMediaCache, loadFileData, pruneMediaCache } from '../attachments';
import { MAX_MEDIA_BYTES, type MediaKind } from '../media-model';
import { styles } from '../styles';
import { Icon } from './ui';
import { VoiceNote } from './VoiceNote';
import { VideoNote } from './VideoNote';
import { stopMediaPlayback } from '../media-playback';

export function MediaAttachment({ file, kind, disabled }: { file: MessengerFile; kind: MediaKind; disabled: boolean }) {
  const [uri, setUri] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const generation = useRef(0);
  const temporary = useRef<string | undefined>(undefined);
  const busyRef = useRef(false);
  const reset = useRef(() => {});
  useEffect(() => { reset.current = () => { generation.current++; busyRef.current = false; setBusy(false); setUri(undefined); deleteMediaCache(temporary.current); temporary.current = undefined; }; });
  const key = `${file.conversationId}:${file.senderId}:${file.id}`;
  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => { if (state !== 'active') reset.current(); });
    // Generation is a cancellation counter, not a rendered native-node ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    return () => { subscription.remove(); generation.current++; deleteMediaCache(temporary.current); temporary.current = undefined; };
  }, [key]);
  useEffect(() => { if (disabled) reset.current(); }, [disabled]);
  useEffect(() => { if (!uri) return; const timer = setTimeout(() => reset.current(), 180_000); return () => clearTimeout(timer); }, [uri]);
  async function open() {
    if (disabled || busyRef.current || AppState.currentState !== 'active') return;
    stopMediaPlayback(); pruneMediaCache();
    busyRef.current = true; setBusy(true); setError('');
    const attempt = ++generation.current;
    const nonce = Array.from(Crypto.getRandomBytes(16), byte => byte.toString(16).padStart(2, '0')).join('');
    const cached = new File(Paths.cache, `lastcall-media-play-${nonce}.${kind === 'voice' ? 'm4a' : file.mime === 'video/quicktime' ? 'mov' : 'mp4'}`);
    try {
      const bytes = await loadFileData(file);
      if (!bytes || !bytes.byteLength || bytes.byteLength > MAX_MEDIA_BYTES) throw new Error('Запись больше не хранится на устройстве.');
      if (attempt !== generation.current) return;
      await cached.write(bytes);
      if (attempt !== generation.current || AppState.currentState !== 'active') { deleteMediaCache(cached.uri); return; }
      temporary.current = cached.uri; setUri(cached.uri);
    } catch { if (attempt === generation.current) setError('Не удалось открыть запись. Попробуйте ещё раз.'); deleteMediaCache(cached.uri); }
    finally { if (attempt === generation.current) { busyRef.current = false; setBusy(false); } }
  }
  return <View>{uri ? kind === 'voice' ? <VoiceNote uri={uri} autoPlay onDone={() => reset.current()} /> : <VideoNote uri={uri} autoPlay onDone={() => reset.current()} /> :
    <Pressable disabled={disabled || busy} accessibilityRole="button" accessibilityLabel={kind === 'voice' ? 'Прослушать голосовое сообщение' : 'Смотреть видеокружок'} onPress={() => void open()} style={[styles.row, kind === 'circle' && { width: 220, height: 220, borderRadius: 110, backgroundColor: '#D6E6E0', justifyContent: 'center' }]}>{busy ? <ActivityIndicator /> : <Icon name="play-circle" size={44} />}<Text style={styles.fileName}>{kind === 'voice' ? 'Голосовое' : 'Видеокружок'}</Text></Pressable>}
    {!!error && <Text style={styles.fileMeta}>{error}</Text>}
  </View>;
}
