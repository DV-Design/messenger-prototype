import assert from 'node:assert/strict';
import test from 'node:test';
// The config plugin is plain CommonJS; loading it here keeps the mod logic unit-testable.
const plugin = require('../plugins/withLastCallPip.cjs');

const manifest = () => ({
  manifest: {
    application: [{
      activity: [
        { $: { 'android:name': 'dev.messenger.prototype.calls.LastCallCallActivity' } },
        { $: { 'android:name': '.MainActivity', 'android:configChanges': 'keyboard|orientation|screenSize|assetsPaths', 'android:exported': 'true' } },
      ],
    }],
  },
});

const kotlin = () => `package dev.messenger.prototype

import android.os.Build
import android.os.Bundle

import com.facebook.react.ReactActivity

class MainActivity : ReactActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(null)
  }
}
`;

test('manifest enables PiP, preserves config changes and adds a non-exported close receiver', () => {
  const result = plugin.applyManifest(manifest());
  const activity = result.manifest.application[0].activity.find((item: any) => item.$['android:name'] === '.MainActivity');
  assert.equal(activity.$['android:supportsPictureInPicture'], 'true');
  const changes = activity.$['android:configChanges'].split('|');
  for (const required of plugin.REQUIRED_CONFIG_CHANGES) assert.ok(changes.includes(required), required);
  assert.ok(changes.includes('keyboard') && changes.includes('assetsPaths'));
  const receiver = result.manifest.application[0].receiver[0];
  assert.equal(receiver.$['android:name'], 'dev.messenger.prototype.pip.LastCallPipCloseReceiver');
  assert.equal(receiver.$['android:exported'], 'false');
});

test('manifest transform is idempotent and repairs receiver export', () => {
  const once = plugin.applyManifest(manifest());
  const twice = plugin.applyManifest(once);
  assert.deepEqual(twice, once);
  assert.equal(twice.manifest.application[0].receiver.length, 1);
  const changes = twice.manifest.application[0].activity[1].$['android:configChanges'].split('|');
  assert.equal(new Set(changes).size, changes.length);
});

test('MainActivity hooks are generated once, import the helper and never replace existing overrides', () => {
  const once = plugin.applyMainActivity(kotlin());
  const twice = plugin.applyMainActivity(once);
  assert.equal(twice, once);
  assert.equal((twice.match(/@generated begin lastcall-pip-imports/g) || []).length, 1);
  assert.equal((twice.match(/override fun onPictureInPictureModeChanged\(/g) || []).length, 1);
  assert.equal((twice.match(/LastCallPip\.onUserLeaveHint\(this\)/g) || []).length, 1);
  assert.match(twice, /import dev\.messenger\.prototype\.pip\.LastCallPip/);
  assert.match(twice, /override fun onCreate\(savedInstanceState: Bundle\?\) \{/);
  assert.ok(twice.trimEnd().endsWith('}'));
});

test('MainApplication registers the package once', () => {
  const source = `class MainApplication {
  PackageList(this).packages.apply {
  }
}`;
  const once = plugin.applyMainApplication(source);
  assert.equal(plugin.applyMainApplication(once), once);
  assert.equal((once.match(/LastCallPipPackage\(\)/g) || []).length, 1);
});
