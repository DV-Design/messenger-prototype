import { useCallback, useEffect, useRef } from 'react';
import { AppState, Pressable, Text, View } from 'react-native';
import { useEvent } from 'expo';
import { useVideoPlayer, VideoView } from 'expo-video';
import { Icon } from './ui';
import { claimMediaPlayback } from '../media-playback';
import { mediaTime } from '../media-model';

export function VideoNote({ uri, autoPlay = false, onDone }: { uri: string; autoPlay?: boolean; onDone?: () => void }) {
  const player = useVideoPlayer(uri, value => { value.loop = false; value.staysActiveInBackground = false; value.timeUpdateEventInterval = 0.25; });
  const { isPlaying } = useEvent(player, 'playingChange', { isPlaying: player.playing });
  const { currentTime } = useEvent(player, 'timeUpdate', { currentTime: 0, currentLiveTimestamp: null, currentOffsetFromLive: null, bufferedPosition: 0 });
  const done = useRef(onDone);
  const release = useRef<(() => void) | undefined>(undefined);
  useEffect(() => { done.current = onDone; });
  const stop = useCallback(() => { player.pause(); done.current?.(); }, [player]);
  const play = useCallback(() => { release.current?.(); release.current = claimMediaPlayback(stop); if (player.currentTime >= player.duration - 0.1) player.replay(); else player.play(); }, [player, stop]);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => { if (state !== 'active') { player.pause(); done.current?.(); } });
    if (autoPlay && AppState.currentState === 'active') play();
    return () => { subscription.remove(); release.current?.(); };
  }, [player, autoPlay, play]);
  function toggle() { if (isPlaying) player.pause(); else if (AppState.currentState === 'active') play(); }
  return <View style={{ alignItems: 'center', gap: 5 }}><Pressable accessibilityRole="button" accessibilityLabel={isPlaying ? 'Приостановить видеокружок' : 'Смотреть видеокружок'} onPress={toggle} style={{ width: 220, height: 220, borderRadius: 110, overflow: 'hidden', backgroundColor: '#1B252C' }}>
    <VideoView player={player} style={{ width: 220, height: 220 }} nativeControls={false} contentFit="cover" surfaceType="textureView" allowsPictureInPicture={false} fullscreenOptions={{ enable: false }} />
    {!isPlaying && <View pointerEvents="none" style={{ position: 'absolute', inset: 0, alignItems: 'center', justifyContent: 'center' }}><Icon name="play-circle" size={57} color="#FFFFFF" /></View>}
  </Pressable><Text style={{ color: '#71838B', fontSize: 12 }}>{mediaTime(currentTime)} / {mediaTime(player.duration)}</Text></View>;
}
