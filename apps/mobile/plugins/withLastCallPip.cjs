const { withAndroidManifest, withDangerousMod, withMainActivity, withMainApplication } = require('expo/config-plugins');
const fs = require('node:fs/promises');
const path = require('node:path');

const PACKAGE = 'dev.messenger.prototype.pip';
const RECEIVER = `${PACKAGE}.LastCallPipCloseReceiver`;
// Android keeps a PiP activity alive only when these changes are handled by the activity.
const REQUIRED_CONFIG_CHANGES = ['orientation', 'screenSize', 'smallestScreenSize', 'screenLayout', 'uiMode'];
const IMPORT_MARKER_BEGIN = '// @generated begin lastcall-pip-imports';
const IMPORT_MARKER_END = '// @generated end lastcall-pip-imports';
const METHOD_MARKER_BEGIN = '// @generated begin lastcall-pip-methods';
const METHOD_MARKER_END = '// @generated end lastcall-pip-methods';

function mainActivity(manifest) {
  const app = manifest.manifest.application && manifest.manifest.application[0];
  if (!app) throw new Error('LastCall PiP plugin requires an Android application element');
  app.activity ??= [];
  const activity = app.activity.find(item => {
    const name = item.$ && item.$['android:name'];
    return typeof name === 'string' && (name === '.MainActivity' || name.endsWith('.MainActivity'));
  });
  if (!activity) throw new Error('LastCall PiP plugin requires the Expo MainActivity');
  return { app, activity };
}

/** Pure manifest transform so it can be exercised without a native project. */
function applyManifest(manifest) {
  const { app, activity } = mainActivity(manifest);
  activity.$['android:supportsPictureInPicture'] = 'true';
  const changes = new Set(String(activity.$['android:configChanges'] || '').split('|').filter(Boolean));
  for (const change of REQUIRED_CONFIG_CHANGES) changes.add(change);
  activity.$['android:configChanges'] = [...changes].join('|');
  app.receiver ??= [];
  let receiver = app.receiver.find(item => item.$ && item.$['android:name'] === RECEIVER);
  if (!receiver) {
    receiver = { $: { 'android:name': RECEIVER, 'android:exported': 'false' } };
    app.receiver.push(receiver);
  } else {
    receiver.$['android:exported'] = 'false';
  }
  return manifest;
}

function replaceBlock(source, begin, end, block, insert) {
  const start = source.indexOf(begin);
  const stop = source.indexOf(end);
  if (start >= 0 && stop > start) return source.slice(0, start) + block + source.slice(stop + end.length);
  return insert(source, block);
}

/** Pure Kotlin transform: hooks the existing Expo MainActivity, never replaces its body. */
function applyMainActivity(source) {
  const imports = [
    IMPORT_MARKER_BEGIN,
    'import android.app.PictureInPictureUiState',
    'import android.content.res.Configuration',
    `import ${PACKAGE}.LastCallPip`,
    IMPORT_MARKER_END,
  ].join('\n');
  const methods = [
    METHOD_MARKER_BEGIN,
    '  override fun onResume() {',
    '    super.onResume()',
    '    LastCallPip.onResume(this)',
    '  }',
    '',
    '  override fun onPause() {',
    '    super.onPause()',
    '    LastCallPip.onPause(this)',
    '  }',
    '',
    '  override fun onStop() {',
    '    super.onStop()',
    '    LastCallPip.onStop(this)',
    '  }',
    '',
    '  override fun onDestroy() {',
    '    LastCallPip.onDestroy(this)',
    '    super.onDestroy()',
    '  }',
    '',
    '  override fun onUserLeaveHint() {',
    '    super.onUserLeaveHint()',
    '    LastCallPip.onUserLeaveHint(this)',
    '  }',
    '',
    '  override fun onPictureInPictureModeChanged(isInPictureInPictureMode: Boolean, newConfig: Configuration) {',
    '    super.onPictureInPictureModeChanged(isInPictureInPictureMode, newConfig)',
    '    LastCallPip.onModeChanged(this, isInPictureInPictureMode)',
    '  }',
    '',
    '  override fun onPictureInPictureUiStateChanged(pipState: PictureInPictureUiState) {',
    '    super.onPictureInPictureUiStateChanged(pipState)',
    '    LastCallPip.onTransition(this, pipState.isTransitioningToPip)',
    '  }',
    METHOD_MARKER_END,
  ].join('\n');
  let next = replaceBlock(source, IMPORT_MARKER_BEGIN, IMPORT_MARKER_END, imports, (text, block) => {
    const matches = [...text.matchAll(/^import .*$/gm)];
    if (!matches.length) throw new Error('LastCall PiP plugin requires Kotlin imports in MainActivity');
    const last = matches[matches.length - 1];
    const at = last.index + last[0].length;
    return `${text.slice(0, at)}\n${block}${text.slice(at)}`;
  });
  next = replaceBlock(next, METHOD_MARKER_BEGIN, METHOD_MARKER_END, methods, (text, block) => {
    const at = text.lastIndexOf('}');
    if (at < 0) throw new Error('LastCall PiP plugin requires a MainActivity class body');
    return `${text.slice(0, at)}${block}\n${text.slice(at)}`;
  });
  return next;
}

function applyMainApplication(source) {
  const marker = `add(${PACKAGE}.LastCallPipPackage())`;
  if (source.includes(marker)) return source;
  const target = 'PackageList(this).packages.apply {';
  if (!source.includes(target)) throw new Error('LastCall PiP plugin requires Expo Kotlin MainApplication package list');
  return source.replace(target, `${target}\n      // LastCall picture-in-picture package\n      ${marker}`);
}

function withLastCallPip(config) {
  config = withAndroidManifest(config, mod => {
    mod.modResults = applyManifest(mod.modResults);
    return mod;
  });
  config = withMainActivity(config, mod => {
    mod.modResults.contents = applyMainActivity(mod.modResults.contents);
    return mod;
  });
  config = withMainApplication(config, mod => {
    mod.modResults.contents = applyMainApplication(mod.modResults.contents);
    return mod;
  });
  return withDangerousMod(config, ['android', async mod => {
    const target = path.join(mod.modRequest.platformProjectRoot, 'app/src/main/java/dev/messenger/prototype/pip');
    await fs.mkdir(target, { recursive: true });
    for (const file of ['LastCallPip.java', 'LastCallPipModule.java', 'LastCallPipPackage.java', 'LastCallPipCloseReceiver.java']) {
      await fs.copyFile(path.join(__dirname, 'pip', file), path.join(target, file));
    }
    return mod;
  }]);
}

module.exports = withLastCallPip;
module.exports.applyManifest = applyManifest;
module.exports.applyMainActivity = applyMainActivity;
module.exports.applyMainApplication = applyMainApplication;
module.exports.REQUIRED_CONFIG_CHANGES = REQUIRED_CONFIG_CHANGES;
