/**
 * Which countries the phone reports at sign-up. The Google Play account country and the mobile
 * network the phone is on now describe where the person is; the SIM only describes where the
 * number comes from, so it is used only when there is no network (a Russian SIM abroad on a
 * local network is judged by the local network and the Play account).
 */
export interface CountrySignals { play?: string | null; network?: string | null; sim?: string | null }

const country = (value: string | null | undefined): string | undefined => {
  const code = value?.trim().toUpperCase();
  return code && /^[A-Z]{2}$/.test(code) && code !== 'ZZ' && code !== 'XX' ? code : undefined;
};

export function pickCountryHints(signals: CountrySignals): string[] {
  const network = country(signals.network);
  return [...new Set([country(signals.play), network ?? country(signals.sim)].filter((value): value is string => !!value))];
}
