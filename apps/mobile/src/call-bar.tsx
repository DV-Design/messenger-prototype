import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import { SafeAreaInsetsContext, useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { colors } from './styles';
import { t } from './i18n';
import { Icon } from './components/ui';
import { callBarSnapshot, callDuration, setCallBar, subscribeCallBar } from './call-bar-model';

export { markCallActive, setCallBar } from './call-bar-model';
export function useCallBar() { return useSyncExternalStore(subscribeCallBar, callBarSnapshot); }

function useClock(running: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running]);
  return now;
}

/**
 * Telegram's strip: a full-width bar under the status bar that pushes the app down instead of
 * covering its headers. Screens below get no top inset, since the bar already took it.
 */
export function CallBarLayout({ children }: { children: ReactNode }) {
  const bar = useCallBar();
  const insets = useSafeAreaInsets();
  const now = useClock(bar.collapsed && bar.activeSince !== undefined);
  if (!bar.collapsed) return <>{children}</>;
  const detail = bar.activeSince !== undefined ? callDuration(now - bar.activeSince) : bar.status;
  return <View style={{ flex: 1 }}>
    <StatusBar style="light" />
    <Pressable accessibilityRole="button" accessibilityLabel={t('Return to call with {name}', { name: bar.name })} onPress={() => setCallBar({ collapsed: false })}
      style={({ pressed }) => ({ backgroundColor: colors.accent, paddingTop: insets.top, paddingLeft: insets.left + 16, paddingRight: insets.right + 16, opacity: pressed ? 0.85 : 1 })}>
      <View style={{ height: 34, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 }}>
        <Icon name="call" color={colors.white} size={15} />
        <Text numberOfLines={1} style={{ color: colors.white, fontWeight: '600', fontSize: 14, flexShrink: 1 }}>{bar.name}</Text>
        <Text style={{ color: colors.white, fontSize: 14, fontVariant: ['tabular-nums'] }}>{detail}</Text>
      </View>
    </Pressable>
    <SafeAreaInsetsContext.Provider value={{ ...insets, top: 0 }}>
      <View style={{ flex: 1 }}>{children}</View>
    </SafeAreaInsetsContext.Provider>
  </View>;
}
