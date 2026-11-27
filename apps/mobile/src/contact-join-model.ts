/**
 * "Your contact joined LastCall", checked by the phone itself (owner's choice, 2026-11-27): the
 * server never keeps phone books, so the phone compares who it finds now with who it found before.
 */
export const CONTACT_JOIN_INTERVAL_MS = 4 * 3_600_000;
export const MAX_JOIN_NOTICES = 5;
const MAX_KNOWN = 5000;
export interface JoinState { known: string[]; checkedAt: number }

export function dueForJoinCheck(state: JoinState | undefined, now: number, force = false): boolean {
  return force || !state || now - state.checkedAt >= CONTACT_JOIN_INTERVAL_MS || now < state.checkedAt;
}

/**
 * The first check only remembers who is already here (no flood of notices); later ones announce
 * people seen for the first time who are not yet LastCall contacts and are not this account.
 */
export function joinedSince<T extends { userId: string }>(state: JoinState | undefined, found: T[], contacts: ReadonlySet<string>, self: string, now: number): { fresh: T[]; state: JoinState } {
  const known = new Set(state?.known ?? []);
  const fresh = state ? found.filter(item => !known.has(item.userId) && !contacts.has(item.userId) && item.userId !== self) : [];
  for (const item of found) known.add(item.userId);
  return { fresh: fresh.slice(0, MAX_JOIN_NOTICES), state: { known: [...known].slice(-MAX_KNOWN), checkedAt: now } };
}
