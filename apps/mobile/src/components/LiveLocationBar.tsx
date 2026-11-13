import { useSyncExternalStore, type ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaInsetsContext, useSafeAreaInsets } from 'react-native-safe-area-context';
import { t } from '../i18n';
import { colors } from '../styles';
import { Icon, time } from './ui';
import { liveShareSnapshot, stopLiveLocation, subscribeLiveShare } from '../live-location';

/** Same strip pattern as the call bar: a full-width bar that pushes the app down, visible from any screen while a live share runs. */
export function LiveLocationBarLayout({ children }: { children: ReactNode }) {
  const bar = useSyncExternalStore(subscribeLiveShare, liveShareSnapshot);
  const insets = useSafeAreaInsets();
  if (!bar.active) return <>{children}</>;
  return <View style={{ flex: 1 }}>
    <Pressable accessibilityRole="button" accessibilityLabel={t('Open the chat sharing your location')}
      onPress={() => router.push({ pathname: '/chat/[id]', params: { id: bar.conversationId } })}
      style={({ pressed }) => ({ backgroundColor: '#2B4A3E', paddingTop: insets.top, paddingLeft: insets.left + 16, paddingRight: insets.right + 8, opacity: pressed ? 0.85 : 1 })}>
      <View style={{ height: 34, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Icon name="radio" color="#67D99B" size={15} />
        <Text numberOfLines={1} style={{ flex: 1, color: colors.white, fontWeight: '600', fontSize: 13 }}>{t('Sharing your location until {time}', { time: time(bar.until) })}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel={t('Stop sharing')} onPress={() => void stopLiveLocation()} style={{ paddingHorizontal: 8, paddingVertical: 6 }}>
          <Text style={{ color: '#FFB4AC', fontWeight: '700', fontSize: 13 }}>{t('Stop')}</Text>
        </Pressable>
      </View>
    </Pressable>
    <SafeAreaInsetsContext.Provider value={{ ...insets, top: 0 }}>
      <View style={{ flex: 1 }}>{children}</View>
    </SafeAreaInsetsContext.Provider>
  </View>;
}
