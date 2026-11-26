import { requireNativeModule } from 'expo-modules-core';

export interface LastCallVideoNative {
  concatMp4(inputs: string[], output: string): Promise<number>;
  composeCircle(segments: string[], endedAtMs: number[], audio: string, audioStartedAtMs: number, output: string, withGaps: boolean): Promise<number>;
}

export default requireNativeModule<LastCallVideoNative>('LastCallVideo');
