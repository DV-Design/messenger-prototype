import { requireNativeModule } from 'expo-modules-core';
import { Platform } from 'react-native';
import { t } from './i18n';

interface LastCallVideoNative {
  concatMp4(inputs: string[], output: string): Promise<number>;
  composeCircle(segments: string[], endedAtMs: number[], audio: string, audioStartedAtMs: number, output: string, withGaps: boolean): Promise<number>;
}

let native: LastCallVideoNative | undefined;

/**
 * Android-only: joins the camera segments recorded before and after a lens
 * switch into one MP4. The native side normalizes rotation and frame sizes.
 */
export async function mergeCircleSegments(inputs: string[], output: string): Promise<number> {
  if (Platform.OS !== 'android') throw new Error(t('Camera switching during recording is unavailable on this device.'));
  try {
    native ??= requireNativeModule<LastCallVideoNative>('LastCallVideo');
    const durationMs = await native.concatMp4(inputs, output);
    if (!Number.isFinite(durationMs) || durationMs <= 0) throw new Error('invalid duration');
    return durationMs;
  } catch {
    throw new Error(t('The recorded segments could not be merged.'));
  }
}

/**
 * Android: a circle whose voice was recorded on its own, without a break across lens switches. The
 * silent camera segments are laid on the voice's timeline (a held gap while the lens changed); if
 * the device cannot render gaps, the segments are joined back to back under the same voice.
 */
export async function composeCircle(segments: { uri: string; endedAt: number }[], audio: string, audioStartedAt: number, output: string): Promise<number> {
  if (Platform.OS !== 'android') throw new Error(t('Camera switching during recording is unavailable on this device.'));
  native ??= requireNativeModule<LastCallVideoNative>('LastCallVideo');
  const run = async (withGaps: boolean) => {
    const durationMs = await native!.composeCircle(segments.map(item => item.uri), segments.map(item => item.endedAt), audio, audioStartedAt, output, withGaps);
    if (!Number.isFinite(durationMs) || durationMs <= 0) throw new Error('invalid duration');
    return durationMs;
  };
  try { return await run(true); } catch {
    try { return await run(false); } catch { throw new Error(t('The recorded segments could not be merged.')); }
  }
}
