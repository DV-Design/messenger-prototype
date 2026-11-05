import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const plugin = readFileSync(new URL('../plugins/withLastCallCalls.cjs', import.meta.url), 'utf8');
const session = readFileSync(new URL('../plugins/calls/LastCallSpeechSession.java', import.meta.url), 'utf8');
const speechModule = readFileSync(new URL('../plugins/calls/LastCallCaptionsModule.java', import.meta.url), 'utf8');
const store = readFileSync(new URL('../../../infra/build-android-store.sh', import.meta.url), 'utf8');

test('speech is on-device only: no cloud recognizer factory and no microphone of its own', () => {
  for (const source of [session, speechModule]) assert.ok(!source.includes('createSpeechRecognizer('), 'createSpeechRecognizer may use a cloud service');
  assert.ok(session.includes('createOnDeviceSpeechRecognizer'));
  assert.ok(session.includes('EXTRA_AUDIO_SOURCE'));
  assert.ok(!session.includes('AudioRecord'));
});

test('native caption code never logs recognized words', () => {
  for (const source of [session, speechModule]) assert.ok(!/\bLog\.[dviwe]\(/.test(source));
});

test('recorded test speech needs an explicit test build and cannot reach a store build', () => {
  assert.ok(plugin.includes("process.env.LASTCALL_CAPTION_TEST_AUDIO === '1'"));
  assert.ok(store.includes('LASTCALL_CAPTION_TEST_AUDIO must not reach a store build'));
});

test('the WebRTC audio tap is installed before React and the module files are copied', () => {
  assert.ok(plugin.includes('LastCallAudioTap.install(this)'));
  for (const file of ['LastCallAudioTap.java', 'LastCallSpeechSession.java', 'LastCallCaptionsModule.java']) assert.ok(plugin.includes(file));
  assert.ok(plugin.includes('android.speech.RecognitionService'));
});
