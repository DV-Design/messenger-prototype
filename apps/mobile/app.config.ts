import type { ExpoConfig } from 'expo/config';

// Only the Firebase Android client file belongs in a native build.
// The Firebase Admin service account stays exclusively on the server.
const googleServicesFile = process.env.MESSENGER_GOOGLE_SERVICES_FILE;
// Direct sideload builds keep the in-app APK updater. Store builds must use
// Google Play/App Store updates and never request REQUEST_INSTALL_PACKAGES.
const distribution = process.env.LASTCALL_DISTRIBUTION === 'store' ? 'store' : 'direct';
const androidPackage = process.env.LASTCALL_ANDROID_PACKAGE ?? (distribution === 'store' ? 'ru.lastcall.app' : 'dev.messenger.prototype');
const iosBundleIdentifier = process.env.LASTCALL_IOS_BUNDLE_ID ?? (distribution === 'store' ? 'ru.lastcall.app' : 'dev.messenger.prototype');
const config: ExpoConfig = {
  name: 'LastCall',
  slug: 'messenger-prototype',
  icon: './assets/lastcall-icon.png',
  version: '1.0.3',
  scheme: 'messenger-preview',
  orientation: 'default',
  userInterfaceStyle: 'light',
  backgroundColor: '#F5F7F9',
  ios: {
    supportsTablet: true,
    bundleIdentifier: iosBundleIdentifier,
    buildNumber: '17',
    infoPlist: {
      // Local-network HTTP is only for an explicitly configured development server.
      NSAppTransportSecurity: process.env.MESSENGER_ALLOW_LOCAL_HTTP === '1'
        ? { NSAllowsArbitraryLoads: true, NSAllowsLocalNetworking: true }
        : { NSAllowsLocalNetworking: false },
      NSLocalNetworkUsageDescription: 'Подключение к вашему тестовому серверу в локальной сети.',
    },
  },
  android: {
    package: androidPackage,
    versionCode: 17,
    allowBackup: false,
    adaptiveIcon: { foregroundImage: './assets/lastcall-icon.png', backgroundColor: '#FFFFFF' },
    ...(googleServicesFile ? { googleServicesFile } : {}),
    permissions: ['INTERNET', 'ACCESS_NETWORK_STATE', 'RECORD_AUDIO', 'CAMERA', 'MODIFY_AUDIO_SETTINGS', 'USE_FULL_SCREEN_INTENT', ...(distribution === 'direct' ? ['REQUEST_INSTALL_PACKAGES'] : [])],
    // Self-managed calls need no phone-number/phone-state access or Phone-app account setup.
    blockedPermissions: ['android.permission.READ_CONTACTS', 'android.permission.WRITE_CONTACTS', 'android.permission.READ_CALL_LOG', 'android.permission.WRITE_CALL_LOG', 'android.permission.READ_PHONE_NUMBERS', 'android.permission.CALL_PHONE', 'android.permission.READ_PHONE_STATE', 'android.permission.SYSTEM_ALERT_WINDOW'],
    // Only development builds permit local HTTP; release servers must use HTTPS.
  },
  extra: { nativeFcmConfigured: !!googleServicesFile, distribution, directUpdates: distribution === 'direct' },
  plugins: [
    './plugins/withLastCallPip.cjs',
    'expo-router',
    ['expo-audio', { microphonePermission: 'Микрофон нужен для звонков и записи голосовых сообщений.', enableBackgroundRecording: false, enableBackgroundPlayback: false }],
    ['expo-camera', { cameraPermission: 'Камера нужна для видеозвонков и записи видеокружков.', microphonePermission: 'Микрофон нужен для звонков и записи сообщений.', recordAudioAndroid: true }],
    ['expo-video', { supportsBackgroundPlayback: false, supportsPictureInPicture: false }],
    ['expo-splash-screen', { image: './assets/lastcall-icon.png', imageWidth: 160, resizeMode: 'contain', backgroundColor: '#FFFFFF' }],
    './plugins/withAdaptiveIconInset.cjs',
    ...(googleServicesFile ? [['expo-notifications', { defaultChannel: 'lastcall-messages' }] as [string, Record<string, string>]] : []),
    ['expo-secure-store', { configureAndroidBackup: false }],
    './plugins/withLocalNetworking.cjs',
    'expo-sharing',
    './plugins/withLastCallCalls.cjs',
    './plugins/withPersistentCircleCamera.cjs',
    './plugins/withReleaseSigning.cjs',
    './plugins/withLastCallNotifications.cjs',
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
