import type { ExpoConfig } from 'expo/config';

const config: ExpoConfig = {
  name: 'Мессенджер',
  slug: 'messenger-prototype',
  version: '0.1.0',
  orientation: 'default',
  userInterfaceStyle: 'dark',
  backgroundColor: '#091C23',
  ios: {
    supportsTablet: true,
    bundleIdentifier: 'dev.messenger.prototype',
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
    allowBackup: false,
    permissions: ['INTERNET', 'ACCESS_NETWORK_STATE', 'RECORD_AUDIO', 'CAMERA', 'MODIFY_AUDIO_SETTINGS'],
    // Only development builds permit local HTTP; release servers must use HTTPS.
  },
  plugins: [
    './plugins/withLocalNetworking.cjs',
    './plugins/withWebRtc155Release.cjs',
    ['@config-plugins/react-native-webrtc', {
      cameraPermission: 'Камера нужна для видеозвонков, которые вы включаете сами.',
      microphonePermission: 'Микрофон нужен для голосовых и видеозвонков.',
    }],
    ['expo-image-picker', {
      photosPermission: 'Выберите фото или видео для передачи собеседнику.',
      cameraPermission: false,
      microphonePermission: false,
    }],
  ],
};

export default config;
