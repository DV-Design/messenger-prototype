const { withAndroidManifest, withDangerousMod, withMainApplication } = require('expo/config-plugins');
const fs = require('node:fs/promises');
const path = require('node:path');
const PROCESS_TEXT = 'dev.messenger.prototype.share.LastCallProcessTextActivity';
const filter = (action, mimeType) => ({ action: [{ $: { 'android:name': action } }], category: [{ $: { 'android:name': 'android.intent.category.DEFAULT' } }], data: [{ $: { 'android:mimeType': mimeType } }] });
/**
 * "Share → LastCall" for text and any files (one or several), plus "LastCall" in the text selection
 * menu. The share is read by LastCallShareModule; the selection entry turns into a text share.
 */
module.exports = function withLastCallShare(config) {
  config = withMainApplication(config, mod => {
    const marker = 'add(dev.messenger.prototype.share.LastCallSharePackage())';
    if (!mod.modResults.contents.includes(marker)) {
      const target = 'PackageList(this).packages.apply {';
      if (!mod.modResults.contents.includes(target)) throw new Error('LastCall share requires Expo Kotlin MainApplication package list');
      mod.modResults.contents = mod.modResults.contents.replace(target, `${target}\n      // LastCall share target package\n      ${marker}`);
    }
    return mod;
  });
  config = withAndroidManifest(config, mod => {
    const application = mod.modResults.manifest.application?.[0];
    const main = application?.activity?.find(item => item.$['android:name'] === '.MainActivity');
    if (!application || !main) throw new Error('LastCall share requires the main activity');
    const shares = ['android.intent.action.SEND', 'android.intent.action.SEND_MULTIPLE'];
    main['intent-filter'] = (main['intent-filter'] ?? []).filter(item => !item.action?.some(action => shares.includes(action.$['android:name'])));
    main['intent-filter'].push(filter('android.intent.action.SEND', '*/*'), filter('android.intent.action.SEND_MULTIPLE', '*/*'));
    application.activity = application.activity.filter(item => item.$['android:name'] !== PROCESS_TEXT);
    application.activity.push({
      $: { 'android:name': PROCESS_TEXT, 'android:label': '@string/app_name', 'android:exported': 'true', 'android:excludeFromRecents': 'true', 'android:noHistory': 'true', 'android:taskAffinity': '', 'android:theme': '@android:style/Theme.Translucent.NoTitleBar' },
      'intent-filter': [filter('android.intent.action.PROCESS_TEXT', 'text/plain')],
    });
    return mod;
  });
  return withDangerousMod(config, ['android', async mod => {
    const target = path.join(mod.modRequest.platformProjectRoot, 'app/src/main/java/dev/messenger/prototype/share');
    await fs.mkdir(target, { recursive: true });
    for (const file of ['LastCallProcessTextActivity.java', 'LastCallShareModule.java', 'LastCallSharePackage.java']) await fs.copyFile(path.join(__dirname, 'share', file), path.join(target, file));
    return mod;
  }]);
};
