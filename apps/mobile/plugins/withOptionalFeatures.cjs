const { withAndroidManifest } = require('expo/config-plugins');

/**
 * Google Play infers required hardware from the manifest: Wi-Fi from ACCESS_WIFI_STATE, and a
 * portrait screen from Google ML Kit's portrait-only scanner activities. Neither is needed —
 * messaging works on mobile data and in any orientation — so both are declared optional, and
 * tablets, Chromebooks and devices without Wi-Fi can install the app.
 */
const OPTIONAL = ['android.hardware.wifi', 'android.hardware.screen.portrait'];

module.exports = function withOptionalFeatures(config) {
  return withAndroidManifest(config, mod => {
    const manifest = mod.modResults.manifest;
    const features = (manifest['uses-feature'] ??= []);
    for (const name of OPTIONAL) {
      const existing = features.find(feature => feature.$?.['android:name'] === name);
      if (existing) existing.$['android:required'] = 'false';
      else features.push({ $: { 'android:name': name, 'android:required': 'false' } });
    }
    return mod;
  });
};
