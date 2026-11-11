const { withAndroidManifest, withAppBuildGradle, withDangerousMod, withMainApplication } = require('expo/config-plugins');
const fs = require('node:fs/promises');
const path = require('node:path');
module.exports = function withLastCallCalls(config) {
  config = withAndroidManifest(config, mod => {
    const manifest = mod.modResults.manifest;
    manifest['uses-permission'] ??= [];
    // Legacy SCO requires this install-time permission; modern communication-device APIs do not.
    const bluetooth = manifest['uses-permission'].find(item => item.$['android:name'] === 'android.permission.BLUETOOTH');
    if (bluetooth) bluetooth.$['android:maxSdkVersion'] = '30';
    else manifest['uses-permission'].push({ $: { 'android:name': 'android.permission.BLUETOOTH', 'android:maxSdkVersion': '30' } });
    for (const name of ['FOREGROUND_SERVICE', 'FOREGROUND_SERVICE_PHONE_CALL', 'FOREGROUND_SERVICE_MICROPHONE', 'FOREGROUND_SERVICE_CAMERA', 'MANAGE_OWN_CALLS', 'USE_FULL_SCREEN_INTENT', 'WAKE_LOCK', 'VIBRATE']) {
      const permission = `android.permission.${name}`;
      if (!manifest['uses-permission'].some(item => item.$['android:name'] === permission)) manifest['uses-permission'].push({ $: { 'android:name': permission } });
    }
    // Android 11+ package visibility: without these the on-device recognizer and speech engines are not found.
    manifest.queries ??= [];
    for (const service of ['android.speech.RecognitionService', 'android.intent.action.TTS_SERVICE']) {
      if (!manifest.queries.some(entry => (entry.intent ?? []).some(intent => (intent.action ?? []).some(action => action.$['android:name'] === service)))) {
        manifest.queries.push({ intent: [{ action: [{ $: { 'android:name': service } }] }] });
      }
    }
    const app = manifest.application[0]; app.service ??= []; app.activity ??= [];
    manifest.$['xmlns:tools'] = 'http://schemas.android.com/tools'; app['meta-data'] ??= [];
    const metadata = { $: { 'android:name': 'org.unimodules.core.AppLoader#react-native-headless', 'android:value': 'dev.messenger.prototype.calls.LastCallHeadlessAppLoader', 'tools:replace': 'android:value' } };
    const loaderIndex = app['meta-data'].findIndex(item => item.$['android:name'] === metadata.$['android:name']);
    if (loaderIndex < 0) app['meta-data'].push(metadata); else app['meta-data'][loaderIndex] = metadata;
    // Emulators have a silent microphone. Only an explicit test build can replace it with a recorded phrase.
    const captionTest = 'dev.messenger.prototype.captionTestAudio';
    app['meta-data'] = app['meta-data'].filter(item => item.$['android:name'] !== captionTest);
    if (process.env.LASTCALL_CAPTION_TEST_AUDIO === '1') app['meta-data'].push({ $: { 'android:name': captionTest, 'android:value': 'true' } });
    const services = [
      { $: { 'android:name': 'io.wazo.callkeep.VoiceConnectionService', 'android:label': 'LastCall', 'android:permission': 'android.permission.BIND_TELECOM_CONNECTION_SERVICE', 'android:exported': 'true', 'android:foregroundServiceType': 'phoneCall' }, 'intent-filter': [{ action: [{ $: { 'android:name': 'android.telecom.ConnectionService' } }] }] },
      { $: { 'android:name': 'io.wazo.callkeep.RNCallKeepBackgroundMessagingService', 'android:exported': 'false' } },
      { $: { 'android:name': 'dev.messenger.prototype.calls.LastCallAudioService', 'android:exported': 'false', 'android:foregroundServiceType': 'phoneCall|microphone|camera' } },
      { $: { 'android:name': 'dev.messenger.prototype.calls.LastCallCallSetupService', 'android:exported': 'false', 'android:foregroundServiceType': 'phoneCall' } },
      { $: { 'android:name': 'dev.messenger.prototype.calls.LastCallCallUiService', 'android:exported': 'false', 'android:foregroundServiceType': 'phoneCall' } },
      // Default priority 0 outranks Expo's -1, and it is the service FCM resolves.
      { $: { 'android:name': 'dev.messenger.prototype.calls.LastCallMessagingService', 'android:exported': 'false' }, 'intent-filter': [{ action: [{ $: { 'android:name': 'com.google.firebase.MESSAGING_EVENT' } }] }] },
    ];
    for (const entry of services) { const index = app.service.findIndex(item => item.$['android:name'] === entry.$['android:name']); if (index < 0) app.service.push(entry); else app.service[index] = entry; }
    const activities = [
      { $: { 'android:name': 'dev.messenger.prototype.calls.LastCallCallActivity', 'android:exported': 'false', 'android:excludeFromRecents': 'true', 'android:launchMode': 'singleTask', 'android:taskAffinity': '' } },
    ];
    for (const entry of activities) { const index = app.activity.findIndex(item => item.$['android:name'] === entry.$['android:name']); if (index < 0) app.activity.push(entry); else app.activity[index] = entry; }
    return mod;
  });
  // expo-notifications keeps Firebase private to its module; LastCallMessagingService extends it.
  config = withAppBuildGradle(config, mod => {
    for (const line of ["implementation 'com.google.firebase:firebase-messaging:25.0.1'", "implementation 'com.google.mlkit:translate:17.0.3'", "implementation 'com.google.mlkit:language-id:17.0.6'"]) {
      if (mod.modResults.contents.includes(line)) continue;
      if (!/\ndependencies \{/.test(mod.modResults.contents)) throw new Error('LastCall calls plugin requires an app dependencies block');
      mod.modResults.contents = mod.modResults.contents.replace(/\ndependencies \{/, `\ndependencies {\n    ${line}`);
    }
    return mod;
  });
  config = withMainApplication(config, mod => {
    const marker = 'add(dev.messenger.prototype.calls.LastCallAudioPackage())';
    if (!mod.modResults.contents.includes(marker)) {
      const target = 'PackageList(this).packages.apply {';
      if (!mod.modResults.contents.includes(target)) throw new Error('LastCall calls plugin requires Expo Kotlin MainApplication package list');
      mod.modResults.contents = mod.modResults.contents.replace(target, `${target}\n      ${marker}`);
    }
    // Before React creates WebRTCModule, which reads this option once.
    const tap = 'dev.messenger.prototype.calls.LastCallAudioTap.install(this)';
    if (!mod.modResults.contents.includes(tap)) {
      if (!mod.modResults.contents.includes('super.onCreate()')) throw new Error('LastCall calls plugin requires Application.onCreate');
      mod.modResults.contents = mod.modResults.contents.replace('super.onCreate()', `super.onCreate()\n    ${tap}`);
    }
    return mod;
  });
  return withDangerousMod(config, ['android', async mod => {
    const target = path.join(mod.modRequest.platformProjectRoot, 'app/src/main/java/dev/messenger/prototype/calls');
    await fs.mkdir(target, { recursive: true });
    for (const file of ['LastCallAudioTap.java', 'LastCallRecognizers.java', 'LastCallSpeechSession.java', 'LastCallCaptionsModule.java', 'LastCallVoice.java', 'LastCallAudioService.java', 'LastCallAudioModule.java', 'LastCallAudioPackage.java', 'LastCallAudioRoutes.java', 'LastCallHeadlessAppLoader.java', 'LastCallHostLease.java', 'LastCallWakeLease.java', 'LastCallCallUiService.java', 'LastCallCallActivity.java', 'LastCallCallSetupService.java', 'LastCallCpuWake.java', 'LastCallCallTrace.java', 'LastCallMessagingService.java']) await fs.copyFile(path.join(__dirname, 'calls', file), path.join(target, file));
    return mod;
  }]);
};
