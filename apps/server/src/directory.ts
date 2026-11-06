import { randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { WebSocket } from 'ws';
import { DirectoryServices, ServiceError, type ServiceOptions } from './services.js';
import { EmailAuth, type EmailOutcome } from './email-auth.js';
import { directoryClientFrameSchema, userIdFromPublicKey, verifyAuthentication, verifyEmailStart, verifyEmailVerify, verifyProfileResolve, wakeIntentSchema, type DirectoryUser } from '@messenger/core';

/** Directory pages and search results; a person types more to narrow a search instead of scrolling hundreds. */
export const DIRECTORY_PAGE = 30;
export const DIRECTORY_SEARCH_LIMIT = 30;

type ProfileRow = { user_id: string; public_key: string; username: string; display_name: string; last_seen: number };
interface Connection {
  ws: WebSocket;
  ip: string;
  identityMovedV1?: boolean;
  challenge?: string;
  expiresAt: number;
  userId?: string;
  watches: Set<string>;
  callInviteV1?:boolean;
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
  private email: EmailAuth;
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
    this.services = new DirectoryServices(this.db, options, (id) => { const row = this.row(id); return row && this.user(row); }, options.iceServers,state=>{for(const id of [state.callerId,state.calleeId]){const target=this.online.get(id);if(target?.callInviteV1)this.options.send(target.ws,{type:'call-state',...state});}},(recipient,invite)=>{const target=this.online.get(recipient);if(target?.callInviteV1)this.options.send(target.ws,{type:'call-invitation',invite});});
    this.email = new EmailAuth(this.db, options, (quotas) => this.services.reserveQuotas(quotas));
  }
  open(ws: WebSocket, ip = '') {
    const challenge = randomBytes(32).toString('hex');
    this.connections.set(ws, { ws, ip, challenge, expiresAt: Date.now() + (this.options.challengeTtlMs ?? 15_000), watches: new Set() });
    this.options.send(ws, { type: 'challenge', challenge });
  }
  isAuthenticated(ws: WebSocket) { return Boolean(this.connections.get(ws)?.userId); }
  expire(now: number) {
    try { this.services.expire(); this.email.expire(); } catch { console.error('Directory quota cleanup failed'); }
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
  /** Registration, binding and recovery prove the key per request and never publish presence. */
  private oneShot(connection: Connection, operation: (challenge: string) => unknown) {
    const challenge = connection.challenge; connection.challenge = undefined;
    if (connection.userId || !challenge || Date.now() >= connection.expiresAt) return this.options.reject(connection.ws, 'auth-expired', 'Authentication challenge is unavailable or expired', true);
    try {
      const reply = operation(challenge);
      this.options.send(connection.ws, reply);
      connection.ws.close(1000, 'Email request finished');
    } catch (error) {
      if (error instanceof ServiceError) this.options.reject(connection.ws, error.code, error.message, true);
      else this.options.reject(connection.ws, 'directory-error', 'Directory operation failed', true);
    }
  }
  private emailKeyState(publicKey: string) {
    const userId = userIdFromPublicKey(publicKey);
    if (this.email.movedTo(userId)) throw new ServiceError('account-moved', 'This account was restored on another device');
    return { userId, hasProfile: Boolean(this.row(userId)) };
  }
  private finishEmail(publicKey: string, outcome: EmailOutcome) {
    const { userId, hasProfile } = this.emailKeyState(publicKey);
    if (outcome.purpose === 'register') {
      if (hasProfile) throw new ServiceError('device-already-registered', 'This installation already owns a username');
      return { type: 'email-verified', proof: this.email.createProof(publicKey, outcome.emailHash) };
    }
    if (outcome.purpose === 'bind') {
      if (!hasProfile) throw new ServiceError('profile-required', 'Register before binding an address');
      const owner = this.email.ownerOf(outcome.emailHash);
      if (owner && owner !== userId) throw new ServiceError('email-taken', 'This address belongs to another account');
      this.services.atomically(() => this.email.bindInside(userId, outcome.emailHash));
      return { type: 'email-verified' };
    }
    if (hasProfile) throw new ServiceError('device-already-registered', 'This installation already owns a username');
    const oldUserId = this.email.ownerOf(outcome.emailHash);
    const old = oldUserId ? this.row(oldUserId) : undefined;
    if (!old) throw new ServiceError('email-code-invalid', 'The code is invalid or expired');
    this.services.atomically(() => {
      this.services.deleteAccountInside(old.user_id);
      this.email.unbindInside(old.user_id);
      this.db.prepare('DELETE FROM directory_users WHERE user_id = ?').run(old.user_id);
      this.db.prepare('INSERT INTO directory_users (user_id, public_key, username, display_name, last_seen) VALUES (?, ?, ?, ?, ?)')
        .run(userId, publicKey, old.username, old.display_name, Date.now());
      this.email.recordMoveInside(old.user_id, userId, old.username, outcome.emailHash);
    });
    const live = this.online.get(old.user_id);
    if (live) { this.online.delete(old.user_id); this.options.reject(live.ws, 'account-moved', 'This account was restored on another device', true); }
    const user = this.user(this.row(userId)!);
    const retired = this.email.movedFrom(userId);
    for (const connection of this.connections.values()) {
      if (!connection.userId || !connection.identityMovedV1) continue;
      for (const id of retired) if (connection.watches.has(id)) this.options.send(connection.ws, { type: 'identity-moved', oldUserId: id, user });
    }
    if (outcome.email) this.email.sendRecoveredNotice(outcome.email, outcome.locale);
    return { type: 'email-verified', user };
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
      if (frame.type === 'email-start') {
        return this.oneShot(connection, (challenge: string) => {
          if (!verifyEmailStart(frame.publicKey, challenge, frame.purpose, frame.email, frame.locale, frame.signature)) throw new ServiceError('auth-failed', 'Signature verification failed');
          if (!this.email.enabled) throw new ServiceError('email-unavailable', 'Email is not configured on this server');
          const { userId, hasProfile } = this.emailKeyState(frame.publicKey);
          // These depend only on the signing key, so they reveal nothing about the address.
          if (frame.purpose === 'bind' && !hasProfile) throw new ServiceError('profile-required', 'Register before binding an address');
          if (frame.purpose !== 'bind' && hasProfile) throw new ServiceError('device-already-registered', 'This installation already owns a username');
          return { type: 'email-started', challengeId: this.email.start({ purpose: frame.purpose, email: frame.email, locale: frame.locale, publicKey: frame.publicKey, userId, ip: connection.ip }) };
        });
      }
      if (frame.type === 'email-verify') {
        return this.oneShot(connection, (challenge: string) => {
          if (!verifyEmailVerify(frame.publicKey, challenge, frame.challengeId, frame.code, frame.signature)) throw new ServiceError('auth-failed', 'Signature verification failed');
          return this.finishEmail(frame.publicKey, this.email.verify({ challengeId: frame.challengeId, code: frame.code, publicKey: frame.publicKey }));
        });
      }
      if (frame.type === 'authenticate') {
        // Consume before signature/database work; invalid attempts cannot reuse a challenge.
        const challenge = connection.challenge; connection.challenge = undefined;
        if (connection.userId || !challenge || Date.now() >= connection.expiresAt) return this.options.reject(ws, 'auth-expired', 'Authentication challenge is unavailable or expired', true);
        if (!verifyAuthentication(frame.publicKey, challenge, frame.username, frame.displayName, frame.signature)) return this.options.reject(ws, 'auth-failed', 'Signature verification failed', true);
        const userId = userIdFromPublicKey(frame.publicKey);
        if (this.email.movedTo(userId)) return this.options.reject(ws, 'account-moved', 'This account was restored on another device', true);
        const existing = this.row(userId);
        if (existing && existing.username !== frame.username) return this.options.reject(ws, 'device-already-registered', 'This installation already owns a username', true);
        const occupied = this.db.prepare('SELECT user_id FROM directory_users WHERE username = ? AND user_id <> ?').get(frame.username, userId);
        if (occupied) return this.options.reject(ws, 'username-taken', 'This username is already registered', true);
        const count = this.db.prepare('SELECT COUNT(*) AS total FROM directory_users').get() as { total: number };
        if (!existing && count.total >= this.options.maxUsers) return this.options.reject(ws, 'directory-full', 'User directory capacity reached', true);
        // Reconnecting profiles never need a proof. A proof is spent only once the profile exists.
        const emailHash = !existing && frame.emailProof ? this.email.proofHash(frame.emailProof, frame.publicKey) : undefined;
        if (!existing && (frame.emailProof ? !emailHash : this.email.required)) return this.options.reject(ws, 'email-required', 'Confirm an email address to register', true);
        if (emailHash && this.email.ownerOf(emailHash)) return this.options.reject(ws, 'email-taken', 'This address belongs to another account', true);
        if (existing) this.db.prepare('UPDATE directory_users SET last_seen = ? WHERE user_id = ?').run(Date.now(), userId);
        else this.services.atomically(() => {
          this.db.prepare('INSERT INTO directory_users (user_id, public_key, username, display_name, last_seen) VALUES (?, ?, ?, ?, ?)')
            .run(userId, frame.publicKey, frame.username, frame.displayName, Date.now());
          if (emailHash) this.email.bindInside(userId, emailHash);
        });
        if (emailHash) this.email.consumeProof(frame.emailProof!);
        const old = this.online.get(userId);
        connection.userId = userId;
        this.online.set(userId, connection); // New owner is visible before the old close callback runs.
        if (old && old !== connection) this.options.reject(old.ws, 'session-replaced', 'Another connection replaced this identity session', true);
        this.options.send(ws, { type: 'ready', self: this.user(this.row(userId)!) });
        this.notify(userId);
        return;
      }
      if (!connection.userId || this.online.get(connection.userId) !== connection) return this.options.reject(ws, 'not-authenticated', 'Authenticate before using the directory', true);
      if (frame.type === 'delete-account') {
        const userId = connection.userId;
        this.services.deleteAccount(userId);
        this.online.delete(userId);
        this.notify(userId);
        this.services.atomically(() => { this.email.deleteAccountInside(userId); this.db.prepare('DELETE FROM directory_users WHERE user_id = ?').run(userId); });
        this.connections.delete(ws);
        this.options.send(ws, { type: 'account-deleted', requestId: frame.requestId });
        ws.close(1000, 'Account deleted');
        return;
      }
      if (frame.type === 'report') {
        this.services.fileReport(connection.userId, frame.targetId, frame.targetKind, frame.conversationId, frame.reason, frame.details);
        this.options.send(ws, { type: 'report-received', requestId: frame.requestId });
        return;
      }
      if (frame.type === 'list-users') {
        // Small pages keep a scroll through the directory cheap; older clients follow nextCursor the same way.
        const rows = this.db.prepare(`SELECT * FROM directory_users WHERE username > ? ORDER BY username LIMIT ${DIRECTORY_PAGE + 1}`).all(frame.cursor ?? '') as ProfileRow[];
        const page = rows.slice(0, DIRECTORY_PAGE);
        this.options.send(ws, { type: 'users-page', requestId: frame.requestId, users: page.map((row) => this.user(row)), ...(rows.length > DIRECTORY_PAGE ? { nextCursor: page.at(-1)!.username } : {}) });
      } else if (frame.type === 'services') {
        if(frame.callInviteV1===true)connection.callInviteV1=true;
        this.options.send(ws, { type: 'services', requestId: frame.requestId, capabilities: this.services.capabilities(connection.userId,frame.callInviteV1===true) });
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
        this.services.registerPush(connection.userId, frame.token, frame.backgroundSync,frame.messagePreview,frame.callInviteV1);
        if(frame.callInviteV1===true&&frame.backgroundSync===true)connection.callInviteV1=true;
        this.options.send(ws, { type: 'push-registered', requestId: frame.requestId });
      } else if (frame.type === 'call-offer') {
        connection.callInviteV1=true;const value=await this.services.callOffer(connection.userId,frame.to,frame,frame.invite);this.options.send(ws,{type:'call-state',requestId:frame.requestId,...value});
      } else if (frame.type === 'call-received') {
        connection.callInviteV1=true;const value=this.services.callReceived(connection.userId,frame.callerId,frame.callId,frame.serverEpoch);this.options.send(ws,{type:'call-state',requestId:frame.requestId,...value});
      } else if (frame.type === 'call-state-get') {
        connection.callInviteV1=true;const value=this.services.callState(connection.userId,frame.otherId,frame.callId,frame.serverEpoch);this.options.send(ws,{type:'call-state',requestId:frame.requestId,...value});
      } else if (frame.type === 'call-action') {
        connection.callInviteV1=true;const value=await this.services.callAction(connection.userId,frame.otherId,frame.action,frame);this.options.send(ws,{type:'call-state',requestId:frame.requestId,...value});
      } else if (frame.type === 'wake') {
        await this.services.wake(connection.userId, frame.to, frame.kind === undefined ? undefined : wakeIntentSchema.parse({ kind: frame.kind, intentId: frame.intentId, expiresAt: frame.expiresAt }),frame.preview);
      } else if (frame.type === 'search') {
        // Escape SQL LIKE wildcards; the query is always a bound parameter.
        const escaped = frame.query.normalize('NFKC').toLowerCase().replace(/[\\%_]/g, (value) => `\\${value}`);
        const rows = this.db.prepare(`SELECT * FROM directory_users WHERE username LIKE ? ESCAPE '\\' OR lastcall_fold(display_name) LIKE ? ESCAPE '\\' ORDER BY username LIMIT ${DIRECTORY_SEARCH_LIMIT}`)
          .all(`${escaped}%`, `%${escaped}%`) as ProfileRow[];
        this.options.send(ws, { type: 'results', requestId: frame.requestId, users: rows.map((row) => this.user(row)) });
      } else if (frame.type === 'lookup') {
        const users = [...new Set(frame.userIds)].map((id) => this.row(id)).filter((row): row is ProfileRow => Boolean(row)).map((row) => this.user(row));
        this.options.send(ws, { type: 'results', requestId: frame.requestId, users });
      } else if (frame.type === 'watch') {
        this.services.replaceWatchConsent(connection.userId, frame.userIds);
        connection.watches = new Set(frame.userIds);
        if (frame.identityMovedV1) connection.identityMovedV1 = true;
        // Initial snapshots and future changes go only to this explicit authenticated subscription.
        for (const id of connection.watches) {
          const row = this.row(id); if (row) { this.options.send(ws, { type: 'presence', user: this.user(row) }); continue; }
          // Released clients treat an unknown frame as fatal, so this needs the explicit opt-in.
          const newId = connection.identityMovedV1 ? this.email.movedTo(id) : undefined;
          const moved = newId ? this.row(newId) : undefined;
          if (moved) this.options.send(ws, { type: 'identity-moved', oldUserId: id, user: this.user(moved) });
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
    await this.email.close();
    await this.services.close();
    this.db.close();
  }
}
