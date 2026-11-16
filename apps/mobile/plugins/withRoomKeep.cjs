const { withDangerousMod } = require('expo/config-plugins');
const fs = require('node:fs/promises');
const path = require('node:path');

const marker = 'lastcall-room-database-keep';
// react-native-maps pulls androidx.work 2.9.1 (Room 2.5). Room creates
// WorkDatabase_Impl reflectively through its no-arg constructor, which R8 full
// mode removes; the release app then crashes on start in WorkManagerInitializer.
// This is the keep rule Room documents for generated database implementations.
const rules = `\n# ${marker}\n# Room instantiates generated *_Impl databases reflectively (WorkManager via\n# react-native-maps); keep their no-arg constructors or release crashes on start.\n-keep class * extends androidx.room.RoomDatabase { <init>(); }\n`;

function withRoomKeep(config) {
  return withDangerousMod(config, ['android', async mod => {
    const target = path.join(mod.modRequest.platformProjectRoot, 'app', 'proguard-rules.pro');
    const current = await fs.readFile(target, 'utf8');
    if (!current.includes(marker)) await fs.writeFile(target, current + rules);
    return mod;
  }]);
}
withRoomKeep.rules = rules;
module.exports = withRoomKeep;
