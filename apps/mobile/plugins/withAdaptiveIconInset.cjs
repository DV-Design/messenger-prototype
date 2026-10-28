const { withAndroidManifest } = require('expo/config-plugins');
const fs = require('node:fs/promises');
const path = require('node:path');
// Expo generates the icon bitmaps in its dangerous mod before manifest mods.
// Keep the supplied raster intact; inset its adaptive layer for Android's safe zone.
module.exports = function withAdaptiveIconInset(config) {
  return withAndroidManifest(config, async mod => {
    const res = path.join(mod.modRequest.platformProjectRoot, 'app/src/main/res');
    const drawable = path.join(res, 'drawable');
    await fs.mkdir(drawable, { recursive: true });
    await fs.writeFile(path.join(drawable, 'lastcall_icon_inset.xml'), '<?xml version="1.0" encoding="utf-8"?>\n<inset xmlns:android="http://schemas.android.com/apk/res/android" android:drawable="@mipmap/ic_launcher_foreground" android:inset="12%"/>\n');
    for (const name of ['ic_launcher.xml', 'ic_launcher_round.xml']) {
      const file = path.join(res, 'mipmap-anydpi-v26', name);
      const xml = await fs.readFile(file, 'utf8');
      await fs.writeFile(file, xml.replace(/<foreground android:drawable="[^\"]+"\s*\/>/, '<foreground android:drawable="@drawable/lastcall_icon_inset"/>'));
    }
    return mod;
  });
};
