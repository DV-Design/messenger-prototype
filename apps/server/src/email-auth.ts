import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { EmailLocale, EmailPurpose } from '@messenger/core';
import type { EmailSender } from './providers.js';
import { ServiceError } from './services.js';

const MAX_ENTRIES = 4096;
const CODE_TTL_MS = 600_000;
const PROOF_TTL_MS = 900_000;
const MAX_ATTEMPTS = 5;
const MAX_ACTIVE_SENDS = 4;
const MAX_QUEUED_SENDS = 256;
const CLOSE_WAIT_MS = 2000;

interface Challenge { purpose: EmailPurpose; emailHash: string; publicKey: string; digest: Buffer; expiresAt: number; attempts: number; slot: string; locale: EmailLocale; email?: string }
interface Proof { publicKey: string; emailHash: string; expiresAt: number }
export interface EmailOutcome { purpose: EmailPurpose; emailHash: string; email?: string; locale: EmailLocale }
export interface EmailQuota { scope: string; key: string; limit: number }
type LetterKind = 'code' | 'account-exists' | 'no-account' | 'recovered';

const SIGN_OFF = '\n\nLastCall';
function letter(kind: LetterKind, locale: EmailLocale, code = '') {
  if (locale === 'ru') {
    if (kind === 'code') return { subject: 'LastCall: код подтверждения', text: `Ваш код подтверждения: ${code}\n\nКод действует 10 минут. Никому его не сообщайте. Если вы его не запрашивали, просто проигнорируйте это письмо.${SIGN_OFF}` };
    if (kind === 'account-exists') return { subject: 'LastCall: у этого адреса уже есть аккаунт', text: `К этому адресу уже привязан аккаунт LastCall, поэтому код не отправлен. Чтобы вернуть аккаунт, выберите в приложении «Восстановить аккаунт».\n\nЕсли это были не вы, просто проигнорируйте это письмо.${SIGN_OFF}` };
    if (kind === 'no-account') return { subject: 'LastCall: аккаунт не найден', text: `К этому адресу не привязан ни один аккаунт LastCall, поэтому код не отправлен. Проверьте адрес или зарегистрируйтесь заново.\n\nЕсли это были не вы, просто проигнорируйте это письмо.${SIGN_OFF}` };
    return { subject: 'LastCall: аккаунт восстановлен', text: `Ваш аккаунт LastCall восстановлен на новом устройстве, прежний ключ больше не действует. Собеседники увидят предупреждение о смене ключа.\n\nЕсли это были не вы, смените пароль почты и восстановите аккаунт на своём устройстве.${SIGN_OFF}` };
  }
  if (kind === 'code') return { subject: 'LastCall: confirmation code', text: `Your confirmation code: ${code}\n\nThe code is valid for 10 minutes. Do not share it. If you did not request it, ignore this email.${SIGN_OFF}` };
  if (kind === 'account-exists') return { subject: 'LastCall: this address already has an account', text: `A LastCall account already uses this address, so no code was sent. To get it back, choose Restore account in the app.\n\nIf this was not you, ignore this email.${SIGN_OFF}` };
  if (kind === 'no-account') return { subject: 'LastCall: no account found', text: `No LastCall account uses this address, so no code was sent. Check the address or register again.\n\nIf this was not you, ignore this email.${SIGN_OFF}` };
  return { subject: 'LastCall: account restored', text: `Your LastCall account was restored on a new device and the previous key no longer works. Your contacts will see a key change warning.\n\nIf this was not you, change your email password and restore the account on your own device.${SIGN_OFF}` };
}

