import type { ExpoConfig } from 'expo/config';

const config: ExpoConfig = {
  name: 'LastCall',
  slug: 'messenger-prototype',
  version: '0.2.1',
  scheme: 'messenger-preview',
  orientation: 'default',
  userInterfaceStyle: 'light',
  backgroundColor: '#F5F7F9',
  ios: {
    supportsTablet: true,
    bundleIdentifier: 'dev.messenger.prototype',
    buildNumber: '3',
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
    versionCode: 3,
    allowBackup: false,
    permissions: ['INTERNET', 'ACCESS_NETWORK_STATE', 'RECORD_AUDIO', 'CAMERA', 'MODIFY_AUDIO_SETTINGS', 'READ_CONTACTS'],
    blockedPermissions: ['android.permission.WRITE_CONTACTS'],
    // Only development builds permit local HTTP; release servers must use HTTPS.
  },
  plugins: [
    'expo-router',
    ['expo-secure-store', { configureAndroidBackup: false }],
    ['expo-contacts', { contactsPermission: 'LastCall читает выбранные контакты, чтобы вы могли связать их с профилями. Телефонная книга не загружается на сервер.' }],
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
