export const WAVEFORM_CAPACITY = 56;
export type WaveformSample = number | null;

/** Native expo-audio metering is dBFS. Keep missing readings distinct from real silence. */
export function waveformLevel(decibels: number | undefined): WaveformSample {
  if (typeof decibels !== 'number' || !Number.isFinite(decibels)) return null;
  return Math.max(0, Math.min(1, (decibels + 60) / 60));
}

export function appendWaveformSample(previous: readonly WaveformSample[], decibels: number | undefined): WaveformSample[] {
  return [...previous.slice(-(WAVEFORM_CAPACITY - 1)), waveformLevel(decibels)];
}
