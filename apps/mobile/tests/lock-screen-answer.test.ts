import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('the calls plugin ships the lock-screen helper and installs it in Application.onCreate', () => {
  const plugin = read('plugins/withLastCallCalls.cjs');
  assert.match(plugin, /'LastCallLockScreen\.java'/);
  assert.match(plugin, /LastCallLockScreen\.install\(this\)/);
});

test('an answered call continues in the app over the lock screen, only until it ends', () => {
  const service = read('plugins/calls/LastCallAudioService.java');
  const lock = read('plugins/calls/LastCallLockScreen.java');
  // Hand-off happens before the call-only screen is closed, from that visible screen.
  assert.ok(service.indexOf('LastCallCallUiService.handOff(id)') < service.indexOf('LastCallCallUiService.stop(context, id);\n  }'));
  assert.match(service, /LastCallLockScreen\.end\(id\)/);
  assert.match(lock, /setShowWhenLocked\(on\)/);
  assert.match(lock, /requestDismissKeyguard/);
});

test('answering makes the Telecom call active at once and takes call audio focus, so another call goes quiet', () => {
  const activity = read('plugins/calls/LastCallCallActivity.java');
  const answer = activity.slice(activity.indexOf('private void answer()'), activity.indexOf('boolean answered()'));
  assert.ok(answer.indexOf('connection.onAnswer()') < answer.indexOf('connection.setActive()'));
  assert.match(answer, /CAPABILITY_SUPPORT_HOLD/);
  const routes = read('plugins/calls/LastCallAudioRoutes.java');
  assert.match(routes, /AUDIOFOCUS_GAIN/);
  assert.match(routes, /USAGE_VOICE_COMMUNICATION/);
  assert.match(routes, /abandonFocus\(manager\)/);
});

test('leaving the call view on a locked phone asks to unlock first', () => {
  const overlay = read('src/components/CallOverlay.tsx');
  assert.match(overlay, /unlockForApp\(\)\.then\(unlocked => \{ if \(unlocked\) setCallBar\(\{ collapsed: true \}\)/);
});
