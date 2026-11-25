import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { PushBridge } from '../components/PushBridge';
import { CallOverlay } from '../components/CallOverlay';
import { CallBarLayout } from '../call-bar';
import { LiveLocationBarLayout } from '../components/LiveLocationBar';
import { NowPlayingLayout } from '../components/NowPlayingBar';
import { PermissionSetupGate } from '../components/PermissionSetupGate';
import { NotificationNavigationBridge } from '../components/NotificationNavigationBridge';
import { UpdateNotice } from '../components/UpdateNotice';
import { ShareIntentBridge } from '../components/ShareIntentBridge';
import { useMessenger } from '../runtime';
import { pruneMediaCache } from '../attachments';
import { startFeedback } from '../feedback';
import { colors, styles } from '../styles';

export default function RootLayout() {
  const { ready } = useMessenger();
  useEffect(() => { pruneMediaCache(); }, []);
  useEffect(() => startFeedback(), []);
  return <SafeAreaProvider><StatusBar style="dark" />
    {!ready ? <View style={[styles.screen, { justifyContent: 'center' }]}><ActivityIndicator color={colors.accent} size="large" /></View> : <>
      <CallBarLayout><LiveLocationBarLayout><NowPlayingLayout><Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }}>
        <Stack.Screen name="(tabs)" /><Stack.Screen name="onboarding" /><Stack.Screen name="chat/[id]" /><Stack.Screen name="group/[id]" /><Stack.Screen name="contact/[id]" />
        <Stack.Screen name="new-group" options={{ presentation: 'modal' }} />
        <Stack.Screen name="permissions" options={{ presentation: 'modal' }} />
        <Stack.Screen name="share" options={{ presentation: 'modal' }} />
        <Stack.Screen name="requests" />
      </Stack></NowPlayingLayout></LiveLocationBarLayout></CallBarLayout><PermissionSetupGate /><PushBridge /><NotificationNavigationBridge /><ShareIntentBridge /><UpdateNotice /><CallOverlay />
    </>}
  </SafeAreaProvider>;
}
