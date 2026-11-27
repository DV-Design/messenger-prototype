import { randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { WebSocket } from 'ws';
import { DirectoryServices, ServiceError, type ServiceOptions } from './services.js';
import { EmailAuth, type EmailOutcome } from './email-auth.js';
import { RegistrationInvites, type RegistrationMode } from './registration-invites.js';
import { Mailbox } from './mailbox.js';
import { PhoneAuth, type PhoneOutcome } from './phone-auth.js';
import { AccessRequests } from './access-requests.js';
import { SystemAccount } from './system-account.js';
import type { RuStore, RuUserRecord } from './ru-store-client.js';
import { directoryClientFrameSchema, signedRequestFields, userIdFromPublicKey, verifyAuthentication, verifyEmailStart, verifyEmailVerify, verifyProfileResolve, verifyRequest, wakeIntentSchema, type DirectoryUser, type PhoneVisibility } from '@messenger/core';

/** Directory pages and search results; a person types more to narrow a search instead of scrolling hundreds. */
export const DIRECTORY_PAGE = 30;
export const DIRECTORY_SEARCH_LIMIT = 30;

type ProfileRow = { user_id: string; public_key: string; username: string; display_name: string; last_seen: number };
interface Connection {
  ws: WebSocket;
  ip: string;
  /** The connection's registration policy, given the countries the phone reports (if any). */
  registrationMode: (countryHints?: readonly string[]) => RegistrationMode;
  identityMovedV1?: boolean;
  challenge?: string;
  expiresAt: number;
  userId?: string;
  watches: Set<string>;
  callInviteV1?:boolean;
  mailboxV1?:boolean;
}
export interface DirectoryOptions extends ServiceOptions {
  registrationAdminUserIds?: string[];
  /** Keyed hash of confirmed phone numbers (>= 32 bytes). */
  phoneHashSecret?: string;
  /** Link to our Telegram bot for a session token; undefined while the bot is not running. */
  telegramLink?: (token: string) => string | undefined;
  /** 64 hex: the key of the system account @lastcall that writes to administrators. */
  systemAccountKey?: string;
  /** The Russian store; Russian numbers' data goes there first. */
  ruStore?: RuStore;
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
  private invites: RegistrationInvites;
  private mailbox: Mailbox;
  readonly phone: PhoneAuth;
  private access: AccessRequests;
  private system?: SystemAccount;
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
    this.invites = new RegistrationInvites(this.db, options.registrationAdminUserIds ?? [], options.serviceNow);
    this.mailbox = new Mailbox(this.db, {
      now: options.serviceNow ?? Date.now,
      reserve: (quotas) => this.services.reserveQuotas(quotas),
      push: (recipientId, expiresAt) => this.services.pushMailbox(recipientId, expiresAt),
      nudge: (userId) => { const target = this.online.get(userId); if (!target?.mailboxV1) return false; this.options.send(target.ws, { type: 'mailbox-available' }); return true; },
      isOnline: (userId) => this.online.has(userId),
    });
    this.phone = new PhoneAuth(this.db, { phoneHashSecret: options.phoneHashSecret, serviceNow: options.serviceNow, link: options.telegramLink }, (quotas) => this.services.reserveQuotas(quotas));
    this.access = new AccessRequests(this.db, (quotas) => this.services.reserveQuotas(quotas), options.serviceNow ?? Date.now);
    if (options.systemAccountKey) this.system = new SystemAccount(this.db, options.systemAccountKey, (sender, recipient, items) => this.mailbox.put(sender, recipient, items), options.serviceNow ?? Date.now);
  }
  /** What a 1.0.49 app may offer at sign-up (asked with /registration-policy?v=2). */
  features() { return { telegram: this.phone.enabled, accessRequests: Boolean(this.system?.ready && this.options.registrationAdminUserIds?.length) }; }
  /** The Russian store's copy of a user; the number itself only when it is Russian. */
  private ruRecord(userId: string, publicKey: string, username: string, displayName: string, outcome?: PhoneOutcome): RuUserRecord {
    const phoneRow = this.phone.record(userId);
    const email = this.db.prepare('SELECT email_hash FROM email_bindings WHERE user_id = ?').get(userId) as { email_hash: string } | undefined;
    return { userId, publicKey, username, displayName, lastSeen: Date.now(),
      ...(outcome?.country === 'RU' ? { phone: outcome.phone } : {}),
      ...(outcome ? { phoneHash: outcome.phoneHash } : phoneRow ? { phoneHash: phoneRow.phone_hash } : {}),
      ...(email ? { emailHash: email.email_hash } : {}) };
  }
  private isRussian(userId: string) { return this.phone.record(userId)?.country === 'RU'; }
  /** Primary write in Russia first: without the Russian store a Russian sign-up waits. */
  private async ruFirst(record: RuUserRecord) {
    if (!this.options.ruStore) return;
    try { await this.options.ruStore.putUser(record); }
    catch { throw new ServiceError('region-unavailable', 'Sign-up for Russian numbers is temporarily unavailable; try again later'); }
  }
  private ruForget(userId: string) { void this.options.ruStore?.deleteUser(userId).catch(() => console.error('ru-store delete failed; the next reconciliation retries')); }
  /** Moves a profile to a new device key, carrying its email and phone bindings. Callers provide the transaction. */
  private moveAccountInside(old: ProfileRow, userId: string, publicKey: string, phone?: { outcome: PhoneOutcome; visibility: PhoneVisibility }) {
    const oldEmail = this.db.prepare('SELECT email_hash FROM email_bindings WHERE user_id = ?').get(old.user_id) as { email_hash: string } | undefined;
    const oldPhone = this.phone.record(old.user_id);
    this.services.deleteAccountInside(old.user_id);
    this.mailbox.deleteAccountInside(old.user_id);
    this.invites.revokeIssuer(old.user_id);
    this.email.unbindInside(old.user_id);
    this.db.prepare('DELETE FROM directory_users WHERE user_id = ?').run(old.user_id);
    this.db.prepare('INSERT INTO directory_users (user_id, public_key, username, display_name, last_seen) VALUES (?, ?, ?, ?, ?)')
      .run(userId, publicKey, old.username, old.display_name, Date.now());
    this.email.recordMoveInside(old.user_id, userId, old.username, oldEmail?.email_hash);
    if (phone) this.phone.bindInside(userId, phone.outcome, phone.visibility);
    else if (oldPhone) this.phone.bindInside(userId, { purpose: 'recover', phone: '', phoneHash: oldPhone.phone_hash, country: oldPhone.country ?? undefined, hint: oldPhone.hint }, oldPhone.visibility);
  }
  /** After a move: the old session ends and contacts watching the old key learn the new one. */
  private announceMove(oldUserId: string, userId: string) {
    const live = this.online.get(oldUserId);
    if (live) { this.online.delete(oldUserId); this.options.reject(live.ws, 'account-moved', 'This account was restored on another device', true); }
    const user = this.user(this.row(userId)!);
    const retired = this.email.movedFrom(userId);
    for (const connection of this.connections.values()) {
      if (!connection.userId || !connection.identityMovedV1) continue;
      for (const id of retired) if (connection.watches.has(id)) this.options.send(connection.ws, { type: 'identity-moved', oldUserId: id, user });
    }
    return user;
  }
  private async finishPhone(publicKey: string, outcome: PhoneOutcome) {
    const { userId, hasProfile } = this.emailKeyState(publicKey);
    const owner = this.phone.ownerOf(outcome.phoneHash);
    if (outcome.purpose === 'register') {
      if (hasProfile) throw new ServiceError('device-already-registered', 'This installation already owns a username');
      if (owner) throw new ServiceError('phone-taken', 'This number already has an account; restore it instead');
      return { type: 'telegram-status', state: 'verified', proof: this.phone.createProof(publicKey, outcome), phone: outcome.hint };
    }
    if (outcome.purpose === 'bind') {
      const row = this.row(userId);
      if (!row) throw new ServiceError('profile-required', 'Register before linking a number');
      if (owner && owner !== userId) throw new ServiceError('phone-other-account', 'This number belongs to another account');
      if (outcome.country === 'RU') await this.ruFirst(this.ruRecord(userId, publicKey, row.username, row.display_name, outcome));
      const visibility = this.phone.record(userId)?.visibility ?? 'everyone';
      this.services.atomically(() => this.phone.bindInside(userId, outcome, visibility));
      return { type: 'telegram-status', state: 'verified', phone: outcome.hint };
    }
    if (hasProfile) throw new ServiceError('device-already-registered', 'This installation already owns a username');
    const old = owner ? this.row(owner) : undefined;
    if (!old) throw new ServiceError('phone-no-account', 'No account uses this number');
    const visibility = this.phone.record(old.user_id)?.visibility ?? 'everyone';
    if (outcome.country === 'RU') await this.ruFirst(this.ruRecord(userId, publicKey, old.username, old.display_name, outcome));
    this.services.atomically(() => this.moveAccountInside(old, userId, publicKey, { outcome, visibility }));
    if (outcome.country === 'RU') this.ruForget(old.user_id);
    return { type: 'telegram-status', state: 'verified', user: this.announceMove(old.user_id, userId), phone: outcome.hint };
  }
  private notifyAdmins(request: { name: string; contact?: string; message: string }) {
    if (!this.system) return;
    const text = `Заявка на доступ в LastCall\n\nИмя: ${request.name}${request.contact ? `\nКонтакт: ${request.contact}` : ''}\nСообщение: ${request.message}\n\nОдобрить или отклонить: Настройки → Приглашения → Заявки.`;
    for (const adminId of this.options.registrationAdminUserIds ?? []) {
      const row = this.row(adminId);
      if (row) this.system.send({ userId: row.user_id, publicKey: row.public_key }, text);
    }
  }
  open(ws: WebSocket, ip = '', policy: RegistrationMode | ((countryHints?: readonly string[]) => RegistrationMode) = 'open') {
    const registrationMode = typeof policy === 'function' ? policy : () => policy;
    const challenge = randomBytes(32).toString('hex');
    this.connections.set(ws, { ws, ip, registrationMode, challenge, expiresAt: Date.now() + (this.options.challengeTtlMs ?? 15_000), watches: new Set() });
    this.options.send(ws, { type: 'challenge', challenge });
  }
  isAuthenticated(ws: WebSocket) { return Boolean(this.connections.get(ws)?.userId); }
  expire(now: number) {
    try { this.services.expire(); this.email.expire(); this.invites.expire(); this.mailbox.expire(); this.phone.expire(); this.access.expire(); } catch { console.error('Directory quota cleanup failed'); }
    void this.mailbox.tick().catch(() => { /* Retried on the next tick. */ });
    void this.services.deliveryTick(this.isOnline).catch(() => { /* Retried on the next tick. */ });
    for (const connection of this.connections.values()) {
      if (!connection.userId && now >= connection.expiresAt) this.options.reject(connection.ws, 'auth-expired', 'Authentication challenge expired', true);
    }
  }
  private isOnline = (userId: string) => this.online.has(userId);
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
  private async oneShot(connection: Connection, operation: (challenge: string) => unknown) {
    const challenge = connection.challenge; connection.challenge = undefined;
    if (connection.userId || !challenge || Date.now() >= connection.expiresAt) return this.options.reject(connection.ws, 'auth-expired', 'Authentication challenge is unavailable or expired', true);
    try {
      const reply = await operation(challenge);
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
  private async finishEmail(publicKey: string, outcome: EmailOutcome) {
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
    const russian = this.isRussian(old.user_id);
    if (russian) await this.ruFirst({ ...this.ruRecord(old.user_id, publicKey, old.username, old.display_name), userId });
    this.services.atomically(() => this.moveAccountInside(old, userId, publicKey));
    if (russian) this.ruForget(old.user_id);
    const user = this.announceMove(old.user_id, userId);
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
          if (frame.purpose === 'register') this.invites.assertRegistration(connection.registrationMode(frame.countryHints), frame.inviteCode);
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
      if (frame.type === 'telegram-start' || frame.type === 'telegram-check' || frame.type === 'access-request' || frame.type === 'access-check') {
        return this.oneShot(connection, async (challenge: string) => {
          if (!verifyRequest(frame.publicKey, challenge, frame.type, signedRequestFields(frame), frame.signature)) throw new ServiceError('auth-failed', 'Signature verification failed');
          const { userId, hasProfile } = this.emailKeyState(frame.publicKey);
          if (frame.type === 'telegram-start') {
            if (frame.purpose === 'bind' && !hasProfile) throw new ServiceError('profile-required', 'Register before linking a number');
            if (frame.purpose !== 'bind' && hasProfile) throw new ServiceError('device-already-registered', 'This installation already owns a username');
            return { type: 'telegram-started', ...this.phone.start({ publicKey: frame.publicKey, purpose: frame.purpose, userId, ip: connection.ip }) };
          }
          if (frame.type === 'telegram-check') {
            const result = this.phone.check(frame.sessionId, frame.publicKey);
            return result.state === 'verified' ? await this.finishPhone(frame.publicKey, result.outcome) : { type: 'telegram-status', state: result.state };
          }
          if (frame.type === 'access-check') return { type: 'access-status', ...this.access.check(frame.publicKey) };
          if (hasProfile) throw new ServiceError('device-already-registered', 'This installation already owns a username');
          if (!this.features().accessRequests) throw new ServiceError('access-unavailable', 'Access requests are not available on this server');
          const request = this.access.create({ publicKey: frame.publicKey, ip: connection.ip, name: frame.name, contact: frame.contact, message: frame.message });
          this.notifyAdmins(request);
          return { type: 'access-requested', id: request.id };
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
        // A number confirmed through Telegram replaces both the invitation and the email (owner, 2026-11-27).
        const phoneOutcome = !existing && frame.phoneProof ? this.phone.proof(frame.phoneProof, frame.publicKey) : undefined;
        if (!existing && frame.phoneProof && !phoneOutcome) return this.options.reject(ws, 'phone-proof-invalid', 'The number confirmation expired; confirm it again', true);
        if (phoneOutcome && this.phone.ownerOf(phoneOutcome.phoneHash)) return this.options.reject(ws, 'phone-taken', 'This number already has an account; restore it instead', true);
        if (!existing && !phoneOutcome) this.invites.assertRegistration(connection.registrationMode(frame.countryHints), frame.inviteCode);
        const occupied = this.db.prepare('SELECT user_id FROM directory_users WHERE username = ? AND user_id <> ?').get(frame.username, userId);
        if (occupied) return this.options.reject(ws, 'username-taken', 'This username is already registered', true);
        const count = this.db.prepare('SELECT COUNT(*) AS total FROM directory_users').get() as { total: number };
        if (!existing && count.total >= this.options.maxUsers) return this.options.reject(ws, 'directory-full', 'User directory capacity reached', true);
        // Reconnecting profiles never need a proof. A proof is spent only once the profile exists.
        const emailHash = !existing && frame.emailProof ? this.email.proofHash(frame.emailProof, frame.publicKey) : undefined;
        if (!existing && !phoneOutcome && (frame.emailProof ? !emailHash : this.email.required)) return this.options.reject(ws, 'email-required', 'Confirm an email address to register', true);
        if (emailHash && this.email.ownerOf(emailHash)) return this.options.reject(ws, 'email-taken', 'This address belongs to another account', true);
        if (!existing && phoneOutcome?.country === 'RU') {
          try { await this.ruFirst({ ...this.ruRecord(userId, frame.publicKey, frame.username, frame.displayName, phoneOutcome), ...(emailHash ? { emailHash } : {}) }); }
          catch (error) { return this.options.reject(ws, error instanceof ServiceError ? error.code : 'region-unavailable', 'Sign-up for Russian numbers is temporarily unavailable; try again later', true); }
        }
        if (existing) this.db.prepare('UPDATE directory_users SET last_seen = ? WHERE user_id = ?').run(Date.now(), userId);
        else {
          try {
            this.services.atomically(() => {
              if (!phoneOutcome) this.invites.assertRegistration(connection.registrationMode(frame.countryHints), frame.inviteCode, true);
              this.db.prepare('INSERT INTO directory_users (user_id, public_key, username, display_name, last_seen) VALUES (?, ?, ?, ?, ?)')
                .run(userId, frame.publicKey, frame.username, frame.displayName, Date.now());
              if (emailHash) this.email.bindInside(userId, emailHash);
              if (phoneOutcome) this.phone.bindInside(userId, phoneOutcome);
            });
          } catch (error) { if (phoneOutcome?.country === 'RU') this.ruForget(userId); throw error; }
        }
        if (emailHash) this.email.consumeProof(frame.emailProof!);
        if (phoneOutcome) this.phone.consumeProof(frame.phoneProof!);
        const old = this.online.get(userId);
        connection.userId = userId;
        this.online.set(userId, connection); // New owner is visible before the old close callback runs.
        if (old && old !== connection) this.options.reject(old.ws, 'session-replaced', 'Another connection replaced this identity session', true);
        this.options.send(ws, { type: 'ready', self: this.user(this.row(userId)!) });
        this.notify(userId);
        void this.services.deliveryOnline(userId, this.isOnline).catch(() => { /* A nudge never affects the session. */ });
        return;
      }
      if (!connection.userId || this.online.get(connection.userId) !== connection) return this.options.reject(ws, 'not-authenticated', 'Authenticate before using the directory', true);
      if (frame.type === 'delete-account') {
        const userId = connection.userId;
        if (this.isRussian(userId)) this.ruForget(userId);
        this.services.deleteAccount(userId);
        this.online.delete(userId);
        this.notify(userId);
        this.services.atomically(() => {
          this.mailbox.deleteAccountInside(userId);
          this.invites.revokeIssuer(userId);
          this.email.deleteAccountInside(userId);
          this.db.prepare('DELETE FROM directory_users WHERE user_id = ?').run(userId);
        });
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
      if (frame.type === 'access-list' || frame.type === 'access-decide') {
        if (!this.invites.isAdmin(connection.userId)) throw new ServiceError('invite-not-allowed', 'Only an administrator may answer access requests');
        const adminId = connection.userId;
        if (frame.type === 'access-list') { this.options.send(ws, { type: 'access-requests', requestId: frame.requestId, requests: this.access.pending() }); return; }
        this.services.atomically(() => this.access.decideInside(adminId, frame.id, frame.approve, () => this.invites.createApproved(adminId)));
        this.options.send(ws, { type: 'access-decided', requestId: frame.requestId });
        return;
      }
      if (frame.type === 'phone-state-get') { this.options.send(ws, { type: 'phone-state', requestId: frame.requestId, ...this.phone.state(connection.userId) }); return; }
      if (frame.type === 'phone-visibility') {
        const userId = connection.userId;
        this.services.atomically(() => this.phone.setVisibility(userId, frame.visibility));
        this.options.send(ws, { type: 'phone-state', requestId: frame.requestId, ...this.phone.state(userId) });
        return;
      }
      if (frame.type === 'phone-find') {
        const matches = this.phone.find(connection.userId, frame.phones, (id) => { const row = this.row(id); return row ? this.user(row) : undefined; });
        this.options.send(ws, { type: 'phone-found', requestId: frame.requestId, matches });
        return;
      }
      if (frame.type === 'invite-status') {
        this.options.send(ws, { type: 'invite-status', requestId: frame.requestId, ...this.invites.status(connection.userId) });
      } else if (frame.type === 'invite-create') {
        const userId = connection.userId;
        const invitation = this.services.atomically(() => this.invites.create(userId));
        this.options.send(ws, { type: 'invite-created', requestId: frame.requestId, ...invitation });
      } else if (frame.type === 'invite-revoke') {
        const userId = connection.userId;
        this.services.atomically(() => this.invites.revoke(userId, frame.inviteId));
        this.options.send(ws, { type: 'invite-updated', requestId: frame.requestId });
      } else if (frame.type === 'invite-grant') {
        const userId = connection.userId;
        this.services.atomically(() => this.invites.setGrant(userId, frame.username, frame.enabled));
        this.options.send(ws, { type: 'invite-updated', requestId: frame.requestId });
      } else if (frame.type === 'list-users') {
        // Small pages keep a scroll through the directory cheap; older clients follow nextCursor the same way.
        const rows = this.db.prepare(`SELECT * FROM directory_users WHERE username > ? ORDER BY username LIMIT ${DIRECTORY_PAGE + 1}`).all(frame.cursor ?? '') as ProfileRow[];
        const page = rows.slice(0, DIRECTORY_PAGE);
        this.options.send(ws, { type: 'users-page', requestId: frame.requestId, users: page.map((row) => this.user(row)), ...(rows.length > DIRECTORY_PAGE ? { nextCursor: page.at(-1)!.username } : {}) });
      } else if (frame.type === 'services') {
        if(frame.callInviteV1===true)connection.callInviteV1=true;
        if(frame.mailboxV1===true){connection.mailboxV1=true;this.mailbox.enable(connection.userId);}
        this.options.send(ws, { type: 'services', requestId: frame.requestId, capabilities: this.services.capabilities(connection.userId,frame.callInviteV1===true,frame.deliveryV1===true,frame.mailboxV1===true,frame.endpointsV1===true) });
      } else if (frame.type === 'mailbox-put') {
        if (!this.row(frame.to)) throw new ServiceError('invalid-target', 'Unknown recipient');
        this.options.send(ws, { type: 'mailbox-stored', requestId: frame.requestId, ...this.mailbox.put(connection.userId, frame.to, frame.items) });
      } else if (frame.type === 'mailbox-fetch') {
        connection.mailboxV1 = true;
        const page = this.mailbox.fetch(connection.userId, frame.after, (id) => { const row = this.row(id); return row ? this.user(row) : undefined; });
        this.options.send(ws, { type: 'mailbox', requestId: frame.requestId, ...page });
      } else if (frame.type === 'mailbox-ack') {
        this.mailbox.ack(connection.userId, frame.items, frame.receipts);
        this.options.send(ws, { type: 'mailbox-acked', requestId: frame.requestId });
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
        this.services.registerPush(connection.userId, frame.token, frame.backgroundSync,frame.messagePreview,frame.callInviteV1,frame.deliveryV1);
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
      } else if (frame.type === 'delivery-sync') {
        await this.services.syncDelivery(connection.userId, frame.peers, this.isOnline);
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
        // Blocked and limited contacts stay watched (presence, moved keys) without the right to wake this phone.
        this.services.replaceWatchConsent(connection.userId, frame.consent ?? frame.userIds);
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
    this.phone.close();
    await this.services.close();
    this.db.close();
  }
}
