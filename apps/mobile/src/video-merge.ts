import { requireNativeModule } from 'expo-modules-core';
import { Platform } from 'react-native';
import { t } from './i18n';

interface LastCallVideoNative {
  concatMp4(inputs: string[], output: string): Promise<number>;
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
