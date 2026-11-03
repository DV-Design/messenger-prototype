import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
// Plain CommonJS plugin; loading it keeps the guard logic unit-testable.
const plugin = require('../plugins/withPersistentCircleCamera.cjs');

const RELATIVE_SOURCE = 'android/src/main/java/expo/modules/camera/ExpoCameraView.kt';
const patchPath = require.resolve('../patches/expo-camera+58.0.14+persistent-circle-camera.patch');
const installedSource = join(dirname(require.resolve('expo-camera/package.json')), RELATIVE_SOURCE);

const sha = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex');

/** Work on an isolated copy so prebuild-patched node_modules never breaks the suite. */
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'circle-camera-'));
  const file = join(dir, RELATIVE_SOURCE);
  mkdirSync(dirname(file), { recursive: true });
  copyFileSync(installedSource, file);
  return { dir, file };
}

function runGitApply(cwd: string, args: string[]) {
  execFileSync('git', ['apply', ...args], { cwd, stdio: 'pipe' });
}

/** Normalize either upstream or already-patched installs back to upstream in the temp copy. */
function toUpstream(dir: string, file: string) {
  if (sha(file) === plugin.PATCHED_SHA256) runGitApply(dir, ['-R', patchPath]);
  assert.equal(sha(file), plugin.ORIGINAL_SHA256, 'fixture must be the known upstream source');
}

test('forward patch really applies and reaches the exact patched hash', () => {
  const installedBefore = sha(installedSource);
  const { dir, file } = fixture();
  try {
    toUpstream(dir, file);
    runGitApply(dir, [patchPath]);
    assert.equal(sha(file), plugin.PATCHED_SHA256);
    assert.equal(plugin.classifySource(plugin.EXPECTED_VERSION, sha(file)), 'applied');
    // Idempotence is hash-based: a second application is refused, never silently duplicated.
    assert.throws(() => runGitApply(dir, [patchPath]));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  assert.equal(sha(installedSource), installedBefore, 'installed source must not be mutated');
});

test('unknown source and version fail closed, without touching installed source', () => {
  const installedBefore = sha(installedSource);
  const { dir, file } = fixture();
  try {
    toUpstream(dir, file);
    assert.equal(plugin.classifySource('58.0.15', plugin.ORIGINAL_SHA256), 'unknown-version');
    // Drift a line that the patch actually relies on as context.
    writeFileSync(file, readFileSync(file, 'utf8').replace('fun pausePreview() {', 'fun pausePreviewDrift() {'));
    assert.equal(plugin.classifySource(plugin.EXPECTED_VERSION, sha(file)), 'unknown-source');
    assert.throws(() => runGitApply(dir, ['--check', patchPath]));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  assert.equal(sha(installedSource), installedBefore, 'installed source must not be mutated');
});

test('CameraX pin upgrades only the known baseline and is idempotent', () => {
  const source = `android { def camerax_version = "${plugin.CAMERAX_BASELINES[0]}" }`;
  const upgraded = plugin.upgradeBuildGradle(source);
  assert.ok(upgraded.includes(`def camerax_version = "${plugin.CAMERAX_TARGET}"`));
  assert.equal(plugin.upgradeBuildGradle(upgraded), upgraded);
  assert.throws(() => plugin.upgradeBuildGradle('android { def camerax_version = "9.9.9" }'), /unknown CameraX pin/);
});

test('patch keeps the privacy and opt-in corrections', () => {
  const patch = readFileSync(patchPath, 'utf8');
  for (const anchor of [
    '@androidx.annotation.OptIn(ExperimentalPersistentRecording::class)',
    'asPersistentRecording()',
    'persistentVideoCapture',
    'isAtLeast(Lifecycle.State.STARTED)',
    'stopRecording()',
    'Lifecycle.Event.ON_STOP',
    'removeRecordingLifecycleObserver()',
  ]) {
    assert.ok(patch.includes(anchor), `patch is missing ${anchor}`);
  }
});
