import assert from 'node:assert/strict';
import test from 'node:test';
import { formatMediaDiagnostics, sanitizeDiagnostic } from '../src/diagnostics';
test('diagnostics redact known names/usernames/messages/keys case-insensitively including regex characters', () => {
  const privateKey = 'abcdef1234567890'.repeat(4);
  const privateValues = ['Иван Петров', 'ivan_test', 'Alice (QA)+', 'личное сообщение', privateKey];
  const input = `ИВАН ПЕТРОВ / ivan_TEST: ICE failure; Alice (QA)+: личное сообщение; @someone; +7 (999) 123-45-67; ${privateKey}\nnext`;
  const output = sanitizeDiagnostic(input, privateValues);
  for (const value of ['иван', 'ivan_test', 'Alice', 'личное сообщение', '999', privateKey, '@someone']) assert.equal(output.toLowerCase().includes(value.toLowerCase()), false, value);
  assert.match(output, /ICE failure/); assert.equal(output.includes('\n'), false);
});
test('media report preserves actual codecs and metrics including measured zero instead of inventing values', () => {
  const result = formatMediaDiagnostics({ videoCodec: 'video/VP8', remoteVideoCodec: 'video/h264', videoWidth: 1280, videoHeight: 720, videoFramesPerSecond: 29.8, videoBitrateKbps: 876.5, remoteVideoWidth: 640, remoteVideoHeight: 360, remoteVideoFramesPerSecond: 24, videoFramesDecoded: 600, videoFramesDropped: 0, videoFreezeCount: 0, videoFreezeSeconds: 0, videoEncodeMs: 4.2, videoQualityLimitation: 'cpu', rttMs: 63 });
  assert.match(result[0]!, /RTT 63.0 мс/); assert.match(result[1]!, /VP8 · 1280×720 · 29.8 кадр\/с · 876.5 кбит\/с/);
  assert.match(result[2]!, /H264 · 640×360 · 24.0 кадр\/с · декодировано 600 · пропущено 0/);
  assert.match(result[3]!, /Зависания: 0 · всего 0.0 с/); assert.match(result[3]!, /ограничение: процессор/);
});
test('missing or malformed media diagnostics remain unknown and cannot inject private data', () => {
  const empty = formatMediaDiagnostics().join('\n');
  assert.equal(empty.includes('0'), false); assert.equal(empty.includes('VP8'), false);
  const result = formatMediaDiagnostics({ videoCodec: 'video/VP8\nsecret', remoteVideoCodec: 'https://192.168.1.1/private-key', videoWidth: NaN, videoHeight: Infinity, videoFramesPerSecond: -1, videoBitrateKbps: 'secret', videoFramesDecoded: 1.5, videoFreezeCount: -1, videoQualityLimitation: '__proto__', privateKey: 'secret', sdp: 'secret', text: 'secret', ip: '192.168.1.1' }).join('\n');
  for (const value of ['secret', '192.168', 'VP8', 'NaN', 'Infinity', '__proto__']) assert.equal(result.includes(value), false);
  assert.match(result, /декодировано —/); assert.match(result, /ограничение: —/);
});
