import type { DatabaseSync } from 'node:sqlite';
import { MAX_MAILBOX_BATCH_CHARS, MAX_MAILBOX_PAGE_ITEMS, MAX_MAILBOX_RECEIPTS, type MailboxAck, type MailboxItem, type MailboxPutItem, type MailboxReceipt } from '@messenger/core';
import { ServiceError } from './services.js';

/** Seven days, the same as a sender's own outbox. */
export const MAILBOX_TTL_MS = 7 * 24 * 3_600_000;
export const MAILBOX_MAX_ITEMS_PER_RECIPIENT = 4000;
export const MAILBOX_MAX_BYTES_PER_RECIPIENT = 48 * 1024 * 1024;
export const MAILBOX_MAX_ITEMS_PER_PAIR = 1500;
export const MAILBOX_MAX_TOTAL_BYTES = 2 * 1024 * 1024 * 1024;
/** First notice for new messages: one push however many arrive in this window. */
const MAILBOX_PUSH_COOLDOWN_MS = 15_000;
/** The phone got a push but did not come for its items: try again with growing pauses. */
const MAILBOX_RETRY_FIRST_MS = 20 * 60_000;
const MAILBOX_RETRY_MAX_MS = 12 * 3_600_000;
const MAILBOX_RETRY_ATTEMPTS = 10;

export interface MailboxHooks {
  now: () => number;
  /** Atomic quota reservation per hour, the same counters every other service uses. */
  reserve: (quotas: Array<{ scope: string; key: string; limit: number }>) => void;
  /** A long-lived "come and fetch" push with no sender, recipient or content in it. */
  push: (recipientId: string, expiresAt: number) => Promise<void>;
  /** Tell a connected phone that something is waiting; false when it is not connected. */
  nudge: (userId: string) => boolean;
  isOnline: (userId: string) => boolean;
}
interface ItemRow { seq: number; sender_id: string; item_id: string; kind: MailboxItem['kind']; envelope: string; created_at: number }

/**
 * Encrypted store-and-forward for small records. The server keeps an item until the recipient's
 * phone takes it (or seven days pass), then keeps only the fact "delivered" until the sender has
 * seen it. File bytes never come here: a file item announces a file the sender hands over directly.
 */
