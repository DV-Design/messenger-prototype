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
  version: '1.0.25',
  scheme: 'messenger-preview',
  orientation: 'default',
  userInterfaceStyle: 'light',
  backgroundColor: '#F5F7F9',
  locales: { en: './locales/en.json', ru: './locales/ru.json' },
  ios: {
    supportsTablet: true,
    bundleIdentifier: iosBundleIdentifier,
    buildNumber: '23',
    infoPlist: {
      // Local-network HTTP is only for an explicitly configured development server.
      NSAppTransportSecurity: process.env.MESSENGER_ALLOW_LOCAL_HTTP === '1'
        ? { NSAllowsArbitraryLoads: true, NSAllowsLocalNetworking: true }
        : { NSAllowsLocalNetworking: false },
      NSLocalNetworkUsageDescription: 'Connect to your test server on the local network.',
      CFBundleAllowMixedLocalizations: true,
    },
  },
  android: {
    package: androidPackage,
    versionCode: 39,
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
    './plugins/withLastCallNamespace.cjs',
    ['expo-localization', { supportedLocales: { ios: ['en', 'ru'], android: ['en', 'ru'] } }],
    './plugins/withLastCallPip.cjs',
    'expo-router',
    ['expo-audio', { microphonePermission: 'Microphone is used for calls and voice messages.', enableBackgroundRecording: false, enableBackgroundPlayback: false }],
    ['expo-camera', { cameraPermission: 'Camera is used for video calls and video circles.', microphonePermission: 'Microphone is used for calls and recorded messages.', recordAudioAndroid: true }],
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
    './plugins/withLastCallStrings.cjs',
    './plugins/withLastCallNotifications.cjs',
    './plugins/withWebRtc155Release.cjs',
    ['@config-plugins/react-native-webrtc', {
      cameraPermission: 'Camera is used for video calls you start yourself.',
      microphonePermission: 'Microphone is used for voice and video calls.',
    }],
    ['expo-image-picker', {
      photosPermission: 'Choose a photo or video to send to your contact.',
      // false blocks these globally, including WebRTC call permissions.
      cameraPermission: 'Camera is used for video calls you start yourself.',
      microphonePermission: 'Microphone is used for voice and video calls.',
    }],
  ],
};

export default config;
