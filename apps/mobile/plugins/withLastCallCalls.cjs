const { withAndroidManifest, withDangerousMod, withMainApplication } = require('expo/config-plugins');
const fs = require('node:fs/promises');
const path = require('node:path');
module.exports = function withLastCallCalls(config) {
  config = withAndroidManifest(config, mod => {
    const manifest = mod.modResults.manifest;
    manifest['uses-permission'] ??= [];
    for (const name of ['FOREGROUND_SERVICE', 'FOREGROUND_SERVICE_PHONE_CALL', 'FOREGROUND_SERVICE_MICROPHONE', 'FOREGROUND_SERVICE_CAMERA', 'MANAGE_OWN_CALLS', 'READ_PHONE_NUMBERS', 'CALL_PHONE']) {
      const permission = `android.permission.${name}`;
      if (!manifest['uses-permission'].some(item => item.$['android:name'] === permission)) manifest['uses-permission'].push({ $: { 'android:name': permission } });
    }
    const app = manifest.application[0]; app.service ??= [];
    manifest.$['xmlns:tools'] = 'http://schemas.android.com/tools'; app['meta-data'] ??= [];
    const metadata = { $: { 'android:name': 'org.unimodules.core.AppLoader#react-native-headless', 'android:value': 'dev.messenger.prototype.calls.LastCallHeadlessAppLoader', 'tools:replace': 'android:value' } };
    const loaderIndex = app['meta-data'].findIndex(item => item.$['android:name'] === metadata.$['android:name']);
    if (loaderIndex < 0) app['meta-data'].push(metadata); else app['meta-data'][loaderIndex] = metadata;
    const entries = [
      { $: { 'android:name': 'io.wazo.callkeep.VoiceConnectionService', 'android:label': 'LastCall', 'android:permission': 'android.permission.BIND_TELECOM_CONNECTION_SERVICE', 'android:exported': 'true', 'android:foregroundServiceType': 'phoneCall|microphone' }, 'intent-filter': [{ action: [{ $: { 'android:name': 'android.telecom.ConnectionService' } }] }] },
      { $: { 'android:name': 'io.wazo.callkeep.RNCallKeepBackgroundMessagingService', 'android:exported': 'false' } },
      { $: { 'android:name': 'dev.messenger.prototype.calls.LastCallAudioService', 'android:exported': 'false', 'android:foregroundServiceType': 'phoneCall|microphone|camera' } },
    ];
    for (const entry of entries) { const index = app.service.findIndex(item => item.$['android:name'] === entry.$['android:name']); if (index < 0) app.service.push(entry); else app.service[index] = entry; }
    return mod;
  });
  config = withMainApplication(config, mod => {
    const marker = 'add(dev.messenger.prototype.calls.LastCallAudioPackage())';
    if (!mod.modResults.contents.includes(marker)) {
      const target = 'PackageList(this).packages.apply {';
      if (!mod.modResults.contents.includes(target)) throw new Error('LastCall calls plugin requires Expo Kotlin MainApplication package list');
      mod.modResults.contents = mod.modResults.contents.replace(target, `${target}\n      ${marker}`);
    }
    return mod;
  });
  return withDangerousMod(config, ['android', async mod => {
    const target = path.join(mod.modRequest.platformProjectRoot, 'app/src/main/java/dev/messenger/prototype/calls');
    await fs.mkdir(target, { recursive: true });
    for (const file of ['LastCallAudioService.java', 'LastCallAudioModule.java', 'LastCallAudioPackage.java', 'LastCallHeadlessAppLoader.java', 'LastCallHostLease.java', 'LastCallWakeLease.java']) await fs.copyFile(path.join(__dirname, 'calls', file), path.join(target, file));
    return mod;
  }]);
};
