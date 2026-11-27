import { randomBytes } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { userIdFromPublicKey, type AccessRequest } from '@messenger/core';
import { ServiceError } from './services.js';

const DAY_MS = 86_400_000;
const KEEP_MS = 30 * DAY_MS;
export interface AccessQuota { scope: string; key: string; limit: number }
interface Row { id: string; public_key: string; name: string; contact: string | null; message: string; created_at: number; status: 'pending' | 'approved' | 'declined'; invite_code: string | null; invite_expires_at: number | null }

/**
 * People who cannot use Telegram ask an administrator. A request is bound to the device key that
 * made it; an approved request carries an invitation code that only that key can fetch, until the
 * code expires. Requests are forgotten 30 days after they were made.
 */
export class AccessRequests {
  constructor(private db: DatabaseSync, private reserve: (quotas: AccessQuota[]) => void, private now: () => number = Date.now) {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS access_requests (
        id TEXT PRIMARY KEY,
        public_key TEXT NOT NULL,
        name TEXT NOT NULL,
        contact TEXT,
        message TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','declined')),
        invite_code TEXT,
        invite_expires_at INTEGER,
        decided_by TEXT,
        decided_at INTEGER
      ) STRICT;
      CREATE INDEX IF NOT EXISTS access_requests_key ON access_requests(public_key, created_at);
      CREATE INDEX IF NOT EXISTS access_requests_status ON access_requests(status, created_at);
    `);
  }
  create(input: { publicKey: string; ip: string; name: string; contact?: string; message: string }): AccessRequest {
    const userId = userIdFromPublicKey(input.publicKey);
    if (this.db.prepare("SELECT 1 FROM access_requests WHERE public_key = ? AND status = 'pending'").get(input.publicKey)) throw new ServiceError('access-pending', 'A request from this device is already waiting');
    try {
      this.reserve([{ scope: 'access-key', key: userId, limit: 3 }, { scope: 'access-ip', key: input.ip, limit: 20 }, { scope: 'access-global', key: 'all', limit: 200 }]);
    } catch (error) {
      if (error instanceof ServiceError) throw new ServiceError('access-rate-limited', 'Too many requests; retry later');
      throw error;
    }
    const request: AccessRequest = { id: randomBytes(16).toString('hex'), name: input.name, ...(input.contact ? { contact: input.contact } : {}), message: input.message, createdAt: this.now() };
    this.db.prepare('INSERT INTO access_requests(id,public_key,name,contact,message,created_at) VALUES (?,?,?,?,?,?)').run(request.id, input.publicKey, request.name, request.contact ?? null, request.message, request.createdAt);
    return request;
  }
  /** The newest request of this device; an approved one carries its code until it expires. */
  check(publicKey: string): { state: 'none' | 'pending' | 'approved' | 'declined'; inviteCode?: string } {
    const row = this.db.prepare('SELECT * FROM access_requests WHERE public_key = ? ORDER BY created_at DESC LIMIT 1').get(publicKey) as Row | undefined;
    if (!row) return { state: 'none' };
    if (row.status === 'approved') return row.invite_code && (row.invite_expires_at ?? 0) > this.now() ? { state: 'approved', inviteCode: row.invite_code } : { state: 'none' };
    return { state: row.status };
  }
  pending(): AccessRequest[] {
    return (this.db.prepare("SELECT * FROM access_requests WHERE status = 'pending' ORDER BY created_at LIMIT 100").all() as unknown as Row[])
      .map(row => ({ id: row.id, name: row.name, ...(row.contact ? { contact: row.contact } : {}), message: row.message, createdAt: row.created_at }));
  }
  /** Callers provide the transaction; `invite` makes the code when approving. */
  decideInside(adminId: string, id: string, approve: boolean, invite: () => { code: string; expiresAt: number }) {
    const row = this.db.prepare("SELECT status FROM access_requests WHERE id = ?").get(id) as { status: string } | undefined;
    if (!row) throw new ServiceError('access-not-found', 'Request not found');
    if (row.status !== 'pending') throw new ServiceError('access-decided', 'This request was already answered');
    const code = approve ? invite() : undefined;
    this.db.prepare('UPDATE access_requests SET status = ?, invite_code = ?, invite_expires_at = ?, decided_by = ?, decided_at = ? WHERE id = ?')
      .run(approve ? 'approved' : 'declined', code?.code ?? null, code?.expiresAt ?? null, adminId, this.now(), id);
  }
  expire() {
    const now = this.now();
    this.db.prepare('DELETE FROM access_requests WHERE created_at < ?').run(now - KEEP_MS);
    this.db.prepare("UPDATE access_requests SET invite_code = NULL WHERE invite_code IS NOT NULL AND invite_expires_at <= ?").run(now);
  }
}
