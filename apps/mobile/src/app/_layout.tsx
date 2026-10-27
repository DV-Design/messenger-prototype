import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { CallOverlay } from '../components/CallOverlay';
import { useMessenger } from '../runtime';
import { colors, styles } from '../styles';

export default function RootLayout() {
  const { ready } = useMessenger();
  return <SafeAreaProvider><StatusBar style="dark" />
    {!ready ? <View style={[styles.screen, { justifyContent: 'center' }]}><ActivityIndicator color={colors.accent} size="large" /></View> : <>
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }}>
        <Stack.Screen name="(tabs)" /><Stack.Screen name="onboarding" /><Stack.Screen name="chat/[id]" />
        <Stack.Screen name="new-group" options={{ presentation: 'modal' }} />
      </Stack><CallOverlay />
    </>}
  </SafeAreaProvider>;
}
