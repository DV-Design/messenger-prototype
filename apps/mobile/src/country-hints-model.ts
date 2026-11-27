/**
 * Which country the phone reports at sign-up: only the Google Play account country (owner's
 * decision, 2026-11-27). The mobile network and SIM are no longer read.
 */
export interface CountrySignals { play?: string | null }

const country = (value: string | null | undefined): string | undefined => {
  const code = value?.trim().toUpperCase();
  return code && /^[A-Z]{2}$/.test(code) && code !== 'ZZ' && code !== 'XX' ? code : undefined;
};

export function pickCountryHints(signals: CountrySignals): string[] {
  const play = country(signals.play);
  return play ? [play] : [];
}
