import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Pressable, Text, View } from 'react-native';
import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { Icon } from './ui';
import { colors, styles } from '../styles';
import { claimMediaPlayback } from '../media-playback';
import { mediaTime } from '../media-model';

export function VoiceNote({ uri, autoPlay = false, onDone }: { uri: string; autoPlay?: boolean; onDone?: () => void }) {
  const player = useAudioPlayer(uri, { updateInterval: 200 });
  const status = useAudioPlayerStatus(player);
  const [error, setError] = useState('');
  const done = useRef(onDone);
  const alive = useRef(false);
  const generation = useRef(0);
  const release = useRef<(() => void) | undefined>(undefined);
  useEffect(() => { done.current = onDone; });
  const stop = useCallback(() => { generation.current++; player.pause(); done.current?.(); }, [player]);
  const play = useCallback(async () => {
    try {
      release.current?.(); release.current = claimMediaPlayback(stop);
      const attempt = ++generation.current;
      await setAudioModeAsync({ allowsRecording: false, shouldPlayInBackground: false, allowsBackgroundRecording: false, playsInSilentMode: true, interruptionMode: 'doNotMix' });
      if (!alive.current || attempt !== generation.current || AppState.currentState !== 'active') return;
      if (player.duration > 0 && player.currentTime >= player.duration - 0.1) await player.seekTo(0);
      if (alive.current && attempt === generation.current && AppState.currentState === 'active') player.play();
    } catch { if (alive.current) setError('Не удалось воспроизвести запись.'); }
  }, [player, stop]);
  useEffect(() => {
    alive.current = true;
    const subscription = AppState.addEventListener('change', state => { if (state !== 'active') { player.pause(); done.current?.(); } });
    if (autoPlay) void play();
    return () => { alive.current = false; generation.current++; subscription.remove(); release.current?.(); };
  }, [player, autoPlay, play]);
  return <View style={{ minWidth: 205, maxWidth: 260, gap: 8 }}>
    <Pressable accessibilityRole="button" accessibilityLabel={status.playing ? 'Приостановить голосовое' : 'Прослушать голосовое'} onPress={() => status.playing ? player.pause() : void play()} style={styles.row}>
      <Icon name={status.playing ? 'pause-circle' : 'play-circle'} size={43} /><View style={{ flex: 1, gap: 5 }}><Text style={styles.fileName}>Голосовое сообщение</Text><View style={{ height: 4, borderRadius: 2, backgroundColor: '#C5D9D2', overflow: 'hidden' }}><View style={{ width: `${Math.min(100, status.currentTime / Math.max(0.01, status.duration) * 100)}%`, height: 4, backgroundColor: colors.accent }} /></View><Text style={styles.fileMeta}>{mediaTime(status.currentTime)} / {mediaTime(status.duration)}</Text></View>
    </Pressable>{!!error && <Text style={styles.fileMeta}>{error}</Text>}
  </View>;
}