export class Mailbox {
  constructor(private readonly db: DatabaseSync, private readonly hooks: MailboxHooks) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS mailbox_users (user_id TEXT PRIMARY KEY, since INTEGER NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS mailbox_items (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        recipient_id TEXT NOT NULL, sender_id TEXT NOT NULL, item_id TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('message','file','app')),
        envelope TEXT NOT NULL, size INTEGER NOT NULL,
        created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
        UNIQUE (recipient_id, sender_id, item_id)
      );
      CREATE INDEX IF NOT EXISTS mailbox_items_recipient ON mailbox_items(recipient_id, seq);
      CREATE INDEX IF NOT EXISTS mailbox_items_expiry ON mailbox_items(expires_at);
      CREATE TABLE IF NOT EXISTS mailbox_receipts (
        sender_id TEXT NOT NULL, recipient_id TEXT NOT NULL, item_id TEXT NOT NULL,
        created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
        PRIMARY KEY (sender_id, recipient_id, item_id)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS mailbox_push (
        recipient_id TEXT PRIMARY KEY, pushed_at INTEGER NOT NULL, pushed_seq INTEGER NOT NULL, attempts INTEGER NOT NULL
      ) STRICT;
    `);
  }
  private now() { return this.hooks.now(); }
  enable(userId: string) {
    this.db.prepare('INSERT INTO mailbox_users(user_id,since) VALUES (?,?) ON CONFLICT(user_id) DO NOTHING').run(userId, this.now());
  }
  enabled(userId: string) { return Boolean(this.db.prepare('SELECT 1 FROM mailbox_users WHERE user_id = ?').get(userId)); }
  private transaction<T>(work: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = work(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  /** All or nothing per frame, so a sender never has half of a batch on the server. */
  put(senderId: string, recipientId: string, items: MailboxPutItem[]): { accepted: true } | { accepted: false; reason: 'unsupported' | 'full' } {
    if (senderId === recipientId) throw new ServiceError('invalid-target', 'Cannot write to your own mailbox');
    if (!this.enabled(recipientId)) return { accepted: false, reason: 'unsupported' };
    const size = items.reduce((total, item) => total + item.envelope.length, 0);
    if (size > MAX_MAILBOX_BATCH_CHARS || new Set(items.map(item => item.id)).size !== items.length) throw new ServiceError('invalid-frame', 'Mailbox batch is too large or repeats an item');
    this.hooks.reserve([{ scope: 'mailbox-put', key: senderId, limit: 3000 }, { scope: 'mailbox-recipient', key: recipientId, limit: 6000 }]);
    const now = this.now();
    const result = this.transaction(() => {
      const recipient = this.db.prepare('SELECT COUNT(*) AS items, COALESCE(SUM(size),0) AS bytes FROM mailbox_items WHERE recipient_id = ?').get(recipientId) as { items: number; bytes: number };
      const pair = this.db.prepare('SELECT COUNT(*) AS items FROM mailbox_items WHERE recipient_id = ? AND sender_id = ?').get(recipientId, senderId) as { items: number };
      const total = this.db.prepare('SELECT COALESCE(SUM(size),0) AS bytes FROM mailbox_items').get() as { bytes: number };
      if (recipient.items + items.length > MAILBOX_MAX_ITEMS_PER_RECIPIENT || recipient.bytes + size > MAILBOX_MAX_BYTES_PER_RECIPIENT
        || pair.items + items.length > MAILBOX_MAX_ITEMS_PER_PAIR || total.bytes + size > MAILBOX_MAX_TOTAL_BYTES) return { accepted: false as const, reason: 'full' as const };
      const insert = this.db.prepare('INSERT INTO mailbox_items(recipient_id,sender_id,item_id,kind,envelope,size,created_at,expires_at) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(recipient_id,sender_id,item_id) DO NOTHING');
      for (const item of items) {
        const expiresAt = Math.min(item.expiresAt, now + MAILBOX_TTL_MS);
        if (expiresAt > now) insert.run(recipientId, senderId, item.id, item.kind, item.envelope, item.envelope.length, now, expiresAt);
      }
      return { accepted: true as const };
    });
    if (result.accepted && !this.hooks.nudge(recipientId)) void this.notify(recipientId).catch(() => { /* The tick retries. */ });
    return result;
  }
  /** Oldest first. `after` skips items this phone could not take yet in the same session. */
  fetch(userId: string, after = 0, profile: (id: string) => unknown) {
    const now = this.now();
    const rows = this.db.prepare(`SELECT seq,sender_id,item_id,kind,envelope,created_at FROM mailbox_items WHERE recipient_id = ? AND seq > ? AND expires_at > ? ORDER BY seq LIMIT ${MAX_MAILBOX_PAGE_ITEMS + 1}`).all(userId, after, now) as unknown as ItemRow[];
    const items: MailboxItem[] = []; let chars = 0;
    for (const row of rows.slice(0, MAX_MAILBOX_PAGE_ITEMS)) {
      if (items.length && chars + row.envelope.length > MAX_MAILBOX_BATCH_CHARS) break;
      chars += row.envelope.length;
      items.push({ seq: row.seq, from: row.sender_id, id: row.item_id, kind: row.kind, envelope: row.envelope, sentAt: row.created_at });
    }
    const receiptRows = this.db.prepare(`SELECT recipient_id,item_id FROM mailbox_receipts WHERE sender_id = ? AND expires_at > ? ORDER BY created_at LIMIT ${MAX_MAILBOX_RECEIPTS + 1}`).all(userId, now) as Array<{ recipient_id: string; item_id: string }>;
    const receipts: MailboxReceipt[] = receiptRows.slice(0, MAX_MAILBOX_RECEIPTS).map(row => ({ to: row.recipient_id, id: row.item_id }));
    const users = [...new Set(items.map(item => item.from))].map(profile).filter(Boolean);
    return { items, users, receipts, more: items.length < rows.length || receiptRows.length > MAX_MAILBOX_RECEIPTS };
  }
  /** Taken items leave the server; a delivered message leaves only a receipt for its sender. */
  ack(userId: string, items: MailboxAck[], receipts: MailboxReceipt[]) {
    const now = this.now(); const senders = new Set<string>();
    this.transaction(() => {
      const remove = this.db.prepare('DELETE FROM mailbox_items WHERE recipient_id = ? AND sender_id = ? AND item_id = ? RETURNING kind');
      const receipt = this.db.prepare('INSERT INTO mailbox_receipts(sender_id,recipient_id,item_id,created_at,expires_at) VALUES (?,?,?,?,?) ON CONFLICT DO NOTHING');
      for (const item of items) {
        const removed = remove.get(userId, item.from, item.id) as { kind: string } | undefined;
        if (removed?.kind === 'message' && item.delivered) { receipt.run(item.from, userId, item.id, now, now + MAILBOX_TTL_MS); senders.add(item.from); }
      }
      const seen = this.db.prepare('DELETE FROM mailbox_receipts WHERE sender_id = ? AND recipient_id = ? AND item_id = ?');
      for (const value of receipts) seen.run(userId, value.to, value.id);
      if (!this.db.prepare('SELECT 1 FROM mailbox_items WHERE recipient_id = ? LIMIT 1').get(userId)) this.db.prepare('DELETE FROM mailbox_push WHERE recipient_id = ?').run(userId);
    });
    for (const sender of senders) this.hooks.nudge(sender);
  }
  deleteAccountInside(userId: string) {
    this.db.prepare('DELETE FROM mailbox_items WHERE recipient_id = ? OR sender_id = ?').run(userId, userId);
    this.db.prepare('DELETE FROM mailbox_receipts WHERE recipient_id = ? OR sender_id = ?').run(userId, userId);
    this.db.prepare('DELETE FROM mailbox_push WHERE recipient_id = ?').run(userId);
    this.db.prepare('DELETE FROM mailbox_users WHERE user_id = ?').run(userId);
  }
  expire() {
    const now = this.now();
    this.db.prepare('DELETE FROM mailbox_items WHERE expires_at <= ?').run(now);
    this.db.prepare('DELETE FROM mailbox_receipts WHERE expires_at <= ?').run(now);
    this.db.prepare('DELETE FROM mailbox_push WHERE recipient_id NOT IN (SELECT DISTINCT recipient_id FROM mailbox_items)').run();
  }
  /**
   * The newest message or file this phone may be woken for: only from people it lets wake it (its
   * contacts), the same consent every other push uses. Service records never wake a phone.
   */
  private newest(recipientId: string) {
    return this.db.prepare(`SELECT MAX(i.seq) AS seq, MAX(i.expires_at) AS expires FROM mailbox_items i JOIN push_consent c ON c.recipient_id = i.recipient_id AND c.sender_id = i.sender_id
      WHERE i.recipient_id = ? AND i.kind IN ('message','file') AND i.expires_at > ?`).get(recipientId, this.now()) as { seq: number | null; expires: number | null };
  }
  private async notify(recipientId: string) {
    if (this.hooks.isOnline(recipientId)) return;
    const newest = this.newest(recipientId); if (!newest.seq || !newest.expires) return;
    const now = this.now();
    const state = this.db.prepare('SELECT pushed_at,pushed_seq,attempts FROM mailbox_push WHERE recipient_id = ?').get(recipientId) as { pushed_at: number; pushed_seq: number; attempts: number } | undefined;
    const fresh = !state || newest.seq > state.pushed_seq;
    const due = fresh
      ? !state || now >= state.pushed_at + MAILBOX_PUSH_COOLDOWN_MS
      : state.attempts < MAILBOX_RETRY_ATTEMPTS && now >= state.pushed_at + Math.min(MAILBOX_RETRY_MAX_MS, MAILBOX_RETRY_FIRST_MS * 2 ** (state.attempts - 1));
    if (!due) return;
    this.db.prepare('INSERT INTO mailbox_push(recipient_id,pushed_at,pushed_seq,attempts) VALUES (?,?,?,1) ON CONFLICT(recipient_id) DO UPDATE SET pushed_at = excluded.pushed_at, pushed_seq = excluded.pushed_seq, attempts = CASE WHEN ? THEN 1 ELSE mailbox_push.attempts + 1 END')
      .run(recipientId, now, newest.seq, fresh ? 1 : 0);
    await this.hooks.push(recipientId, newest.expires);
  }
  /** Catches what the moment of storing could not: a cooldown that ended, a phone that never came. */
  async tick() {
    const rows = this.db.prepare(`SELECT DISTINCT i.recipient_id FROM mailbox_items i JOIN push_consent c ON c.recipient_id = i.recipient_id AND c.sender_id = i.sender_id WHERE i.kind IN ('message','file') AND i.expires_at > ? LIMIT 500`).all(this.now()) as Array<{ recipient_id: string }>;
    for (const row of rows) await this.notify(row.recipient_id).catch(() => { /* Next tick. */ });
  }
}
