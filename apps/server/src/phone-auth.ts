import { createHmac, randomBytes } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { isRussianNumber, maskPhone, normalizePhone, phoneCountry, type DirectoryUser, type PhoneVisibility, type TelegramPurpose } from '@messenger/core';
import { ServiceError } from './services.js';
import type { TelegramContact } from './telegram-bot.js';

const SESSION_TTL_MS = 600_000;
const PROOF_TTL_MS = 900_000;
const MAX_ENTRIES = 4096;
interface Session { publicKey: string; purpose: TelegramPurpose; token: string; expiresAt: number; chatId?: number; phone?: string }
export interface PhoneOutcome { purpose: TelegramPurpose; phone: string; phoneHash: string; country?: string; hint: string }
interface Proof { publicKey: string; outcome: PhoneOutcome; expiresAt: number }
export interface PhoneQuota { scope: string; key: string; limit: number; amount?: number }

/**
 * Numbers confirmed through our Telegram bot. The server keeps a keyed hash, the country and a
 * masked hint ("+7 ••• ••• 12"); the number itself is kept only for Russian numbers, on the Russian
 * server (ru-store). Sessions and proofs stay in bounded memory.
 */
export class PhoneAuth {
  private sessions = new Map<string, Session>();
  private byToken = new Map<string, string>();
  private byChat = new Map<number, string>();
  private proofs = new Map<string, Proof>();
  private secret?: Buffer;
  constructor(private db: DatabaseSync, private options: { phoneHashSecret?: string; serviceNow?: () => number; link?: (token: string) => string | undefined }, private reserve: (quotas: PhoneQuota[]) => void) {
    if (options.phoneHashSecret !== undefined && Buffer.byteLength(options.phoneHashSecret) < 32) throw new Error('PHONE_HASH_SECRET must contain at least 32 bytes');
    if (options.phoneHashSecret) this.secret = Buffer.from(options.phoneHashSecret);
    const columns = this.db.prepare('PRAGMA table_info(verified_phones)').all() as Array<{ name: string }>;
    if (!columns.some(column => column.name === 'country')) this.db.exec('ALTER TABLE verified_phones ADD COLUMN country TEXT');
    if (!columns.some(column => column.name === 'hint')) this.db.exec("ALTER TABLE verified_phones ADD COLUMN hint TEXT NOT NULL DEFAULT ''");
    if (!columns.some(column => column.name === 'visibility')) this.db.exec("ALTER TABLE verified_phones ADD COLUMN visibility TEXT NOT NULL DEFAULT 'everyone' CHECK(visibility IN ('everyone','contacts','nobody'))");
  }
  private now() { return (this.options.serviceNow ?? Date.now)(); }
  /** Telegram sign-in needs both the hash key and a running bot. */
  get enabled() { return Boolean(this.secret && this.options.link?.('x'.repeat(16))); }
  private hash(e164: string) { return createHmac('sha256', this.secret!).update(JSON.stringify(['lastcall/phone/v1', e164])).digest('hex'); }
  start(input: { publicKey: string; purpose: TelegramPurpose; userId: string; ip: string }) {
    if (!this.enabled) throw new ServiceError('telegram-unavailable', 'Telegram sign-in is not configured on this server');
    try {
      this.reserve([{ scope: 'telegram-key', key: input.userId, limit: 10 }, { scope: 'telegram-ip', key: input.ip, limit: 30 }, { scope: 'telegram-global', key: 'all', limit: 2000 }]);
    } catch (error) {
      if (error instanceof ServiceError) throw new ServiceError('telegram-rate-limited', 'Too many requests; retry later');
      throw error;
    }
    this.expire();
    for (const [id, session] of this.sessions) if (session.publicKey === input.publicKey) this.remove(id);
    while (this.sessions.size >= MAX_ENTRIES) this.remove(this.sessions.keys().next().value!);
    const sessionId = randomBytes(16).toString('hex');
    const token = randomBytes(24).toString('base64url');
    const expiresAt = this.now() + SESSION_TTL_MS;
    this.sessions.set(sessionId, { publicKey: input.publicKey, purpose: input.purpose, token, expiresAt });
    this.byToken.set(token, sessionId);
    return { sessionId, url: this.options.link!(token)!, expiresAt };
  }
  /** Bot: a deep link was opened in this chat. */
  onStart(token: string, chatId: number): boolean {
    const id = this.byToken.get(token); const session = id ? this.sessions.get(id) : undefined;
    if (!id || !session || this.now() >= session.expiresAt || session.phone) return false;
    if (session.chatId !== undefined) this.byChat.delete(session.chatId);
    session.chatId = chatId; this.byChat.set(chatId, id);
    return true;
  }
  /** Bot: the person shared a contact. Only their own number counts. */
  onContact(chatId: number, contact: TelegramContact): 'ok' | 'not-own' | 'anonymous' | 'invalid' | 'no-session' {
    const id = this.byChat.get(chatId); const session = id ? this.sessions.get(id) : undefined;
    if (!id || !session || this.now() >= session.expiresAt) return 'no-session';
    if (contact.ownerId === undefined || contact.ownerId !== contact.fromId) return 'not-own';
    const raw = contact.phone.trim();
    let phone: string;
    try { phone = normalizePhone(raw.startsWith('+') ? raw : `+${raw}`); } catch { return raw.replace(/\D/g, '').startsWith('888') ? 'anonymous' : 'invalid'; }
    if (phone.startsWith('+888')) return 'anonymous';
    session.phone = phone; this.byChat.delete(chatId);
    return 'ok';
  }
  /** pending until the bot has the number; the outcome is handed out once. */
  check(sessionId: string, publicKey: string): { state: 'pending' | 'expired' } | { state: 'verified'; outcome: PhoneOutcome } {
    const session = this.sessions.get(sessionId);
    if (!session || session.publicKey !== publicKey) return { state: 'expired' };
    if (this.now() >= session.expiresAt) { this.remove(sessionId); return { state: 'expired' }; }
    if (!session.phone) return { state: 'pending' };
    const phone = session.phone; this.remove(sessionId);
    return { state: 'verified', outcome: { purpose: session.purpose, phone, phoneHash: this.hash(phone), country: isRussianNumber(phone) ? 'RU' : phoneCountry(phone) ?? undefined, hint: maskPhone(phone) } };
  }
  private remove(id: string) {
    const session = this.sessions.get(id); if (!session) return;
    this.sessions.delete(id); this.byToken.delete(session.token);
    if (session.chatId !== undefined && this.byChat.get(session.chatId) === id) this.byChat.delete(session.chatId);
  }
  createProof(publicKey: string, outcome: PhoneOutcome) {
    for (const [key, value] of this.proofs) if (value.publicKey === publicKey) this.proofs.delete(key);
    while (this.proofs.size >= MAX_ENTRIES) this.proofs.delete(this.proofs.keys().next().value!);
    const proof = randomBytes(32).toString('hex');
    this.proofs.set(proof, { publicKey, outcome, expiresAt: this.now() + PROOF_TTL_MS });
    return proof;
  }
  /** Reads without consuming, so a taken username can retry with the same proof. */
  proof(proof: string, publicKey: string): PhoneOutcome | undefined {
    const entry = this.proofs.get(proof);
    return entry && entry.publicKey === publicKey && this.now() < entry.expiresAt ? entry.outcome : undefined;
  }
  consumeProof(proof: string) { this.proofs.delete(proof); }
  ownerOf(phoneHash: string) { return (this.db.prepare('SELECT user_id FROM verified_phones WHERE phone_hash = ?').get(phoneHash) as { user_id: string } | undefined)?.user_id; }
  /** Callers provide the transaction. */
  bindInside(userId: string, outcome: PhoneOutcome, visibility: PhoneVisibility = 'everyone') {
    this.db.prepare(`INSERT INTO verified_phones(user_id,phone_hash,verified_at,country,hint,visibility) VALUES (?,?,?,?,?,?)
      ON CONFLICT(user_id) DO UPDATE SET phone_hash=excluded.phone_hash,verified_at=excluded.verified_at,country=excluded.country,hint=excluded.hint`)
      .run(userId, outcome.phoneHash, this.now(), outcome.country ?? null, outcome.hint, visibility);
  }
  record(userId: string) {
    return this.db.prepare('SELECT phone_hash,country,hint,visibility FROM verified_phones WHERE user_id = ?').get(userId) as { phone_hash: string; country: string | null; hint: string; visibility: PhoneVisibility } | undefined;
  }
  state(userId: string): { phone?: string; visibility: PhoneVisibility } {
    const row = this.record(userId);
    return row ? { ...(row.hint ? { phone: row.hint } : {}), visibility: row.visibility } : { visibility: 'everyone' };
  }
  setVisibility(userId: string, visibility: PhoneVisibility) {
    if (!this.record(userId)) throw new ServiceError('phone-required', 'Link a phone number first');
    this.db.prepare('UPDATE verified_phones SET visibility = ? WHERE user_id = ?').run(visibility, userId);
  }
  /**
   * Contact search: numbers come in over TLS, are hashed and dropped. Only people with a confirmed
   * number whose setting allows the requester are returned ("contacts" = they watch the requester).
   */
  find(requesterId: string, phones: string[], lookup: (userId: string) => DirectoryUser | undefined) {
    if (!this.secret) throw new ServiceError('service-unavailable', 'This service is not configured');
    if (!this.record(requesterId)) throw new ServiceError('phone-required', 'Link your own phone number before searching by number');
    try {
      this.reserve([{ scope: 'phone-find', key: requesterId, limit: 30 }, { scope: 'phone-find-numbers', key: requesterId, limit: 5000, amount: phones.length }]);
    } catch (error) {
      if (error instanceof ServiceError) throw new ServiceError('phone-find-limit', 'Too many numbers checked; retry later');
      throw error;
    }
    const matches: Array<{ phone: string; user: DirectoryUser }> = [];
    const select = this.db.prepare('SELECT user_id,visibility FROM verified_phones WHERE phone_hash = ?');
    const watches = this.db.prepare('SELECT 1 FROM push_consent WHERE recipient_id = ? AND sender_id = ?');
    for (const phone of new Set(phones)) {
      const row = select.get(this.hash(phone)) as { user_id: string; visibility: PhoneVisibility } | undefined;
      if (!row || row.user_id === requesterId || row.visibility === 'nobody') continue;
      if (row.visibility === 'contacts' && !watches.get(row.user_id, requesterId)) continue;
      const user = lookup(row.user_id); if (user) matches.push({ phone, user });
    }
    return matches;
  }
  expire() {
    const now = this.now();
    for (const [id, session] of this.sessions) if (now >= session.expiresAt) this.remove(id);
    for (const [key, value] of this.proofs) if (now >= value.expiresAt) this.proofs.delete(key);
  }
  close() { this.sessions.clear(); this.byToken.clear(); this.byChat.clear(); this.proofs.clear(); this.secret?.fill(0); }
}
