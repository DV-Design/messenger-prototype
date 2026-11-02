import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { PushBridge } from '../components/PushBridge';
import { CallOverlay } from '../components/CallOverlay';
import { PermissionSetupGate } from '../components/PermissionSetupGate';
import { NotificationNavigationBridge } from '../components/NotificationNavigationBridge';
import { UpdateNotice } from '../components/UpdateNotice';
import { useMessenger } from '../runtime';
import { pruneMediaCache } from '../attachments';
import { colors, styles } from '../styles';

export default function RootLayout() {
  const { ready } = useMessenger();
  useEffect(() => { pruneMediaCache(); }, []);
  return <SafeAreaProvider><StatusBar style="dark" />
    {!ready ? <View style={[styles.screen, { justifyContent: 'center' }]}><ActivityIndicator color={colors.accent} size="large" /></View> : <>
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }}>
        <Stack.Screen name="(tabs)" /><Stack.Screen name="onboarding" /><Stack.Screen name="chat/[id]" />
        <Stack.Screen name="new-group" options={{ presentation: 'modal' }} />
        <Stack.Screen name="permissions" options={{ presentation: 'modal' }} />
      </Stack><PermissionSetupGate /><PushBridge /><NotificationNavigationBridge /><UpdateNotice /><CallOverlay />
    </>}
  </SafeAreaProvider>;
}
