import { randomBytes } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { createDeviceIdentity, directConversationId, sealMailboxItem, type DeviceIdentity, type MailboxPutItem } from '@messenger/core';

export const SYSTEM_USERNAME = 'lastcall';
const SYSTEM_DISPLAY_NAME = 'LastCall';
const MESSAGE_TTL_MS = 7 * 24 * 3_600_000;

/**
 * The server's own account @lastcall ("LastCall"). It only sends end-to-end encrypted direct
 * messages (to administrators, about access requests), exactly as a phone would. Its key comes from
 * SYSTEM_ACCOUNT_KEY (64 hex) and never leaves the server.
 */
export class SystemAccount {
  readonly identity: DeviceIdentity;
  readonly ready: boolean;
  constructor(private db: DatabaseSync, key: string, private put: (senderId: string, recipientId: string, items: MailboxPutItem[]) => { accepted: boolean }, private now: () => number = Date.now) {
    if (!/^[0-9a-f]{64}$/.test(key)) throw new Error('SYSTEM_ACCOUNT_KEY must be 64 hex characters');
    const seed = Buffer.from(key, 'hex');
    this.identity = createDeviceIdentity(length => { if (length !== 32) throw new Error('Unexpected key length'); return new Uint8Array(seed); });
    const holder = this.db.prepare('SELECT user_id FROM directory_users WHERE username = ?').get(SYSTEM_USERNAME) as { user_id: string } | undefined;
    if (holder && holder.user_id !== this.identity.userId) { console.error('Username @lastcall belongs to another account; system messages are off'); this.ready = false; return; }
    if (!holder) this.db.prepare('INSERT INTO directory_users (user_id, public_key, username, display_name, last_seen) VALUES (?, ?, ?, ?, ?)').run(this.identity.userId, this.identity.publicKey, SYSTEM_USERNAME, SYSTEM_DISPLAY_NAME, this.now());
    this.ready = true;
  }
  /** False when the recipient's app does not take mailbox items (or quotas refused it). */
  send(recipient: { userId: string; publicKey: string }, text: string): boolean {
    if (!this.ready || recipient.userId === this.identity.userId) return false;
    const id = randomBytes(16).toString('hex'), timestamp = this.now();
    const envelope = sealMailboxItem(this.identity, recipient.publicKey, id, { type: 'message', conversationId: directConversationId(this.identity.userId, recipient.userId), id, text: text.slice(0, 4000), timestamp });
    try { return this.put(this.identity.userId, recipient.userId, [{ id, kind: 'message', envelope, expiresAt: timestamp + MESSAGE_TTL_MS }]).accepted; }
    catch { return false; }
  }
}
