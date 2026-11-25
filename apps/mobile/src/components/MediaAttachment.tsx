import { useEffect } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { VideoView } from 'expo-video';
import type { MessengerFile } from '@messenger/core';
import { mediaTime, type MediaKind } from '../media-model';
import { mediaFileKey, nowPlayingVideo, playMediaFile, showCircleInline, useNowPlaying } from '../media-player';
import { colors, styles } from '../styles';
import { Icon } from './ui';
import { t } from '../i18n';

export const CIRCLE_NOTE_SIZE = 220;

/**
 * A voice message or video circle in the chat. Playback runs in the app-wide player, so it goes on
 * while a photo is opened or other chats are browsed; this row only shows and controls it.
 */
export function MediaAttachment({ file, kind, disabled, duration }: { file: MessengerFile; kind: MediaKind; disabled: boolean; duration?: number | null }) {
  const now = useNowPlaying();
  const key = mediaFileKey(file);
  const active = now?.key === key ? now : undefined;
  const showing = kind === 'circle' && !!active && !active.loading && !active.error;
  useEffect(() => (showing ? showCircleInline(key) : undefined), [showing, key]);
  const length = active?.duration || duration || 0;
  const start = () => { if (!disabled || active) void playMediaFile(file, kind); };
  if (kind === 'voice') {
    const progress = active && length ? Math.min(1, active.position / length) : 0;
    return <Pressable accessibilityRole="button" accessibilityLabel={active?.playing ? t('Pause voice message') : t('Play voice message')} disabled={disabled && !active} onPress={start} style={[styles.row, { minWidth: 205 }]}>
      {active?.loading ? <View style={{ width: 43, height: 43, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator /></View> : <Icon name={active?.playing ? 'pause-circle' : 'play-circle'} size={43} />}
      <View style={{ flex: 1, gap: 5 }}>
        <Text style={styles.fileName}>{t('Voice message')}</Text>
        <View style={{ height: 4, borderRadius: 2, backgroundColor: '#C5D9D2', overflow: 'hidden' }}><View style={{ width: `${progress * 100}%`, height: 4, backgroundColor: colors.accent }} /></View>
        {!!active?.error && <Text style={styles.fileMeta}>{active.error}</Text>}
      </View>
    </Pressable>;
  }
  const player = showing ? nowPlayingVideo() : undefined;
  return <Pressable accessibilityRole="button" accessibilityLabel={active?.playing ? t('Pause video circle') : t('Watch video circle')} disabled={disabled && !active} onPress={start}
    style={{ width: CIRCLE_NOTE_SIZE, height: CIRCLE_NOTE_SIZE, borderRadius: CIRCLE_NOTE_SIZE / 2, overflow: 'hidden', backgroundColor: '#1B252C', alignItems: 'center', justifyContent: 'center' }}>
    {player && <VideoView player={player} style={{ position: 'absolute', width: CIRCLE_NOTE_SIZE, height: CIRCLE_NOTE_SIZE }} nativeControls={false} contentFit="cover" surfaceType="textureView" allowsPictureInPicture={false} fullscreenOptions={{ enable: false }} />}
    {active?.loading ? <ActivityIndicator color="#FFFFFF" /> : !active?.playing && <Icon name="play-circle" size={57} color="#FFFFFF" />}
    {!!active?.error && <Text style={{ position: 'absolute', bottom: 40, color: '#FFFFFF', fontSize: 12, textAlign: 'center', paddingHorizontal: 20 }}>{active.error}</Text>}
    {active && length > 0 && <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 4, backgroundColor: 'rgba(255,255,255,0.25)' }}><View style={{ width: `${Math.min(1, active.position / length) * 100}%`, height: 4, backgroundColor: '#FFFFFF' }} /></View>}
  </Pressable>;
}

/** "0:12" for a recording whose length is known; while playing, the time left. */
export function noteTime(file: MessengerFile, duration: number | null | undefined, now: ReturnType<typeof useNowPlaying>): string | undefined {
  const active = now?.key === mediaFileKey(file) ? now : undefined;
  const length = active?.duration || duration || 0;
  if (!length) return undefined;
  return active && active.position > 0 ? mediaTime(Math.max(0, length - active.position)) : mediaTime(length);
}
