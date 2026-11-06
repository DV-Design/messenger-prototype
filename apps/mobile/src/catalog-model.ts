import { t } from './i18n';
import type { DirectoryPage, DirectoryUser } from '@messenger/core';
export const catalogQuery = (query: string) => query.normalize('NFKC').trim().replace(/^@/, '').toLowerCase().slice(0, 48);
/** One letter would match most of the directory; search starts at two. */
export const CATALOG_MIN_QUERY = 2;
export const searchable = (query: string) => query.length >= CATALOG_MIN_QUERY;
type API = { listUsers(cursor?: string): Promise<DirectoryPage>; search(query: string): Promise<DirectoryUser[]> };
export type CatalogState = { query: string; users: DirectoryUser[]; busy: boolean; nextCursor?: string; error?: string; updatedAt?: number };
/** A controller belongs to one server/identity context; old generations cannot overwrite it. */
export class CatalogController {
  private generation = 0;
  private state: CatalogState = { query: '', users: [], busy: false };
  private readonly listeners = new Set<() => void>();
  constructor(private readonly api: API, private readonly ownId: string) {}
  readonly snapshot = () => this.state;
  readonly subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(update: Partial<CatalogState>) { this.state = { ...this.state, ...update }; this.listeners.forEach(listener => listener()); }
  cancel() { this.generation++; if (this.state.busy) this.publish({ busy: false }); }
  setQuery(query: string) {
    const normalized = catalogQuery(query);
    if (normalized === this.state.query) return;
    this.cancel(); this.publish({ query: normalized, users: [], nextCursor: undefined, updatedAt: undefined, error: undefined });
  }
  async load(append = false): Promise<void> {
    if (append && (this.state.busy || this.state.query || !this.state.nextCursor)) return;
    const { query, nextCursor } = this.state;
    if (query && !searchable(query)) { this.cancel(); this.publish({ users: [], nextCursor: undefined }); return; }
    const epoch = ++this.generation;
    this.publish({ busy: true, error: undefined });
    try {
      const page = query ? { users: await this.api.search(query) } : await this.api.listUsers(append ? nextCursor : undefined);
      if (epoch !== this.generation) return;
      const users = new Map((append ? this.state.users : []).map(user => [user.userId, user]));
      for (const user of page.users) if (user.userId !== this.ownId) users.set(user.userId, user);
      this.publish({ users: [...users.values()], nextCursor: 'nextCursor' in page ? page.nextCursor : undefined, updatedAt: Date.now() });
    } catch { if (epoch === this.generation) this.publish({ error: t('Could not refresh the directory. Check the server connection.') }); }
    finally { if (epoch === this.generation) this.publish({ busy: false }); }
  }
}
