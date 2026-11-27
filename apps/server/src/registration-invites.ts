import { createHash, randomBytes } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { ServiceError } from './services.js';

const DAY_MS = 86_400_000;
const INVITE_TTL_MS = 7 * DAY_MS;
const DAILY_LIMIT = 5;
const MAX_ACTIVE = 35;
const MAX_GRANTS = 100;
const regionNames = new Intl.DisplayNames('en', { type: 'region', fallback: 'none' });
export const DEFAULT_RESTRICTED_COUNTRIES = ['RU', 'CN', 'VN', 'KZ', 'TM', 'ID', 'TR', 'AE'];

export type RegistrationMode = 'open' | 'invite' | 'closed';
export interface RegistrationOptions {
  registrationMode?: RegistrationMode | 'market';
  registrationRestrictedCountries?: string[];
  registrationAdminUserIds?: string[];
  registrationCountryForIp?: (ip: string) => string | undefined;
}

export function registrationCountry(value?: string): string | undefined {
  const country = value?.trim().toUpperCase();
  return country && /^[A-Z]{2}$/.test(country) && country !== 'ZZ' && regionNames.of(country) ? country : undefined;
}

export function registrationPolicy(options: RegistrationOptions) {
  const mode = options.registrationMode ?? 'open';
  const restricted = new Set((options.registrationRestrictedCountries ?? DEFAULT_RESTRICTED_COUNTRIES).map(country => {
    const normalized = registrationCountry(country);
    if (!normalized) throw new Error('Invalid country in registration restricted countries');
    return normalized;
  }));
  const lookup = options.registrationCountryForIp;
  /**
   * Countries the phone reports (Google Play account, mobile network, SIM) count alongside the
   * connection's country, and only toward caution: any restricted country among them means an
   * invitation; open needs at least one known country and none restricted. A modified client can
   * leave hints out, but then it has nothing to open with unless its address is known and open.
   */
  return (ip: string, hints?: readonly string[]): RegistrationMode => {
    if (mode !== 'market') return mode;
    let address: string | undefined;
    try { address = registrationCountry(lookup?.(ip)); } catch { address = undefined; }
    const reported = (hints ?? []).slice(0, 4).map(hint => registrationCountry(hint));
    if (reported.some(country => country === undefined)) return 'invite'; // malformed: no benefit of the doubt
    const known = [address, ...reported].filter((country): country is string => country !== undefined);
    return known.length && !known.some(country => restricted.has(country)) ? 'open' : 'invite';
  };
}

function codeHash(code: string) {
  return createHash('sha256').update(code).digest('hex');
}

type ActiveInvite = { id: string; expiresAt: number };

/** Call mutating methods inside the same SQLite transaction as their directory operation. */
export class RegistrationInvites {
  private readonly admins: ReadonlySet<string>;

