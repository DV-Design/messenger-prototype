const { withAndroidManifest } = require('expo/config-plugins');
module.exports = function withLocalNetworking(config) {
  return withAndroidManifest(config, mod => {
    const application = mod.modResults.manifest.application?.[0];
    if (application) application.$['android:usesCleartextTraffic'] = process.env.MESSENGER_ALLOW_LOCAL_HTTP === '1' ? 'true' : 'false';
    return mod;
  });
};
