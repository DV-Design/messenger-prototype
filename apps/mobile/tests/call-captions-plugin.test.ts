import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const plugin = readFileSync(new URL('../plugins/withLastCallCalls.cjs', import.meta.url), 'utf8');
const session = readFileSync(new URL('../plugins/calls/LastCallSpeechSession.java', import.meta.url), 'utf8');
const voice = readFileSync(new URL('../plugins/calls/LastCallVoice.java', import.meta.url), 'utf8');
const recognizers = readFileSync(new URL('../plugins/calls/LastCallRecognizers.java', import.meta.url), 'utf8');
const speechModule = readFileSync(new URL('../plugins/calls/LastCallCaptionsModule.java', import.meta.url), 'utf8');
const store = readFileSync(new URL('../../../infra/build-android-store.sh', import.meta.url), 'utf8');

test('speech is on-device only: no default cloud recognizer and no microphone of its own', () => {
  for (const source of [session, speechModule]) assert.ok(!source.includes('createSpeechRecognizer(') && !source.includes('createOnDeviceSpeechRecognizer('), 'only LastCallRecognizers may choose a recognizer');
  assert.ok(recognizers.includes('createOnDeviceSpeechRecognizer(context)'));
  assert.equal(recognizers.match(/createSpeechRecognizer\(/g)?.length, 1);
  assert.ok(recognizers.includes('createSpeechRecognizer(context, GOOGLE)'), 'the fallback names one exact service');
  assert.ok(recognizers.includes('hasSigningCertificate'), 'and verifies who signed it');
  assert.ok(session.includes('EXTRA_AUDIO_SOURCE'));
  assert.ok(!session.includes('AudioRecord'));
});

test('the recognizer is held against firmware freezers for exactly the session', () => {
  assert.ok(recognizers.includes('Context.BIND_AUTO_CREATE | Context.BIND_IMPORTANT'));
  assert.ok(session.includes('LastCallRecognizers.hold(context)'));
  assert.ok(session.includes('unbindService(hold)'));
});

test('native caption code never logs recognized words', () => {
  for (const source of [session, speechModule, voice]) assert.ok(!/\bLog\.[dviwe]\(/.test(source));
});

test('spoken translation uses only installed offline voices of Google or a preinstalled engine', () => {
  assert.ok(voice.includes('voice.isNetworkConnectionRequired()') && voice.includes('KEY_FEATURE_NOT_INSTALLED'));
  assert.ok(voice.includes('LastCallRecognizers.googleSigned(context, GOOGLE)') && voice.includes('ApplicationInfo.FLAG_SYSTEM'));
  assert.ok(voice.includes('USAGE_VOICE_COMMUNICATION'), 'the voice follows the call audio route');
});

test('recorded test speech needs an explicit test build and cannot reach a store build', () => {
  assert.ok(plugin.includes("process.env.LASTCALL_CAPTION_TEST_AUDIO === '1'"));
  assert.ok(store.includes('LASTCALL_CAPTION_TEST_AUDIO must not reach a store build'));
});

test('the WebRTC audio tap is installed before React and the module files are copied', () => {
  assert.ok(plugin.includes('LastCallAudioTap.install(this)'));
  for (const file of ['LastCallAudioTap.java', 'LastCallRecognizers.java', 'LastCallSpeechSession.java', 'LastCallCaptionsModule.java']) assert.ok(plugin.includes(file));
  assert.ok(plugin.includes('android.speech.RecognitionService'));
  assert.ok(plugin.includes('android.intent.action.TTS_SERVICE') && plugin.includes('LastCallVoice.java'), 'speech engines must be visible and the voice class copied');
});
