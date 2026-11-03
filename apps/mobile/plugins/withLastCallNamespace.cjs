/**
 * The generated native Java sources and manifest entry points live in the
 * fixed dev.messenger.prototype package. Keep that package as the Android
 * namespace for every distribution; only applicationId changes for stores.
 * Android allows namespace and applicationId to differ, but Kotlin entry
 * points must live in the namespace so manifest `.MainActivity` resolves.
 */
const fs = require('fs');
const path = require('path');
const { withAppBuildGradle, withDangerousMod } = require('@expo/config-plugins');

const NAMESPACE = 'dev.messenger.prototype';

function patchEntryPoints(directory) {
  if (!fs.existsSync(directory)) return;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) { patchEntryPoints(target); continue; }
    if (entry.name !== 'MainActivity.kt' && entry.name !== 'MainApplication.kt') continue;
    const source = fs.readFileSync(target, 'utf8');
    const patched = source
      .replace(/^package\s+[^\n]+/m, `package ${NAMESPACE}`)
      .replace(/import\s+[^\n]+\.BuildConfig/m, `import ${NAMESPACE}.BuildConfig`);
    if (patched !== source) fs.writeFileSync(target, patched);
  }
}

module.exports = function withLastCallNamespace(config) {
  config = withAppBuildGradle(config, (cfg) => {
    const marker = '// LASTCALL_FIXED_NAMESPACE';
    if (cfg.modResults.contents.includes(marker)) return cfg;
    cfg.modResults.contents = cfg.modResults.contents.replace(/namespace\s+['"][^'"]+['"]/, `namespace '${NAMESPACE}'`);
    cfg.modResults.contents += `\n${marker}\n`;
    return cfg;
  });
  return withDangerousMod(config, ['android', async (cfg) => {
    patchEntryPoints(path.join(cfg.modRequest.platformProjectRoot, 'app/src/main/java'));
    return cfg;
  }]);
};

module.exports.NAMESPACE = NAMESPACE;
module.exports.patchEntryPoints = patchEntryPoints;
