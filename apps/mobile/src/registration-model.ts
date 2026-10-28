export type Profile = { username: string; displayName: string; serverUrl: string };
export const profileSignature = (profile: Profile) => JSON.stringify([profile.serverUrl, profile.username, profile.displayName]);
/** A rejected resolver is never equivalent to an unregistered device. */
export async function registrationCandidate(proposed: Profile, resolve: () => Promise<{ username: string; displayName: string } | null>): Promise<Profile> {
  const bound = await resolve();
  return bound ? { ...proposed, username: bound.username, displayName: bound.displayName } : proposed;
}
/** Serial, deduplicated canonical writes. A failed save never undoes server binding. */
export class CanonicalProfileStore {
  private saved?: string;
  private pending?: { signature: string; promise: Promise<void> };
  private queue = Promise.resolve();
  constructor(private readonly save: (profile: Profile) => Promise<void>, cached?: Profile) { this.saved = cached && profileSignature(cached); }
  remember(profile: Profile): Promise<void> {
    const signature = profileSignature(profile);
    if (this.pending?.signature === signature) return this.pending.promise;
    if (!this.pending && this.saved === signature) return Promise.resolve();
    const promise = this.queue.catch(() => {}).then(async () => { if (this.saved !== signature) { await this.save(profile); this.saved = signature; } });
    this.queue = promise;
    this.pending = { signature, promise };
    void promise.finally(() => { if (this.pending?.promise === promise) this.pending = undefined; }).catch(() => {});
    return promise;
  }
}
