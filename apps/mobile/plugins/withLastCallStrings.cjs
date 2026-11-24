/** Native strings (notifications, call screen) in every language folder under plugins/strings. */
const { withDangerousMod } = require('expo/config-plugins');
const fs = require('node:fs/promises');
const path = require('node:path');

module.exports = function withLastCallStrings(config) {
  return withDangerousMod(config, ['android', async (mod) => {
    const res = path.join(mod.modRequest.platformProjectRoot, 'app/src/main/res');
    const folders = (await fs.readdir(path.join(__dirname, 'strings'), { withFileTypes: true })).filter(entry => entry.isDirectory() && entry.name.startsWith('values')).map(entry => entry.name);
    for (const locale of folders) {
      const target = path.join(res, locale);
      await fs.mkdir(target, { recursive: true });
      await fs.copyFile(path.join(__dirname, 'strings', locale, 'lastcall_strings.xml'), path.join(target, 'lastcall_strings.xml'));
    }
    return mod;
  }]);
};
