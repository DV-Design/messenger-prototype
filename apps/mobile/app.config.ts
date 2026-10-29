import type { ExpoConfig } from 'expo/config';

// Only the Firebase Android client file belongs in a native build.
// The Firebase Admin service account stays exclusively on the server.
const googleServicesFile = process.env.MESSENGER_GOOGLE_SERVICES_FILE;
const config: ExpoConfig = {
  name: 'LastCall',
  slug: 'messenger-prototype',
  icon: './assets/lastcall-icon.png',
  version: '0.5.1',
  scheme: 'messenger-preview',
  orientation: 'default',
  userInterfaceStyle: 'light',
  backgroundColor: '#F5F7F9',
  ios: {
    supportsTablet: true,
    bundleIdentifier: 'dev.messenger.prototype',
    buildNumber: '7',
    infoPlist: {
      // Local-network HTTP is only for an explicitly configured development server.
      NSAppTransportSecurity: process.env.MESSENGER_ALLOW_LOCAL_HTTP === '1'
        ? { NSAllowsArbitraryLoads: true, NSAllowsLocalNetworking: true }
        : { NSAllowsLocalNetworking: false },
      NSLocalNetworkUsageDescription: 'Подключение к вашему тестовому серверу в локальной сети.',
    },
  },
  android: {
    package: 'dev.messenger.prototype',
    versionCode: 7,
    allowBackup: false,
    adaptiveIcon: { foregroundImage: './assets/lastcall-icon.png', backgroundColor: '#FFFFFF' },
    ...(googleServicesFile ? { googleServicesFile } : {}),
    permissions: ['INTERNET', 'ACCESS_NETWORK_STATE', 'RECORD_AUDIO', 'CAMERA', 'MODIFY_AUDIO_SETTINGS'],
    blockedPermissions: ['android.permission.READ_CONTACTS', 'android.permission.WRITE_CONTACTS'],
    // Only development builds permit local HTTP; release servers must use HTTPS.
  },
  extra: { nativeFcmConfigured: !!googleServicesFile },
  plugins: [
    'expo-router',
    ['expo-splash-screen', { image: './assets/lastcall-icon.png', imageWidth: 160, resizeMode: 'contain', backgroundColor: '#FFFFFF' }],
    './plugins/withAdaptiveIconInset.cjs',
    ...(googleServicesFile ? [['expo-notifications', { defaultChannel: 'lastcall-messages' }] as [string, Record<string, string>]] : []),
    ['expo-secure-store', { configureAndroidBackup: false }],
    './plugins/withLocalNetworking.cjs',
    './plugins/withWebRtc155Release.cjs',
    ['@config-plugins/react-native-webrtc', {
      cameraPermission: 'Камера нужна для видеозвонков, которые вы включаете сами.',
      microphonePermission: 'Микрофон нужен для голосовых и видеозвонков.',
    }],
    ['expo-image-picker', {
      photosPermission: 'Выберите фото или видео для передачи собеседнику.',
      // false blocks these globally, including WebRTC call permissions.
      cameraPermission: 'Камера нужна для видеозвонков, которые вы включаете сами.',
      microphonePermission: 'Микрофон нужен для голосовых и видеозвонков.',
    }],
  ],
};

export default config;