/** Addresses are stored only as a keyed hash; codes, challenges and proofs stay in bounded memory. */
export class EmailAuth {
  private challenges = new Map<string, Challenge>();
  private slots = new Map<string, string>();
  private proofs = new Map<string, Proof>();
  private queue: Array<{ to: string; subject: string; text: string }> = [];
  private active = new Set<Promise<void>>();
  private closed = false;
  private secret?: Buffer;
  constructor(private db: DatabaseSync, private options: { emailSender?: EmailSender; emailHashSecret?: string; emailRequired?: boolean; emailGlobalPerHour?: number; serviceNow?: () => number }, private reserve: (quotas: EmailQuota[]) => void) {
    if (options.emailSender && (!options.emailHashSecret || Buffer.byteLength(options.emailHashSecret) < 32)) throw new Error('EMAIL_HASH_SECRET must contain at least 32 bytes');
    if (options.emailSender) this.secret = Buffer.from(options.emailHashSecret!);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS email_bindings (user_id TEXT PRIMARY KEY REFERENCES directory_users(user_id), email_hash TEXT NOT NULL UNIQUE, verified_at INTEGER NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS moved_identities (old_user_id TEXT PRIMARY KEY, new_user_id TEXT NOT NULL, username TEXT NOT NULL, moved_at INTEGER NOT NULL) STRICT;
      CREATE INDEX IF NOT EXISTS moved_identities_new ON moved_identities(new_user_id);
    `);
  }
  private now() { return (this.options.serviceNow ?? Date.now)(); }
  get required() { return this.options.emailRequired === true; }
  get enabled() { return Boolean(this.secret && !this.closed); }
  private hash(email: string) { return createHmac('sha256', this.secret!).update(JSON.stringify(['lastcall/email/v1', email])).digest('hex'); }
  private digest(challengeId: string, challenge: Pick<Challenge, 'emailHash' | 'purpose' | 'publicKey'>, code: string) {
    return createHmac('sha256', this.secret!).update(JSON.stringify(['lastcall/email-otp/v1', challengeId, challenge.emailHash, challenge.purpose, challenge.publicKey, code])).digest();
  }
  ownerOf(emailHash: string) { return (this.db.prepare('SELECT user_id FROM email_bindings WHERE email_hash = ?').get(emailHash) as { user_id: string } | undefined)?.user_id; }
  movedTo(oldUserId: string) { return (this.db.prepare('SELECT new_user_id FROM moved_identities WHERE old_user_id = ?').get(oldUserId) as { new_user_id: string } | undefined)?.new_user_id; }
  movedFrom(newUserId: string) { return (this.db.prepare('SELECT old_user_id FROM moved_identities WHERE new_user_id = ?').all(newUserId) as Array<{ old_user_id: string }>).map((row) => row.old_user_id); }
  /** Callers provide the transaction: unbind before the old profile row goes, record after the new one exists. */
  unbindInside(userId: string) { this.db.prepare('DELETE FROM email_bindings WHERE user_id = ?').run(userId); }
  /** A later move repoints earlier retired keys to the newest key. */
  recordMoveInside(oldUserId: string, newUserId: string, username: string, emailHash: string) {
    const now = this.now();
    this.db.prepare('INSERT INTO email_bindings(user_id,email_hash,verified_at) VALUES (?,?,?)').run(newUserId, emailHash, now);
    this.db.prepare('UPDATE moved_identities SET new_user_id = ? WHERE new_user_id = ?').run(newUserId, oldUserId);
    this.db.prepare('INSERT INTO moved_identities(old_user_id,new_user_id,username,moved_at) VALUES (?,?,?,?)').run(oldUserId, newUserId, username, now);
  }
  bindInside(userId: string, emailHash: string) {
    this.db.prepare('INSERT INTO email_bindings(user_id,email_hash,verified_at) VALUES (?,?,?) ON CONFLICT(user_id) DO UPDATE SET email_hash=excluded.email_hash,verified_at=excluded.verified_at').run(userId, emailHash, this.now());
  }
  deleteAccountInside(userId: string) {
    this.unbindInside(userId);
    this.db.prepare('DELETE FROM moved_identities WHERE new_user_id = ?').run(userId);
  }
  /** The reply must not depend on the address, so everything after the quotas is silent. */
  start(input: { purpose: EmailPurpose; email: string; locale: EmailLocale; publicKey: string; userId: string; ip: string }): string {
    if (!this.enabled) throw new ServiceError('email-unavailable', 'Email is not configured on this server');
    const emailHash = this.hash(input.email);
    try {
      this.reserve([
        { scope: 'email-address', key: emailHash, limit: 3 }, { scope: 'email-key', key: input.userId, limit: 5 },
        { scope: 'email-ip', key: input.ip, limit: 20 }, { scope: 'email-global', key: 'all', limit: this.options.emailGlobalPerHour ?? 200 },
      ]);
    } catch (error) {
      if (error instanceof ServiceError) throw new ServiceError('email-rate-limited', 'Too many email requests; retry later');
      throw error;
    }
    this.expire();
    const challengeId = randomBytes(16).toString('hex');
    const owner = this.ownerOf(emailHash);
    // Re-confirming your own address is not an account leak, and a refusal letter would make no sense.
    const sendCode = input.purpose === 'recover' ? Boolean(owner) : !owner || (input.purpose === 'bind' && owner === input.userId);
    if (!sendCode) {
      this.enqueue(input.email, letter(input.purpose === 'recover' ? 'no-account' : 'account-exists', input.locale));
      return challengeId;
    }
    const slot = `${emailHash}:${input.purpose}`;
    const previous = this.slots.get(slot); if (previous) this.remove(previous);
    while (this.challenges.size >= MAX_ENTRIES) this.remove(this.challenges.keys().next().value!);
    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    const base = { purpose: input.purpose, emailHash, publicKey: input.publicKey };
    this.challenges.set(challengeId, { ...base, digest: this.digest(challengeId, base, code), expiresAt: this.now() + CODE_TTL_MS, attempts: 0, slot, locale: input.locale, ...(input.purpose === 'recover' ? { email: input.email } : {}) });
    this.slots.set(slot, challengeId);
    this.enqueue(input.email, letter('code', input.locale, code));
    return challengeId;
  }
  /** Wrong code, unknown id, expired and other-key attempts are one indistinguishable refusal. */
  verify(input: { challengeId: string; code: string; publicKey: string }): EmailOutcome {
    const invalid = new ServiceError('email-code-invalid', 'The code is invalid or expired');
    if (!this.enabled) throw new ServiceError('email-unavailable', 'Email is not configured on this server');
    const challenge = this.challenges.get(input.challengeId);
    if (!challenge || challenge.publicKey !== input.publicKey) throw invalid;
    if (this.now() >= challenge.expiresAt) { this.remove(input.challengeId); throw invalid; }
    challenge.attempts++;
    if (!timingSafeEqual(this.digest(input.challengeId, challenge, input.code), challenge.digest)) {
      if (challenge.attempts >= MAX_ATTEMPTS) this.remove(input.challengeId);
      throw invalid;
    }
    const outcome: EmailOutcome = { purpose: challenge.purpose, emailHash: challenge.emailHash, locale: challenge.locale, ...(challenge.email ? { email: challenge.email } : {}) };
    this.remove(input.challengeId);
    return outcome;
  }
  private remove(id: string) {
    const challenge = this.challenges.get(id); if (!challenge) return;
    challenge.digest.fill(0); this.challenges.delete(id);
    if (this.slots.get(challenge.slot) === id) this.slots.delete(challenge.slot);
  }
  createProof(publicKey: string, emailHash: string) {
    this.expire();
    for (const [key, value] of this.proofs) if (value.publicKey === publicKey) this.proofs.delete(key);
    while (this.proofs.size >= MAX_ENTRIES) this.proofs.delete(this.proofs.keys().next().value!);
    const proof = randomBytes(32).toString('hex');
    this.proofs.set(proof, { publicKey, emailHash, expiresAt: this.now() + PROOF_TTL_MS });
    return proof;
  }
  /** Reads without consuming, so a taken username can retry with the same proof. */
  proofHash(proof: string, publicKey: string) {
    const entry = this.proofs.get(proof);
    return entry && entry.publicKey === publicKey && this.now() < entry.expiresAt ? entry.emailHash : undefined;
  }
  consumeProof(proof: string) { this.proofs.delete(proof); }
  sendRecoveredNotice(email: string, locale: EmailLocale) { this.enqueue(email, letter('recovered', locale)); }
  private enqueue(to: string, message: { subject: string; text: string }) {
    if (!this.enabled) return;
    if (this.queue.length >= MAX_QUEUED_SENDS) { console.error('Email queue full; letter dropped'); return; }
    this.queue.push({ to, ...message });
    this.pump();
  }
  private pump() {
    while (this.active.size < MAX_ACTIVE_SENDS && this.queue.length) {
      const message = this.queue.shift()!;
      const task: Promise<void> = Promise.resolve().then(() => this.options.emailSender!.send(message))
        .catch(() => { console.error('Email delivery failed'); })
        .finally(() => { this.active.delete(task); if (!this.closed) this.pump(); });
      this.active.add(task);
    }
  }
  expire() {
    const now = this.now();
    for (const [id, value] of this.challenges) if (now >= value.expiresAt) this.remove(id);
    for (const [key, value] of this.proofs) if (now >= value.expiresAt) this.proofs.delete(key);
  }
  async close() {
    if (this.closed) return; this.closed = true; this.queue = [];
    for (const id of [...this.challenges.keys()]) this.remove(id);
    this.slots.clear(); this.proofs.clear(); this.secret?.fill(0);
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([Promise.allSettled([...this.active]), new Promise<void>((resolve) => { timer = setTimeout(resolve, CLOSE_WAIT_MS); timer.unref?.(); })]);
    clearTimeout(timer);
    await Promise.resolve().then(() => this.options.emailSender?.dispose?.()).catch(() => { console.error('Email transport shutdown failed'); });
  }
}
