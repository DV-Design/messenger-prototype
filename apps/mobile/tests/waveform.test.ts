import assert from 'node:assert/strict';
import test from 'node:test';
import { appendWaveformSample, WAVEFORM_CAPACITY, waveformLevel } from '../src/waveform-model';

test('real recorder dB levels produce a finite monotonic waveform with a calm silence baseline', () => {
  assert.equal(waveformLevel(-160), 0);
  assert.equal(waveformLevel(-60), 0);
  assert.equal(waveformLevel(-30), 0.5);
  assert.equal(waveformLevel(0), 1);
  assert.equal(waveformLevel(20), 1);
  assert.ok(waveformLevel(-50)! < waveformLevel(-20)!);
});

test('missing and invalid native metering remains unknown, never a fabricated amplitude', () => {
  for (const value of [undefined, NaN, Infinity, -Infinity]) assert.equal(waveformLevel(value), null);
  assert.deepEqual(appendWaveformSample([], undefined), [null]);
});

test('rolling recording history is bounded, chronological and does not mutate prior samples', () => {
  const first = Object.freeze([0, 0.5, null]);
  assert.deepEqual(appendWaveformSample(first, 0), [0, 0.5, null, 1]);
  assert.deepEqual(first, [0, 0.5, null]);
  let samples = appendWaveformSample([], -60);
  for (let i = 0; i < WAVEFORM_CAPACITY * 20; i++) samples = appendWaveformSample(samples, -30);
  assert.equal(samples.length, WAVEFORM_CAPACITY);
  assert.ok(samples.every(sample => sample === 0.5));
  const next = appendWaveformSample(samples, 0);
  assert.equal(next.length, WAVEFORM_CAPACITY);
  assert.equal(next.at(-1), 1);
  assert.deepEqual(appendWaveformSample([], -160), [0], 'a fresh recording starts with fresh history');
});
