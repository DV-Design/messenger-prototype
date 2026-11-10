#!/usr/bin/env node
// Synthesizes the short in-chat sounds (sent / incoming) as 16-bit mono WAV.
// Original tones, no third-party samples. Output: apps/mobile/plugins/notifications/raw/.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RATE = 44100;
const out = join(dirname(fileURLToPath(import.meta.url)), '../apps/mobile/plugins/notifications/raw');

function wav(samples) {
  const data = Buffer.alloc(samples.length * 2);
  samples.forEach((value, index) => data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, value)) * 32767), index * 2));
  const header = Buffer.alloc(44);
  header.write('RIFF', 0); header.writeUInt32LE(36 + data.length, 4); header.write('WAVE', 8);
  header.write('fmt ', 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(RATE, 24); header.writeUInt32LE(RATE * 2, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
  header.write('data', 36); header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

/** A sine whose pitch glides from `from` to `to` Hz, with a 4 ms attack and exponential decay. */
function tone(seconds, from, to, decay, gain) {
  const count = Math.round(seconds * RATE);
  const samples = new Float64Array(count);
  let phase = 0;
  for (let i = 0; i < count; i++) {
    const time = i / RATE;
    const frequency = from + (to - from) * Math.min(1, time / seconds);
    phase += 2 * Math.PI * frequency / RATE;
    const envelope = Math.min(1, time / 0.004) * Math.exp(-time * decay);
    samples[i] = (Math.sin(phase) + 0.18 * Math.sin(2 * phase)) * envelope * gain;
  }
  return samples;
}

function mix(length, parts) {
  const samples = new Float64Array(Math.round(length * RATE));
  for (const { at, samples: part } of parts) {
    const offset = Math.round(at * RATE);
    part.forEach((value, index) => { if (offset + index < samples.length) samples[offset + index] += value; });
  }
  return Array.from(samples);
}

mkdirSync(out, { recursive: true });
// Sent: a quick rising glide, like a light "whoosh" up.
writeFileSync(join(out, 'lastcall_sent.wav'), wav(mix(0.16, [{ at: 0, samples: tone(0.15, 520, 1180, 26, 0.32) }])));
// Incoming: two short rising notes, a soft "pop-pop".
writeFileSync(join(out, 'lastcall_incoming.wav'), wav(mix(0.26, [
  { at: 0, samples: tone(0.12, 784, 820, 34, 0.3) },
  { at: 0.085, samples: tone(0.17, 1175, 1210, 24, 0.3) },
])));
console.log(`written to ${out}`);
