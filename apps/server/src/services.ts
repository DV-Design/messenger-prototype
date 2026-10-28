import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { normalizePhone, phoneLookupHash, type DirectoryUser, type PhoneChallenge, type PhoneMatch, type ServiceCapabilities, type WakeIntent } from '@messenger/core';
import { InvalidPushToken, type PushProvider, type SMSProvider } from './providers.js';

export class ServiceError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}
export interface ServiceOptions {
  /** Private legacy regression injection only. No environment switch enables phone features. */
  enableLegacyPhoneServices?: boolean;
  smsProvider?: SMSProvider;
  pushProvider?: PushProvider;
  phoneVerificationSecret?: string;
  smsMaxPerHour?: number;
  smsIdentityMaxPerHour?: number;
  smsPhoneMaxPerHour?: number;
  // Private dependency injection for isolated tests; no public mock/OTP endpoint or env switch.
  serviceNow?: () => number;
  otpTtlMs?: number;
  otpResendMs?: number;
  providerTimeoutMs?: number;
}
interface Challenge { userId: string; phoneHash: string; digest: Buffer; expiresAt: number; attempts: number; accepted: boolean }
interface Quota { scope: string; key: string; limit: number; amount?: number }
const unavailable = () => new ServiceError('service-unavailable', 'This service is not configured');
const rateLimited = () => new ServiceError('service-rate-limit', 'Service request limit exceeded; retry later');

