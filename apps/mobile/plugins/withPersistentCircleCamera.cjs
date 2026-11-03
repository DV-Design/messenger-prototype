/**
 * Applies the recorded CameraX persistent-recording patch to expo-camera.
 *
 * The patch keeps the same VideoCapture/Recorder alive while the lens changes,
 * which is what makes a mid-recording front/back switch continuous. It is
 * applied with the already-installed `git apply` before Gradle runs, against
 * one exact expo-camera release and source hash. Unknown versions or sources
 * fail the prebuild instead of being edited silently.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { withAppBuildGradle, withDangerousMod } = require('@expo/config-plugins');

const EXPECTED_VERSION = '58.0.14';
const RELATIVE_SOURCE = 'android/src/main/java/expo/modules/camera/ExpoCameraView.kt';
const RELATIVE_BUILD_GRADLE = 'android/build.gradle';
const PATCH_NAME = 'expo-camera+58.0.14+persistent-circle-camera.patch';
const ORIGINAL_SHA256 = 'f212cf1f9509e3c52a31fc82bfa8f20f0a29c8266b9ed41b399a626087061abd';
const PATCHED_SHA256 = 'fbc18b6a0b058741895eea5a1a971f75de06dc14c16135e87bd0c5509add8ec5';
const CAMERAX_BASELINES = ['1.6.0', '1.6.2'];
// CameraX 1.7.0-rc01 includes the persistent-recording camera-switch fixes.
const CAMERAX_TARGET = '1.7.0-rc01';

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

/** Pure guard used by the plugin and its focused tests. */
function classifySource(version, digest) {
  if (version !== EXPECTED_VERSION) return 'unknown-version';
  if (digest === PATCHED_SHA256) return 'applied';
  if (digest === ORIGINAL_SHA256) return 'needs-patch';
  return 'unknown-source';
}

/** Upgrades only the known CameraX pin; any other source fails closed. */
function upgradeBuildGradle(source) {
  if (source.includes(`def camerax_version = "${CAMERAX_TARGET}"`)) return source;
  const current = CAMERAX_BASELINES.map(version => `def camerax_version = "${version}"`).find(pin => source.includes(pin));
  if (!current) throw new Error('withPersistentCircleCamera: unknown CameraX pin');
  return source.replace(current, `def camerax_version = "${CAMERAX_TARGET}"`);
}

function findPackage(projectRoot) {
  let dir = projectRoot;
  for (;;) {
    const candidate = path.join(dir, 'node_modules', 'expo-camera', 'package.json');
    if (fs.existsSync(candidate)) return path.dirname(candidate);
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error('withPersistentCircleCamera: expo-camera is not installed');
}

module.exports = function withPersistentCircleCamera(config) {
  config = withAppBuildGradle(config, (cfg) => {
    const marker = '// LASTCALL_CAMERAX_FORCE';
    if (cfg.modResults.contents.includes(marker)) return cfg;
    cfg.modResults.contents += `\n${marker}\nconfigurations.all {\n  resolutionStrategy.eachDependency { details ->\n    if (details.requested.group == "androidx.camera") {\n      details.useVersion("${CAMERAX_TARGET}")\n    }\n  }\n}\n`;
    return cfg;
  });
  return withDangerousMod(config, [
    'android',
    async (config) => {
      const projectRoot = config.modRequest.projectRoot;
      const packageDir = findPackage(projectRoot);
      const packageJson = JSON.parse(fs.readFileSync(path.join(packageDir, 'package.json'), 'utf8'));
      if (packageJson.version !== EXPECTED_VERSION) {
        throw new Error(
          `withPersistentCircleCamera: expected expo-camera ${EXPECTED_VERSION}, found ${packageJson.version}`
        );
      }

      const sourcePath = path.join(packageDir, RELATIVE_SOURCE);
      if (!fs.existsSync(sourcePath)) {
        throw new Error(`withPersistentCircleCamera: missing ${sourcePath}`);
      }

      const buildGradlePath = path.join(packageDir, RELATIVE_BUILD_GRADLE);
      if (!fs.existsSync(buildGradlePath)) throw new Error(`withPersistentCircleCamera: missing ${buildGradlePath}`);
      const buildGradle = fs.readFileSync(buildGradlePath, 'utf8');
      const upgraded = upgradeBuildGradle(buildGradle);
      if (upgraded !== buildGradle) fs.writeFileSync(buildGradlePath, upgraded);

      const digest = sha256(sourcePath);
      if (digest === PATCHED_SHA256) {
        console.log('[withPersistentCircleCamera] patch already applied');
        return config;
      }
      if (digest !== ORIGINAL_SHA256) {
        throw new Error(
          `withPersistentCircleCamera: unknown ExpoCameraView.kt source (sha256 ${digest}); refusing to patch`
        );
      }

      const patchPath = path.join(projectRoot, 'patches', PATCH_NAME);
      if (!fs.existsSync(patchPath)) {
        throw new Error(`withPersistentCircleCamera: missing recorded patch ${patchPath}`);
      }

      // Only source patching: check, then apply. No other git operation.
      execFileSync('git', ['apply', '--check', patchPath], { cwd: packageDir, stdio: 'pipe' });
      execFileSync('git', ['apply', patchPath], { cwd: packageDir, stdio: 'pipe' });

      const applied = sha256(sourcePath);
      if (applied !== PATCHED_SHA256) {
        throw new Error('withPersistentCircleCamera: post-apply hash mismatch');
      }
      console.log('[withPersistentCircleCamera] applied persistent recording patch');
      return config;
    },
  ]);
};

module.exports.EXPECTED_VERSION = EXPECTED_VERSION;
module.exports.ORIGINAL_SHA256 = ORIGINAL_SHA256;
module.exports.PATCHED_SHA256 = PATCHED_SHA256;
module.exports.CAMERAX_BASELINES = CAMERAX_BASELINES;
module.exports.CAMERAX_TARGET = CAMERAX_TARGET;
module.exports.classifySource = classifySource;
module.exports.upgradeBuildGradle = upgradeBuildGradle;
