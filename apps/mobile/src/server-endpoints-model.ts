const ENDPOINT = /^https:\/\/[a-z0-9.-]+(:\d{1,5})?$/i;

/** Only plain https://host[:port] addresses, at most four, no duplicates. */
export function validEndpoints(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((url): url is string => typeof url === 'string' && url.length <= 200 && ENDPOINT.test(url)).map(url => url.toLowerCase()))].slice(0, 4);
}

/** Saved addresses in their order, the account's own address last (always present). */
export function orderedCandidates(saved: string[], home: string): string[] {
  const own = home.replace(/\/+$/, '').toLowerCase();
  return [...validEndpoints(saved).filter(url => url !== own), own];
}

/**
 * Whether to try another server: the connection has been down for a while in the foreground,
 * with no call on. On a secondary address the account's own one is tried after 20 s; on the own
 * address the primary is probed again after a minute.
 */
export function shouldSwitch(input: { offlineMs: number; foreground: boolean; inCall: boolean; onHome: boolean; hasAlternatives: boolean }): boolean {
  if (!input.foreground || input.inCall || !input.hasAlternatives) return false;
  return input.offlineMs >= (input.onHome ? 60_000 : 20_000);
}
