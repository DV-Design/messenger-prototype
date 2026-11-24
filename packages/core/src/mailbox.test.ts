import { describe, expect, it } from 'vitest';
import { createDeviceIdentity, directConversationId, directoryClientFrameSchema } from './directory.js';
import { mailboxRecordId, openMailboxItem, sealMailboxItem } from './mailbox.js';

const alice = createDeviceIdentity(n => new Uint8Array(n).fill(41));
const bob = createDeviceIdentity(n => new Uint8Array(n).fill(42));
const carol = createDeviceIdentity(n => new Uint8Array(n).fill(43));
const id = 'ab'.repeat(16);
const conversationId = directConversationId(alice.userId, bob.userId);
const message = { type: 'message' as const, conversationId, id, text: 'Привет, это секрет', timestamp: 1 };

describe('server mailbox envelopes', () => {
  it('opens only for the recipient, from the real sender, under the same ID and kind', () => {
    const envelope = sealMailboxItem(alice, bob.publicKey, id, message);
    expect(envelope).not.toContain('секрет');
    expect(openMailboxItem(bob, alice.publicKey, { from: alice.userId, id, kind: 'message', envelope })).toEqual(message);
    expect(() => openMailboxItem(carol, alice.publicKey, { from: alice.userId, id, kind: 'message', envelope })).toThrow();
    expect(() => openMailboxItem(bob, carol.publicKey, { from: carol.userId, id, kind: 'message', envelope })).toThrow();
    expect(() => openMailboxItem(bob, alice.publicKey, { from: alice.userId, id: 'cd'.repeat(16), kind: 'message', envelope })).toThrow();
    expect(() => openMailboxItem(bob, alice.publicKey, { from: alice.userId, id, kind: 'app', envelope })).toThrow();
    const tampered = envelope.slice(0, -2) + (envelope.endsWith('00') ? '01' : '00');
    expect(() => openMailboxItem(bob, alice.publicKey, { from: alice.userId, id, kind: 'message', envelope: tampered })).toThrow();
  });
  it('refuses a direct chat of another pair and an item larger than the limit', () => {
    expect(() => sealMailboxItem(alice, carol.publicKey, id, message)).toThrow(/conversation/);
    expect(() => sealMailboxItem(alice, bob.publicKey, id, { ...message, text: 'x'.repeat(4001) })).toThrow();
  });
  it('carries a file announcement without the file and fits a put frame', () => {
    const file = { type: 'file' as const, conversationId, id, name: 'photo.jpg', mime: 'image/jpeg', size: 1234, timestamp: 2 };
    const envelope = sealMailboxItem(alice, bob.publicKey, id, file);
    expect(openMailboxItem(bob, alice.publicKey, { from: alice.userId, id, kind: 'file', envelope })).toEqual(file);
    expect(directoryClientFrameSchema.safeParse({ type: 'mailbox-put', requestId: 'ef'.repeat(16), to: bob.userId, items: [{ id, kind: 'file', envelope, expiresAt: 10 }] }).success).toBe(true);
  });
  it('a watch frame may narrow who can wake the phone, never widen it', () => {
    const frame = (consent?: string[]) => directoryClientFrameSchema.safeParse({ type: 'watch', userIds: [alice.userId, bob.userId], ...(consent ? { consent } : {}) }).success;
    expect(frame()).toBe(true); expect(frame([alice.userId])).toBe(true); expect(frame([])).toBe(true);
    expect(frame([carol.userId])).toBe(false);
  });
  it('gives the same service record the same ID', () => {
    expect(mailboxRecordId(['read', 'a', 1])).toBe(mailboxRecordId(['read', 'a', 1]));
    expect(mailboxRecordId(['read', 'a', 1])).not.toBe(mailboxRecordId(['read', 'a', 2]));
    expect(mailboxRecordId(['x'])).toMatch(/^[0-9a-f]{32}$/);
  });
});
