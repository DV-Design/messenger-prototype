const { withDangerousMod, withMainApplication } = require('expo/config-plugins');
const fs = require('node:fs/promises');
const path = require('node:path');
module.exports = function withLastCallNotifications(config) {
  config = withMainApplication(config, mod => {
    const marker = 'add(dev.messenger.prototype.notifications.LastCallNotificationsPackage())';
    if (!mod.modResults.contents.includes(marker)) {
      const target = 'PackageList(this).packages.apply {';
      if (!mod.modResults.contents.includes(target)) throw new Error('LastCall notifications requires Expo Kotlin MainApplication package list');
      mod.modResults.contents = mod.modResults.contents.replace(target, `${target}\n      // LastCall message notification package\n      ${marker}`);
    }
    return mod;
  });
  return withDangerousMod(config, ['android', async mod => {
    const target = path.join(mod.modRequest.platformProjectRoot, 'app/src/main/java/dev/messenger/prototype/notifications');
    await fs.mkdir(target, { recursive: true });
    for (const file of ['LastCallNotificationsModule.java', 'LastCallNotificationsPackage.java']) await fs.copyFile(path.join(__dirname, 'notifications', file), path.join(target, file));
    return mod;
  }]);
};
