import { requireNativeModule } from 'expo-modules-core';

export interface LastCallVideoNative {
  concatMp4(inputs: string[], output: string): Promise<number>;
}

export default requireNativeModule<LastCallVideoNative>('LastCallVideo');
