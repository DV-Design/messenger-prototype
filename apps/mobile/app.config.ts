import type { ExpoConfig } from 'expo/config';

// Only the Firebase Android client file belongs in a native build.
// The Firebase Admin service account stays exclusively on the server.
const googleServicesFile = process.env.MESSENGER_GOOGLE_SERVICES_FILE;
// Direct sideload builds keep the in-app APK updater. Store builds must use
// Google Play/App Store updates and never request REQUEST_INSTALL_PACKAGES.
const distribution = process.env.LASTCALL_DISTRIBUTION === 'store' ? 'store' : 'direct';
const androidPackage = process.env.LASTCALL_ANDROID_PACKAGE ?? (distribution === 'store' ? 'ru.lastcall.app' : 'dev.messenger.prototype');
const iosBundleIdentifier = process.env.LASTCALL_IOS_BUNDLE_ID ?? (distribution === 'store' ? 'ru.lastcall.app' : 'dev.messenger.prototype');
// Android needs the Google Maps SDK for the location picker; iOS uses Apple Maps and needs no key.
const androidGoogleMapsApiKey = process.env.LASTCALL_ANDROID_MAPS_API_KEY;
// KLIPY (GIF and sticker search) client key: from the environment or a file outside the repository.
// The app calls KLIPY directly from the phone; without a key the GIF tab says search is not set up.
const klipyKey = process.env.LASTCALL_KLIPY_KEY ?? (() => {
  try { return require('node:fs').readFileSync(require('node:path').join(require('node:os').homedir(), '.config/lastcall/klipy.key'), 'utf8').trim(); } catch { return ''; }
})();
const config: ExpoConfig = {
  name: 'LastCall',
  slug: 'messenger-prototype',
  icon: './assets/lastcall-icon.png',
  version: '1.0.53',
  scheme: 'messenger-preview',
  orientation: 'default',
  userInterfaceStyle: 'light',
  backgroundColor: '#F5F7F9',
  locales: { en: './locales/en.json', ru: './locales/ru.json' },
  ios: {
    supportsTablet: true,
    bundleIdentifier: iosBundleIdentifier,
    buildNumber: '24',
    infoPlist: {
      // Local-network HTTP is only for an explicitly configured development server.
      NSAppTransportSecurity: process.env.MESSENGER_ALLOW_LOCAL_HTTP === '1'
        ? { NSAllowsArbitraryLoads: true, NSAllowsLocalNetworking: true }
        : { NSAllowsLocalNetworking: false },
      NSLocalNetworkUsageDescription: 'Connect to your test server on the local network.',
      CFBundleAllowMixedLocalizations: true,
      NSContactsUsageDescription: 'Choose a contact to send in a chat. Contacts stay on this phone.',
    },
  },
  android: {
    package: androidPackage,
    versionCode: 68,
    allowBackup: false,
    adaptiveIcon: { foregroundImage: './assets/lastcall-icon.png', backgroundColor: '#FFFFFF' },
    ...(googleServicesFile ? { googleServicesFile } : {}),
    permissions: ['INTERNET', 'ACCESS_NETWORK_STATE', 'RECORD_AUDIO', 'CAMERA', 'MODIFY_AUDIO_SETTINGS', 'USE_FULL_SCREEN_INTENT', 'ACCESS_FINE_LOCATION', 'ACCESS_COARSE_LOCATION', 'READ_CONTACTS', ...(distribution === 'direct' ? ['REQUEST_INSTALL_PACKAGES'] : [])],
    // Self-managed calls need no phone-number/phone-state access or Phone-app account setup.
    // READ_CONTACTS is asked only when the person shares a contact; LastCall never writes to the book.
    blockedPermissions: ['android.permission.WRITE_CONTACTS', 'android.permission.READ_CALL_LOG', 'android.permission.WRITE_CALL_LOG', 'android.permission.READ_PHONE_NUMBERS', 'android.permission.CALL_PHONE', 'android.permission.READ_PHONE_STATE', 'android.permission.SYSTEM_ALERT_WINDOW'],
    // Only development builds permit local HTTP; release servers must use HTTPS.
  },
  extra: { nativeFcmConfigured: !!googleServicesFile, distribution, directUpdates: distribution === 'direct', klipyKey: /^[A-Za-z0-9_-]{16,128}$/.test(klipyKey) ? klipyKey : '' },
  plugins: [
    './plugins/withLastCallNamespace.cjs',
    // The languages LastCall has (i18n/languages.json); Android keeps only these translations and lists them in its per-app language setting.
    ['expo-localization', { supportedLocales: { ios: ['en', 'ru', 'es', 'pt', 'fr', 'de', 'it', 'pl', 'uk', 'tr', 'ar', 'fa', 'he', 'ur', 'hi', 'bn', 'id', 'ms', 'vi', 'th', 'zh-Hans', 'zh-Hant', 'ja', 'ko', 'nl', 'ro', 'cs', 'el', 'kk', 'uz'], android: ['en', 'ru', 'es', 'pt', 'fr', 'de', 'it', 'pl', 'uk', 'tr', 'ar', 'fa', 'he', 'ur', 'hi', 'bn', 'id', 'ms', 'vi', 'th', 'zh-Hans', 'zh-Hant', 'ja', 'ko', 'nl', 'ro', 'cs', 'el', 'kk', 'uz'] } }],
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
    './plugins/withOptionalFeatures.cjs',
    'expo-sharing',
    './plugins/withLastCallCalls.cjs',
    './plugins/withPersistentCircleCamera.cjs',
    './plugins/withReleaseSigning.cjs',
    './plugins/withLastCallStrings.cjs',
    './plugins/withLastCallNotifications.cjs',
    './plugins/withWebRtc155Release.cjs',
    './plugins/withRoomKeep.cjs',
    // "Share → LastCall" for text and any files, and "LastCall" in the text selection menu.
    './plugins/withLastCallShare.cjs',
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
    ['expo-location', {
      locationWhenInUsePermission: 'Used to show your position on the map and to share your location with a contact.',
      // Never "Always"/background access: location is shared only while LastCall is open or its own
      // foreground-service notification is visible, never behind the OS's back.
      locationAlwaysAndWhenInUsePermission: false,
      locationAlwaysPermission: false,
      isIosBackgroundLocationEnabled: false,
      isAndroidBackgroundLocationEnabled: false,
      // Keeps the process alive, with a visible notification, only while a live share is running.
      isAndroidForegroundServiceEnabled: true,
    }],
    ['react-native-maps', { ...(androidGoogleMapsApiKey ? { androidGoogleMapsApiKey } : {}) }],
  ],
};

export default config;
