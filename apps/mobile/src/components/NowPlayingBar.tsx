import { useEffect, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaInsetsContext, useSafeAreaInsets } from 'react-native-safe-area-context';
import { VideoView } from 'expo-video';
import { t } from '../i18n';
import { colors } from '../styles';
import { Icon } from './ui';
import { mediaTime } from '../media-model';
import { nowPlayingVideo, stopNowPlaying, togglePlayback, useNowPlaying } from '../media-player';
import { useMessenger } from '../runtime';
import { TOP_STRIP_HEIGHT, TopOffset, useTopOffset } from '../top-offset';

const FLOATING_CIRCLE = 112;

/**
 * While a voice message or circle plays, a strip at the top (like Telegram's player bar) shows it on
 * every screen with pause and close. A circle whose chat is not on screen shows as a small floating
 * circle under the strip. A call stops playback.
 */
export function NowPlayingLayout({ children }: { children: ReactNode }) {
  const now = useNowPlaying();
  const { snapshot } = useMessenger();
  const insets = useSafeAreaInsets();
  const above = useTopOffset();
  const inCall = !!snapshot.activeCall;
  useEffect(() => { if (inCall) stopNowPlaying(); }, [inCall]);
  if (!now || now.error) return <>{children}</>;
  const chat = snapshot.conversations.find(item => item.id === now.conversationId);
  const what = now.kind === 'voice' ? t('Voice message') : t('Video circle');
  const left = now.duration ? mediaTime(Math.max(0, now.duration - now.position)) : '';
  const floating = now.kind === 'circle' && now.inlineViews === 0 && !now.loading ? nowPlayingVideo() : undefined;
  return <View style={{ flex: 1 }}>
    <View style={{ backgroundColor: colors.white, paddingTop: insets.top, paddingLeft: insets.left + 6, paddingRight: insets.right + 6, borderBottomWidth: 1, borderBottomColor: colors.line }}>
      <View style={{ height: TOP_STRIP_HEIGHT, flexDirection: 'row', alignItems: 'center', gap: 4 }}>
        <Pressable accessibilityRole="button" accessibilityLabel={now.playing ? (now.kind === 'voice' ? t('Pause voice message') : t('Pause video circle')) : (now.kind === 'voice' ? t('Play voice message') : t('Watch video circle'))} onPress={togglePlayback} hitSlop={8} style={{ width: 34, height: TOP_STRIP_HEIGHT, alignItems: 'center', justifyContent: 'center' }}>
          {now.loading ? <ActivityIndicator size="small" color={colors.accent} /> : <Icon name={now.playing ? 'pause' : 'play'} size={20} color={colors.accent} />}
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={t('Open chat')} onPress={() => router.push({ pathname: '/chat/[id]', params: { id: now.conversationId } })} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, minWidth: 0 }}>
          <Text numberOfLines={1} style={{ flexShrink: 1, color: colors.text, fontWeight: '600', fontSize: 13 }}>{chat?.title ?? what}</Text>
          <Text numberOfLines={1} style={{ color: colors.secondary, fontSize: 13 }}>{what}{left ? ` · ${left}` : ''}</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={t('Stop playback')} onPress={stopNowPlaying} hitSlop={8} style={{ width: 34, height: TOP_STRIP_HEIGHT, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="close" size={20} color={colors.secondary} />
        </Pressable>
      </View>
      {now.duration > 0 && <View style={{ position: 'absolute', left: 0, right: 0, bottom: -1, height: 2 }}><View style={{ width: `${Math.min(1, now.position / now.duration) * 100}%`, height: 2, backgroundColor: colors.accent }} /></View>}
    </View>
    <SafeAreaInsetsContext.Provider value={{ ...insets, top: 0 }}><TopOffset.Provider value={above + insets.top + TOP_STRIP_HEIGHT}>
      <View style={{ flex: 1 }}>{children}</View>
    </TopOffset.Provider></SafeAreaInsetsContext.Provider>
    {floating && <Pressable accessibilityRole="button" accessibilityLabel={now.playing ? t('Pause video circle') : t('Watch video circle')} onPress={togglePlayback}
      style={{ position: 'absolute', top: insets.top + TOP_STRIP_HEIGHT + 64, right: insets.right + 12, width: FLOATING_CIRCLE, height: FLOATING_CIRCLE, borderRadius: FLOATING_CIRCLE / 2, overflow: 'hidden', backgroundColor: '#1B252C', elevation: 6, alignItems: 'center', justifyContent: 'center' }}>
      <VideoView player={floating} style={{ position: 'absolute', width: FLOATING_CIRCLE, height: FLOATING_CIRCLE }} nativeControls={false} contentFit="cover" surfaceType="textureView" allowsPictureInPicture={false} fullscreenOptions={{ enable: false }} />
      {!now.playing && <Icon name="play-circle" size={40} color="#FFFFFF" />}
    </Pressable>}
  </View>;
}
