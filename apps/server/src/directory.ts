import { randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { WebSocket } from 'ws';
import { DirectoryServices, ServiceError, type ServiceOptions } from './services.js';
import { directoryClientFrameSchema, userIdFromPublicKey, verifyAuthentication, verifyProfileResolve, wakeIntentSchema, type DirectoryUser } from '@messenger/core';

type ProfileRow = { user_id: string; public_key: string; username: string; display_name: string; last_seen: number };
interface Connection {
  ws: WebSocket;
  challenge?: string;
  expiresAt: number;
  userId?: string;
  watches: Set<string>;
}
export interface DirectoryOptions extends ServiceOptions {
  iceServers: () => RTCIceServer[];
  dbPath: string;
  maxUsers: number;
  challengeTtlMs?: number;
  send: (ws: WebSocket, frame: unknown) => void;
  reject: (ws: WebSocket, code: string, message: string, close?: boolean, requestId?: string) => void;
}

/** Profiles and service metadata persist; live presence, OTPs and content do not. */
export class Directory {
  private db: DatabaseSync;
  private connections = new Map<WebSocket, Connection>();
  private online = new Map<string, Connection>();
  private closed = false;
  private services: DirectoryServices;
  constructor(private options: DirectoryOptions) {
    if (options.dbPath !== ':memory:') mkdirSync(dirname(options.dbPath), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(options.dbPath);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA busy_timeout = 1000;
      CREATE TABLE IF NOT EXISTS directory_users (
        user_id TEXT PRIMARY KEY,
        public_key TEXT NOT NULL UNIQUE,
        username TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL,
        last_seen INTEGER NOT NULL
      ) STRICT;
      CREATE TRIGGER IF NOT EXISTS directory_username_immutable
      BEFORE UPDATE OF username ON directory_users
      WHEN NEW.username <> OLD.username
      BEGIN SELECT RAISE(ABORT, 'Immutable username'); END;
    `);
    // SQLite's built-in lower()/LIKE fold only ASCII. Keep existing stored names
    // intact and fold both operands with the same Unicode rule instead.
    this.db.function('lastcall_fold', { deterministic: true }, (value) => String(value ?? '').normalize('NFKC').toLowerCase());
    this.services = new DirectoryServices(this.db, options, (id) => { const row = this.row(id); return row && this.user(row); }, options.iceServers);
  }
  open(ws: WebSocket) {
    const challenge = randomBytes(32).toString('hex');
    this.connections.set(ws, { ws, challenge, expiresAt: Date.now() + (this.options.challengeTtlMs ?? 15_000), watches: new Set() });
    this.options.send(ws, { type: 'challenge', challenge });
  }
  isAuthenticated(ws: WebSocket) { return Boolean(this.connections.get(ws)?.userId); }
  expire(now: number) {
    try { this.services.expire(); } catch { console.error('Directory quota cleanup failed'); }
    for (const connection of this.connections.values()) {
      if (!connection.userId && now >= connection.expiresAt) this.options.reject(connection.ws, 'auth-expired', 'Authentication challenge expired', true);
    }
  }
  private row(userId: string) {
    return this.db.prepare('SELECT * FROM directory_users WHERE user_id = ?').get(userId) as ProfileRow | undefined;
  }
  private user(row: ProfileRow): DirectoryUser {
    return { userId: row.user_id, publicKey: row.public_key, username: row.username, displayName: row.display_name, lastSeen: row.last_seen, online: this.online.has(row.user_id) };
  }
  private notify(userId: string) {
    const row = this.row(userId); if (!row) return;
    const user = this.user(row);
    for (const connection of this.connections.values()) if (connection.userId && connection.watches.has(userId)) this.options.send(connection.ws, { type: 'presence', user });
  }
  async handle(ws: WebSocket, raw: unknown) {
    const connection = this.connections.get(ws); if (!connection) return;
    const parsed = directoryClientFrameSchema.safeParse(raw);
    if (!parsed.success) return this.options.reject(ws, 'invalid-frame', 'Invalid directory control frame', true);
    const frame = parsed.data;
    try {
      if (frame.type === 'resolve-profile') {
        const challenge = connection.challenge; connection.challenge = undefined;
        if (connection.userId || !challenge || Date.now() >= connection.expiresAt) return this.options.reject(ws, 'auth-expired', 'Authentication challenge is unavailable or expired', true);
        if (!verifyProfileResolve(frame.publicKey, challenge, frame.signature)) return this.options.reject(ws, 'auth-failed', 'Signature verification failed', true);
        const row = this.row(userIdFromPublicKey(frame.publicKey));
        this.options.send(ws, { type: 'profile', user: row ? this.user(row) : null });
        // Resolution is purpose-separated and never takes ownership of presence.
        ws.close(1000, 'Profile resolved');
        return;
      }
      if (frame.type === 'authenticate') {
        // Consume before signature/database work; invalid attempts cannot reuse a challenge.
        const challenge = connection.challenge; connection.challenge = undefined;
        if (connection.userId || !challenge || Date.now() >= connection.expiresAt) return this.options.reject(ws, 'auth-expired', 'Authentication challenge is unavailable or expired', true);
        if (!verifyAuthentication(frame.publicKey, challenge, frame.username, frame.displayName, frame.signature)) return this.options.reject(ws, 'auth-failed', 'Signature verification failed', true);
        const userId = userIdFromPublicKey(frame.publicKey);
        const existing = this.row(userId);
        if (existing && existing.username !== frame.username) return this.options.reject(ws, 'device-already-registered', 'This installation already owns a username', true);
        const occupied = this.db.prepare('SELECT user_id FROM directory_users WHERE username = ? AND user_id <> ?').get(frame.username, userId);
        if (occupied) return this.options.reject(ws, 'username-taken', 'This username is already registered', true);
        const count = this.db.prepare('SELECT COUNT(*) AS total FROM directory_users').get() as { total: number };
        if (!existing && count.total >= this.options.maxUsers) return this.options.reject(ws, 'directory-full', 'User directory capacity reached', true);
        if (existing) this.db.prepare('UPDATE directory_users SET last_seen = ? WHERE user_id = ?').run(Date.now(), userId);
        else this.db.prepare('INSERT INTO directory_users (user_id, public_key, username, display_name, last_seen) VALUES (?, ?, ?, ?, ?)')
          .run(userId, frame.publicKey, frame.username, frame.displayName, Date.now());
        const old = this.online.get(userId);
        connection.userId = userId;
        this.online.set(userId, connection); // New owner is visible before the old close callback runs.
        if (old && old !== connection) this.options.reject(old.ws, 'session-replaced', 'Another connection replaced this identity session', true);
        this.options.send(ws, { type: 'ready', self: this.user(this.row(userId)!) });
        this.notify(userId);
        return;
      }
      if (!connection.userId || this.online.get(connection.userId) !== connection) return this.options.reject(ws, 'not-authenticated', 'Authenticate before using the directory', true);
      if (frame.type === 'list-users') {
        const rows = this.db.prepare('SELECT * FROM directory_users WHERE username > ? ORDER BY username LIMIT 101').all(frame.cursor ?? '') as ProfileRow[];
        const page = rows.slice(0, 100);
        this.options.send(ws, { type: 'users-page', requestId: frame.requestId, users: page.map((row) => this.user(row)), ...(rows.length > 100 ? { nextCursor: page.at(-1)!.username } : {}) });
      } else if (frame.type === 'services') {
        this.options.send(ws, { type: 'services', requestId: frame.requestId, capabilities: this.services.capabilities(connection.userId) });
      } else if (frame.type === 'ice') {
        this.options.send(ws, { type: 'ice', requestId: frame.requestId, iceServers: this.services.iceServers(connection.userId) });
      } else if (frame.type === 'phone-start') {
        const challenge = await this.services.startPhone(connection.userId, frame.phone);
        this.options.send(ws, { type: 'phone-challenge', requestId: frame.requestId, challenge });
      } else if (frame.type === 'phone-verify') {
        this.services.verifyPhone(connection.userId, frame.challengeId, frame.code);
        this.options.send(ws, { type: 'phone-verified', requestId: frame.requestId });
      } else if (frame.type === 'phone-discover') {
        const matches = this.services.discover(connection.userId, frame.hashes);
        this.options.send(ws, { type: 'phone-matches', requestId: frame.requestId, matches });
      } else if (frame.type === 'push-register') {
        this.services.registerPush(connection.userId, frame.token, frame.backgroundSync,frame.messagePreview);
        this.options.send(ws, { type: 'push-registered', requestId: frame.requestId });
      } else if (frame.type === 'wake') {
        await this.services.wake(connection.userId, frame.to, frame.kind === undefined ? undefined : wakeIntentSchema.parse({ kind: frame.kind, intentId: frame.intentId, expiresAt: frame.expiresAt }),frame.preview);
      } else if (frame.type === 'search') {
        // Escape SQL LIKE wildcards; the query is always a bound parameter.
        const escaped = frame.query.normalize('NFKC').toLowerCase().replace(/[\\%_]/g, (value) => `\\${value}`);
        const rows = this.db.prepare(`SELECT * FROM directory_users WHERE username LIKE ? ESCAPE '\\' OR lastcall_fold(display_name) LIKE ? ESCAPE '\\' ORDER BY username LIMIT 200`)
          .all(`${escaped}%`, `%${escaped}%`) as ProfileRow[];
        this.options.send(ws, { type: 'results', requestId: frame.requestId, users: rows.map((row) => this.user(row)) });
      } else if (frame.type === 'lookup') {
        const users = [...new Set(frame.userIds)].map((id) => this.row(id)).filter((row): row is ProfileRow => Boolean(row)).map((row) => this.user(row));
        this.options.send(ws, { type: 'results', requestId: frame.requestId, users });
      } else if (frame.type === 'watch') {
        this.services.replaceWatchConsent(connection.userId, frame.userIds);
        connection.watches = new Set(frame.userIds);
        // Initial snapshots and future changes go only to this explicit authenticated subscription.
        for (const id of connection.watches) {
          const row = this.row(id); if (row) this.options.send(ws, { type: 'presence', user: this.user(row) });
        }
      } else if (frame.type === 'connect') {
        if (frame.to === connection.userId) return this.options.reject(ws, 'invalid-target', 'Cannot connect to self');
        const target = this.online.get(frame.to);
        if (!target) return this.options.reject(ws, 'peer-offline', 'The requested user is offline');
        const sender = this.row(connection.userId)!;
        this.options.send(target.ws, { type: 'connect', from: this.user(sender) });
      }
    } catch (error) {
      // Service errors are generic and correlated; provider bodies/phones/tokens never leave here.
      const requestId = 'requestId' in frame ? frame.requestId : undefined;
      if (error instanceof ServiceError) this.options.reject(ws, error.code, error.message, false, requestId);
      else this.options.reject(ws, 'directory-error', 'Directory operation failed', true, requestId);
    }
  }
  disconnect(ws: WebSocket) {
    const connection = this.connections.get(ws); if (!connection) return;
    this.connections.delete(ws);
    const userId = connection.userId;
    if (!userId || this.online.get(userId) !== connection) return;
    this.online.delete(userId);
    try {
      this.db.prepare('UPDATE directory_users SET last_seen = ? WHERE user_id = ?').run(Date.now(), userId);
      this.notify(userId);
    } catch {
      // A full/locked volume must not throw from a WebSocket close handler and
      // take down every user's session. The ephemeral owner is already offline.
      console.error('Directory metadata update failed during disconnect');
    }
  }
  async close() {
    if (this.closed) return;
    this.closed = true;
    for (const ws of this.connections.keys()) this.disconnect(ws);
    await this.services.close();
    this.db.close();
  }
}
