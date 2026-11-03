/** Adds English/Russian strings for native notifications and the call screen. */
const { withDangerousMod } = require('expo/config-plugins');
const fs = require('node:fs/promises');
const path = require('node:path');

module.exports = function withLastCallStrings(config) {
  return withDangerousMod(config, ['android', async (mod) => {
    const res = path.join(mod.modRequest.platformProjectRoot, 'app/src/main/res');
    for (const locale of ['values', 'values-ru']) {
      const target = path.join(res, locale);
      await fs.mkdir(target, { recursive: true });
      await fs.copyFile(path.join(__dirname, 'strings', locale, 'lastcall_strings.xml'), path.join(target, 'lastcall_strings.xml'));
    }
    return mod;
  }]);
};