/** OTPs stay in bounded memory. SQLite holds only hashes, tokens, consent and anti-abuse metadata. */
export class DirectoryServices {
  private challenges = new Map<string, Challenge>();
  private starting = new Set<string>();
  private activeSms = 0;
  private activePush = 0;
  private operations = new Set<Promise<unknown>>();
  private wakeIntents = new Map<string, number>();
  private closed = false;
  private secret?: Buffer;
  private now: () => number;
  constructor(private db: DatabaseSync, private options: ServiceOptions, private lookup: (id: string) => DirectoryUser | undefined, private ice: () => RTCIceServer[]) {
    this.now = options.serviceNow ?? Date.now;
    if (options.enableLegacyPhoneServices && options.phoneVerificationSecret && Buffer.byteLength(options.phoneVerificationSecret) >= 32) this.secret = Buffer.from(options.phoneVerificationSecret);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS verified_phones (user_id TEXT PRIMARY KEY REFERENCES directory_users(user_id), phone_hash TEXT NOT NULL UNIQUE, verified_at INTEGER NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS push_tokens (user_id TEXT PRIMARY KEY REFERENCES directory_users(user_id), token TEXT NOT NULL UNIQUE, updated_at INTEGER NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS push_consent (recipient_id TEXT NOT NULL REFERENCES directory_users(user_id), sender_id TEXT NOT NULL, PRIMARY KEY (recipient_id, sender_id)) STRICT;
      CREATE TABLE IF NOT EXISTS service_quotas (scope TEXT NOT NULL, quota_key TEXT NOT NULL, period INTEGER NOT NULL, count INTEGER NOT NULL, PRIMARY KEY (scope, quota_key, period)) STRICT;
      CREATE TABLE IF NOT EXISTS sms_last_attempt (scope TEXT NOT NULL, quota_key TEXT NOT NULL, attempted_at INTEGER NOT NULL, PRIMARY KEY(scope, quota_key)) STRICT;
      CREATE TABLE IF NOT EXISTS wake_last_attempt (recipient_id TEXT PRIMARY KEY, attempted_at INTEGER NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS wake_call_last_attempt (recipient_id TEXT PRIMARY KEY, attempted_at INTEGER NOT NULL) STRICT;
    `);
  }
  capabilities(userId: string): ServiceCapabilities {
    return { phoneVerification: Boolean(this.options.smsProvider && this.secret), push: Boolean(this.options.pushProvider), relay: this.ice().some(server => (Array.isArray(server.urls) ? server.urls : [server.urls]).some(url => /^turns?:/.test(url))), phoneVerified: Boolean(this.options.enableLegacyPhoneServices && this.verified(userId)) };
  }
  private verified(userId: string) { return Boolean(this.db.prepare('SELECT 1 FROM verified_phones WHERE user_id = ?').get(userId)); }
  private checkOpen() { if (this.closed) throw unavailable(); }
  private transaction<T>(operation: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try { const value = operation(); this.db.exec('COMMIT'); return value; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  private reserveInside(quotas: Quota[]) {
    const period = Math.floor(this.now() / 3_600_000);
    for (const quota of quotas) {
      const row = this.db.prepare('SELECT count FROM service_quotas WHERE scope = ? AND quota_key = ? AND period = ?').get(quota.scope, quota.key, period) as { count: number } | undefined;
      if ((row?.count ?? 0) + (quota.amount ?? 1) > quota.limit) throw rateLimited();
    }
    for (const quota of quotas) this.db.prepare('INSERT INTO service_quotas(scope, quota_key, period, count) VALUES (?, ?, ?, ?) ON CONFLICT(scope, quota_key, period) DO UPDATE SET count = count + excluded.count').run(quota.scope, quota.key, period, quota.amount ?? 1);
  }
  private reserve(quotas: Quota[]) { this.transaction(() => this.reserveInside(quotas)); }
  expire() {
    const now = this.now();
    for (const [id, value] of this.challenges) if (now >= value.expiresAt) { value.digest.fill(0); this.challenges.delete(id); }
    for (const [id, expiresAt] of this.wakeIntents) if (now >= expiresAt) this.wakeIntents.delete(id);
    this.db.prepare('DELETE FROM service_quotas WHERE period < ?').run(Math.floor(now / 3_600_000) - 1);
    this.db.prepare('DELETE FROM sms_last_attempt WHERE attempted_at < ?').run(now - 3_600_000);
    this.db.prepare('DELETE FROM wake_last_attempt WHERE attempted_at < ?').run(now - 3_600_000);
    this.db.prepare('DELETE FROM wake_call_last_attempt WHERE attempted_at < ?').run(now - 3_600_000);
  }
  private digest(userId: string, challengeId: string, phoneHash: string, code: string) {
    return createHmac('sha256', this.secret!).update(JSON.stringify(['lastcall/otp/v1', userId, challengeId, phoneHash, code])).digest();
  }
  private removeChallenge(id: string) { this.challenges.get(id)?.digest.fill(0); this.challenges.delete(id); }
  private async provider<T>(kind: 'sms' | 'push', operation: () => Promise<T>): Promise<T> {
    this.checkOpen();
    if ((kind === 'sms' ? this.activeSms : this.activePush) >= (kind === 'sms' ? 4 : 8)) throw new ServiceError('service-busy', 'Service is busy; retry later');
    if (kind === 'sms') this.activeSms++; else this.activePush++;
    const task = Promise.resolve().then(operation);
    // A timed-out SDK request retains its slot until it actually settles, bounding abandoned work.
    const release = () => { if (kind === 'sms') this.activeSms--; else this.activePush--; };
    void task.then(release, release);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new ServiceError('provider-failed', 'Provider did not accept the request')), this.options.providerTimeoutMs ?? 10_000); });
    const raced = Promise.race([task, timeout]); this.operations.add(raced);
    const finish = () => { clearTimeout(timer); this.operations.delete(raced); };
    void raced.then(finish, finish);
    return raced;
  }
  async startPhone(userId: string, input: string): Promise<PhoneChallenge> {
    this.checkOpen(); if (!this.options.smsProvider || !this.secret) throw unavailable();
    if (this.starting.has(userId) || this.activeSms >= 4) throw new ServiceError('service-busy', 'Verification is already being processed');
    let phone: string;
    try { phone = normalizePhone(input); } catch { throw new ServiceError('phone-invalid', 'Invalid phone number'); }
    const hash = phoneLookupHash(phone); this.expire();
    if (this.challenges.size >= 1024) throw new ServiceError('service-busy', 'Verification capacity reached');
    const now = this.now(), retryAt = now + (this.options.otpResendMs ?? 60_000);
    this.transaction(() => {
      for (const [scope, key] of [['identity', userId], ['phone', hash]]) {
        const row = this.db.prepare('SELECT attempted_at FROM sms_last_attempt WHERE scope = ? AND quota_key = ?').get(scope!, key!) as { attempted_at: number } | undefined;
        if (row && now < row.attempted_at + (this.options.otpResendMs ?? 60_000)) throw rateLimited();
      }
      this.reserveInside([
        { scope: 'sms-global', key: 'all', limit: this.options.smsMaxPerHour ?? 60 },
        { scope: 'sms-identity', key: userId, limit: this.options.smsIdentityMaxPerHour ?? 5 },
        { scope: 'sms-phone', key: hash, limit: this.options.smsPhoneMaxPerHour ?? 3 },
      ]);
      for (const [scope, key] of [['identity', userId], ['phone', hash]]) this.db.prepare('INSERT INTO sms_last_attempt(scope,quota_key,attempted_at) VALUES (?,?,?) ON CONFLICT(scope,quota_key) DO UPDATE SET attempted_at=excluded.attempted_at').run(scope!, key!, now);
    });
    const challengeId = randomBytes(16).toString('hex'), code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    const challenge: Challenge = { userId, phoneHash: hash, digest: this.digest(userId, challengeId, hash, code), expiresAt: now + (this.options.otpTtlMs ?? 300_000), attempts: 0, accepted: false };
    this.challenges.set(challengeId, challenge); this.starting.add(userId);
    try {
      await this.provider('sms', () => this.options.smsProvider!.sendCode(phone, code)); this.checkOpen();
      if (this.now() >= challenge.expiresAt || this.challenges.get(challengeId) !== challenge) throw new ServiceError('phone-challenge-expired', 'Verification challenge expired');
      for (const [id, old] of this.challenges) if (id !== challengeId && old.userId === userId) this.removeChallenge(id);
      challenge.accepted = true;
      return { challengeId, expiresAt: challenge.expiresAt, retryAt };
    } catch (error) {
      this.removeChallenge(challengeId);
      if (error instanceof ServiceError) throw error;
      throw new ServiceError('provider-failed', 'SMS provider did not accept verification');
    } finally { this.starting.delete(userId); }
  }
  verifyPhone(userId: string, challengeId: string, code: string) {
    this.checkOpen(); if (!this.options.smsProvider || !this.secret) throw unavailable();
    const challenge = this.challenges.get(challengeId);
    if (!challenge || challenge.userId !== userId || !challenge.accepted) throw new ServiceError('phone-code-invalid', 'Invalid verification challenge or code');
    if (this.now() >= challenge.expiresAt) { this.removeChallenge(challengeId); throw new ServiceError('phone-challenge-expired', 'Verification challenge expired'); }
    challenge.attempts++;
    const actual = this.digest(userId, challengeId, challenge.phoneHash, code);
    const matches = timingSafeEqual(actual, challenge.digest); actual.fill(0);
    if (!matches) {
      if (challenge.attempts >= 5) this.removeChallenge(challengeId);
      throw new ServiceError('phone-code-invalid', 'Invalid verification challenge or code');
    }
    const owner = this.db.prepare('SELECT user_id FROM verified_phones WHERE phone_hash = ?').get(challenge.phoneHash) as { user_id: string } | undefined;
    this.removeChallenge(challengeId); // Success or a binding conflict cannot replay this OTP.
    if (owner && owner.user_id !== userId) throw new ServiceError('phone-already-bound', 'This phone is already bound to another identity');
    this.db.prepare('INSERT INTO verified_phones(user_id,phone_hash,verified_at) VALUES (?,?,?) ON CONFLICT(user_id) DO UPDATE SET phone_hash=excluded.phone_hash,verified_at=excluded.verified_at').run(userId, challenge.phoneHash, this.now());
  }
  discover(userId: string, hashes: string[]): PhoneMatch[] {
    if (!this.options.enableLegacyPhoneServices) throw unavailable();
    this.checkOpen(); if (!this.verified(userId)) throw new ServiceError('phone-verification-required', 'Verify your own phone before discovery');
    if (!hashes.length) return [];
    this.expire(); this.reserve([{ scope: 'discovery-requests', key: userId, limit: 120 }, { scope: 'discovery-hashes', key: userId, limit: 10_000, amount: hashes.length }]);
    const matches: PhoneMatch[] = [];
    for (const hash of new Set(hashes)) {
      const row = this.db.prepare('SELECT user_id FROM verified_phones WHERE phone_hash = ?').get(hash) as { user_id: string } | undefined;
      const user = row && this.lookup(row.user_id); if (user) matches.push({ hash, user });
    }
    return matches;
  }
  registerPush(userId: string, token: string) {
    this.checkOpen(); if (!this.options.pushProvider) throw unavailable();
    const owner = this.db.prepare('SELECT user_id FROM push_tokens WHERE token = ?').get(token) as { user_id: string } | undefined;
    if (owner && owner.user_id !== userId) throw new ServiceError('push-token-in-use', 'This token belongs to another identity');
    this.reserve([{ scope: 'push-register', key: userId, limit: 30 }]);
    this.db.prepare('INSERT INTO push_tokens(user_id,token,updated_at) VALUES (?,?,?) ON CONFLICT(user_id) DO UPDATE SET token=excluded.token,updated_at=excluded.updated_at').run(userId, token, this.now());
  }
  replaceWatchConsent(recipient: string, ids: string[]) {
    this.transaction(() => {
      this.db.prepare('DELETE FROM push_consent WHERE recipient_id = ?').run(recipient);
      for (const sender of new Set(ids)) if (sender !== recipient) this.db.prepare('INSERT INTO push_consent(recipient_id,sender_id) VALUES (?,?)').run(recipient, sender);
    });
  }
  async wake(sender: string, recipient: string, intent?: WakeIntent) {
    this.checkOpen(); if (!this.options.pushProvider) throw unavailable();
    const now = this.now();
    if (intent && intent.expiresAt <= now) throw new ServiceError('wake-expired', 'Notification intent expired');
    const bounded = intent ? { ...intent, expiresAt: Math.min(intent.expiresAt, now + (intent.kind === 'call' ? 30_000 : 60_000)) } : undefined;
    this.expire();
    if (!this.db.prepare('SELECT 1 FROM push_consent WHERE recipient_id = ? AND sender_id = ?').get(recipient, sender)) throw new ServiceError('wake-not-allowed', 'Recipient has not authorized wake notifications from this contact');
    const row = this.db.prepare('SELECT token FROM push_tokens WHERE user_id = ?').get(recipient) as { token: string } | undefined;
    if (!row) return; // No false push-success or delivery receipt frame is returned.
    const key = bounded ? `${sender}:${recipient}:${bounded.intentId}` : undefined;
    if (key && this.wakeIntents.has(key)) return;
    // Static identifiers chosen by the validated enum, never caller-supplied SQL.
    const table = bounded?.kind === 'call' ? 'wake_call_last_attempt' : 'wake_last_attempt';
    const last = this.db.prepare(`SELECT attempted_at FROM ${table} WHERE recipient_id = ?`).get(recipient) as { attempted_at: number } | undefined;
    if (last && now < last.attempted_at + 30_000) return; // Collapse across senders in this class.
    if (key && this.wakeIntents.size >= 4096) throw new ServiceError('service-busy', 'Notification service is busy');
    if (this.activePush >= 8) throw new ServiceError('service-busy', 'Notification service is busy');
    this.reserve([{ scope: 'wake-global', key: 'all', limit: 1000 }, { scope: 'wake-sender', key: sender, limit: 120 }]);
    this.db.prepare(`INSERT INTO ${table}(recipient_id,attempted_at) VALUES (?,?) ON CONFLICT(recipient_id) DO UPDATE SET attempted_at=excluded.attempted_at`).run(recipient, now);
    if (key) this.wakeIntents.set(key, bounded!.expiresAt); // Consume before async work, including failure.
    try { await this.provider('push', () => {
      this.checkOpen();
      if (bounded && bounded.expiresAt <= this.now()) throw new ServiceError('wake-expired', 'Notification intent expired');
      return this.options.pushProvider!.sendWake(row.token, bounded);
    }); }
    catch (error) {
      if (error instanceof InvalidPushToken && !this.closed) this.db.prepare('DELETE FROM push_tokens WHERE user_id = ? AND token = ?').run(recipient, row.token);
      throw error instanceof ServiceError ? error : new ServiceError('provider-failed', 'Push provider did not accept notification');
    }
  }
  iceServers(userId: string) {
    this.checkOpen(); this.expire();
    this.reserve([{ scope: 'ice-user', key: userId, limit: 60 }, { scope: 'ice-global', key: 'all', limit: 1000 }]);
    return this.ice();
  }
  async close() {
    if (this.closed) return; this.closed = true;
    this.wakeIntents.clear();
    for (const id of this.challenges.keys()) this.removeChallenge(id);
    this.secret?.fill(0); this.starting.clear();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const disposal = Promise.allSettled([
      Promise.resolve().then(() => this.options.smsProvider?.dispose?.()),
      Promise.resolve().then(() => this.options.pushProvider?.dispose?.()), ...this.operations,
    ]);
    try { await Promise.race([disposal, new Promise<void>(resolve => { timer = setTimeout(resolve, this.options.providerTimeoutMs ?? 10_000); })]); }
    finally { clearTimeout(timer); }
  }
}
