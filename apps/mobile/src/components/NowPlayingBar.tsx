import { useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaInsetsContext, useSafeAreaInsets } from 'react-native-safe-area-context';
import { VideoView } from 'expo-video';
import { t } from '../i18n';
import { colors } from '../styles';
import { Icon } from './ui';
import { mediaTime } from '../media-model';
import { nowPlayingVideo, setFloatingShown, stopNowPlaying, togglePlayback, useNowPlaying, type NowPlaying } from '../media-player';
import { ProgressRing } from './ProgressRing';
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
  // The floating circle waits a moment: a chat row that is about to show the circle gets it first.
  const wanted = !!now && now.kind === 'circle' && now.inlineViews === 0 && !now.loading && !now.error ? now.key : undefined;
  const [floatKey, setFloatKey] = useState<string>();
  useEffect(() => {
    if (!wanted) return;
    const timer = setTimeout(() => setFloatKey(wanted), 300);
    // A row took the circle (or it ended): the next floating start waits again.
    return () => { clearTimeout(timer); setFloatKey(undefined); };
  }, [wanted]);
  // The tree around the screens never changes shape: a strip that appears must not re-create them
  // (that reset the open chat, its scroll and the circle being shown).
  const shown = now && !now.error ? now : undefined;
  const floating = shown && wanted && floatKey === wanted ? nowPlayingVideo() : undefined;
  return <View style={{ flex: 1 }}>
    {shown && <PlayerStrip now={shown} title={snapshot.conversations.find(item => item.id === shown.conversationId)?.title} />}
    <SafeAreaInsetsContext.Provider value={shown ? { ...insets, top: 0 } : insets}><TopOffset.Provider value={shown ? above + insets.top + TOP_STRIP_HEIGHT : above}>
      <View style={{ flex: 1 }}>{children}</View>
    </TopOffset.Provider></SafeAreaInsetsContext.Provider>
    {shown && floating && <FloatingCircle now={shown} top={insets.top + TOP_STRIP_HEIGHT + 64} right={insets.right + 12} player={floating} />}
  </View>;
}

function PlayerStrip({ now, title }: { now: NowPlaying; title?: string }) {
  const insets = useSafeAreaInsets();
  const what = now.kind === 'voice' ? t('Voice message') : t('Video circle');
  const left = now.duration ? mediaTime(Math.max(0, now.duration - now.position)) : '';
  return <View style={{ backgroundColor: colors.white, paddingTop: insets.top, paddingLeft: insets.left + 6, paddingRight: insets.right + 6, borderBottomWidth: 1, borderBottomColor: colors.line }}>
      <View style={{ height: TOP_STRIP_HEIGHT, flexDirection: 'row', alignItems: 'center', gap: 4 }}>
        <Pressable accessibilityRole="button" accessibilityLabel={now.playing ? (now.kind === 'voice' ? t('Pause voice message') : t('Pause video circle')) : (now.kind === 'voice' ? t('Play voice message') : t('Watch video circle'))} onPress={togglePlayback} hitSlop={8} style={{ width: 34, height: TOP_STRIP_HEIGHT, alignItems: 'center', justifyContent: 'center' }}>
          {now.loading ? <ActivityIndicator size="small" color={colors.accent} /> : <Icon name={now.playing ? 'pause' : 'play'} size={20} color={colors.accent} />}
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={t('Open chat')} onPress={() => router.push({ pathname: '/chat/[id]', params: { id: now.conversationId } })} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, minWidth: 0 }}>
          <Text numberOfLines={1} style={{ flexShrink: 1, color: colors.text, fontWeight: '600', fontSize: 13 }}>{title ?? what}</Text>
          <Text numberOfLines={1} style={{ color: colors.secondary, fontSize: 13 }}>{what}{left ? ` · ${left}` : ''}</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={t('Stop playback')} onPress={stopNowPlaying} hitSlop={8} style={{ width: 34, height: TOP_STRIP_HEIGHT, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="close" size={20} color={colors.secondary} />
        </Pressable>
      </View>
      {now.duration > 0 && <View style={{ position: 'absolute', left: 0, right: 0, bottom: -1, height: 2 }}><View style={{ width: `${Math.min(1, now.position / now.duration) * 100}%`, height: 2, backgroundColor: colors.accent }} /></View>}
    </View>;
}

/** Holds the video surface while it is on screen and says so, so a chat row waits for it to let go. */
function FloatingCircle({ now, top, right, player }: { now: NowPlaying; top: number; right: number; player: NonNullable<ReturnType<typeof nowPlayingVideo>> }) {
  const key = now.key;
  useEffect(() => { setFloatingShown(key, true); return () => setFloatingShown(key, false); }, [key]);
  return <Pressable accessibilityRole="button" accessibilityLabel={now.playing ? t('Pause video circle') : t('Watch video circle')} onPress={togglePlayback}
    style={{ position: 'absolute', top, right, width: FLOATING_CIRCLE, height: FLOATING_CIRCLE, borderRadius: FLOATING_CIRCLE / 2, overflow: 'hidden', backgroundColor: '#1B252C', elevation: 6, alignItems: 'center', justifyContent: 'center' }}>
    <VideoView player={player} style={{ position: 'absolute', width: FLOATING_CIRCLE, height: FLOATING_CIRCLE }} nativeControls={false} contentFit="cover" surfaceType="textureView" allowsPictureInPicture={false} fullscreenOptions={{ enable: false }} />
    {!now.playing && <Icon name="play-circle" size={40} color="#FFFFFF" />}
    {now.duration > 0 && <ProgressRing size={FLOATING_CIRCLE} width={3} progress={now.position / now.duration} />}
  </Pressable>;
}