  constructor(private readonly db: DatabaseSync, adminIds: string[], private readonly clock = Date.now) {
    if (adminIds.some(id => !/^[a-f0-9]{64}$/.test(id))) throw new Error('Invalid registration administrator user ID');
    this.admins = new Set(adminIds);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS registration_invite_grants (
        user_id TEXT PRIMARY KEY REFERENCES directory_users(user_id)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS registration_invite_quota (
        user_id TEXT PRIMARY KEY,
        day INTEGER NOT NULL,
        count INTEGER NOT NULL CHECK(count BETWEEN 1 AND 5)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS registration_invites (
        id TEXT PRIMARY KEY,
        digest TEXT NOT NULL UNIQUE,
        issuer_id TEXT NOT NULL REFERENCES directory_users(user_id),
        expires_at INTEGER NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS registration_invites_by_issuer ON registration_invites(issuer_id, expires_at);
      CREATE INDEX IF NOT EXISTS registration_invites_by_expiry ON registration_invites(expires_at);
    `);
  }

  isAdmin(userId: string): boolean {
    return this.admins.has(userId);
  }

  private canInvite(userId: string): boolean {
    return this.isAdmin(userId) || Boolean(this.db.prepare('SELECT 1 FROM registration_invite_grants WHERE user_id = ?').get(userId));
  }

  private count(userId: string, day: number): number {
    const row = this.db.prepare('SELECT count FROM registration_invite_quota WHERE user_id = ? AND day = ?').get(userId, day) as { count: number } | undefined;
    return row?.count ?? 0;
  }

  status(userId: string) {
    const now = this.clock();
    const day = Math.floor(now / DAY_MS);
    const isAdmin = this.isAdmin(userId);
    const canInvite = this.canInvite(userId);
    const active = canInvite ? this.db.prepare(`
      SELECT id, expires_at AS expiresAt FROM registration_invites
      WHERE issuer_id = ? AND expires_at > ? ORDER BY expires_at, id LIMIT ?
    `).all(userId, now, MAX_ACTIVE) as ActiveInvite[] : [];
    const granted = isAdmin ? (this.db.prepare(`
      SELECT directory_users.username FROM registration_invite_grants
      JOIN directory_users ON directory_users.user_id = registration_invite_grants.user_id
      ORDER BY directory_users.username LIMIT ?
    `).all(MAX_GRANTS) as Array<{ username: string }>).map(row => row.username) : [];
    return { isAdmin, canInvite, remaining: canInvite ? DAILY_LIMIT - this.count(userId, day) : 0, resetAt: (day + 1) * DAY_MS, active, granted };
  }

  create(userId: string) {
    if (!this.canInvite(userId)) throw new ServiceError('invite-not-allowed', 'This account may not create invitations');
    const now = this.clock();
    const day = Math.floor(now / DAY_MS);
    const count = this.count(userId, day);
    if (count >= DAILY_LIMIT) throw new ServiceError('invite-limit', 'Daily invitation limit reached');
    const id = randomBytes(16).toString('hex');
    const code = randomBytes(32).toString('hex');
    // Midnight UTC seven dates after issuance bounds the active set to seven
    // daily quotas without reducing the next day's creation allowance.
    const expiresAt = day * DAY_MS + INVITE_TTL_MS;
    this.db.prepare(`
      INSERT INTO registration_invite_quota (user_id, day, count) VALUES (?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET day = excluded.day, count = excluded.count
    `).run(userId, day, count + 1);
    this.db.prepare('INSERT INTO registration_invites (id, digest, issuer_id, expires_at) VALUES (?, ?, ?, ?)').run(id, codeHash(code), userId, expiresAt);
    return { id, code, expiresAt };
  }

  /** An approved access request: an administrator's code outside the daily five. */
  createApproved(adminId: string) {
    if (!this.isAdmin(adminId)) throw new ServiceError('invite-not-allowed', 'Only an administrator may approve access requests');
    const now = this.clock();
    const id = randomBytes(16).toString('hex');
    const code = randomBytes(32).toString('hex');
    const expiresAt = Math.floor(now / DAY_MS) * DAY_MS + INVITE_TTL_MS;
    this.db.prepare('INSERT INTO registration_invites (id, digest, issuer_id, expires_at) VALUES (?, ?, ?, ?)').run(id, codeHash(code), adminId, expiresAt);
    return { id, code, expiresAt };
  }

  revoke(userId: string, id: string): void {
    if (!this.canInvite(userId)) throw new ServiceError('invite-not-allowed', 'This account may not revoke invitations');
    if (this.isAdmin(userId)) this.db.prepare('DELETE FROM registration_invites WHERE id = ?').run(id);
    else this.db.prepare('DELETE FROM registration_invites WHERE id = ? AND issuer_id = ?').run(id, userId);
  }

  setGrant(adminId: string, username: string, enabled: boolean): void {
    if (!this.isAdmin(adminId)) throw new ServiceError('invite-not-allowed', 'Only an administrator may manage invitation rights');
    const user = this.db.prepare('SELECT user_id FROM directory_users WHERE username = ?').get(username) as { user_id: string } | undefined;
    if (!user) throw new ServiceError('invite-user-not-found', 'Account not found');
    if (this.isAdmin(user.user_id)) throw new ServiceError('invite-not-allowed', 'Administrator rights are configured on the server');
    if (!enabled) return this.revokeIssuer(user.user_id);
    if (this.canInvite(user.user_id)) return;
    const grants = this.db.prepare('SELECT COUNT(*) AS count FROM registration_invite_grants').get() as { count: number };
    if (grants.count >= MAX_GRANTS) throw new ServiceError('invite-grants-limit', 'Invitation issuers limit reached');
    this.db.prepare('INSERT INTO registration_invite_grants (user_id) VALUES (?)').run(user.user_id);
  }

  /** Keep the current day's creation count after revocation, recovery, or deletion. */
  revokeIssuer(userId: string): void {
    this.db.prepare('DELETE FROM registration_invite_grants WHERE user_id = ?').run(userId);
    this.db.prepare('DELETE FROM registration_invites WHERE issuer_id = ?').run(userId);
  }

  assertRegistration(mode: RegistrationMode, code?: string, consume = false): void {
    if (mode === 'closed') throw new ServiceError('registration-closed', 'New registrations are closed');
    if (!code) {
      if (mode === 'invite') throw new ServiceError('invite-required', 'An invitation is required to register');
      return;
    }
    const digest = codeHash(code);
    const row = this.db.prepare('SELECT issuer_id FROM registration_invites WHERE digest = ? AND expires_at > ?').get(digest, this.clock()) as { issuer_id: string } | undefined;
    if (!row || !this.canInvite(row.issuer_id)) throw new ServiceError('invite-invalid', 'The invitation is invalid, expired, or already used');
    if (consume) this.db.prepare('DELETE FROM registration_invites WHERE digest = ?').run(digest);
  }

  expire(): void {
    const now = this.clock();
    this.db.prepare('DELETE FROM registration_invites WHERE expires_at <= ?').run(now);
    this.db.prepare('DELETE FROM registration_invite_quota WHERE day < ?').run(Math.floor(now / DAY_MS));
  }
}
