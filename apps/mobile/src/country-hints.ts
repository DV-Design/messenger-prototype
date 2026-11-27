import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo-modules-core';
import { pickCountryHints } from './country-hints-model';

interface CountryNative { playCountry(): Promise<string | null> }
let native: CountryNative | null | undefined;
const within = <T,>(promise: Promise<T>, ms: number, fallback: T) =>
  Promise.race([promise.catch(() => fallback), new Promise<T>(resolve => setTimeout(() => resolve(fallback), ms))]);

/** Android only; anything unavailable is simply left out, and the server then asks for an invitation. */
export async function collectCountryHints(): Promise<string[]> {
  if (Platform.OS !== 'android') return [];
  native ??= requireOptionalNativeModule<CountryNative>('LastCallCountry');
  if (!native) return [];
  const play = await within(native.playCountry(), 4000, null);
  return pickCountryHints({ play });
}
