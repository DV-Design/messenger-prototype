import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { z } from 'zod';
import { bytesToHex, hexToBytes, randomChecked, secureRandomBytes, type RandomBytes } from './crypto.js';
import { conversationInvite, directConversationId, userIdFromPublicKey, type DeviceIdentity } from './directory.js';
import { mailboxEnvelopeSchema, type MailboxKind } from './mailbox-wire.js';
import { conversationIdSchema, MAX_BULK_BYTES, MAX_TEXT_CHARS, peerIdSchema } from './protocol.js';

export * from './mailbox-wire.js';

const MAX_PLAINTEXT_BYTES = 32 * 1024;
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
const metadataSchema = z.string().max(12000).optional();
const timestampSchema = z.number().finite().nonnegative();
export const mailboxMessageSchema = z.object({
  type: z.literal('message'), conversationId: conversationIdSchema, id: peerIdSchema,
  text: z.string().min(1).max(MAX_TEXT_CHARS), timestamp: timestampSchema, metadata: metadataSchema,
}).strict();
/** A file the sender will hand over directly: enough to hold its place in the chat until then. */
export const mailboxFileSchema = z.object({
  type: z.literal('file'), conversationId: conversationIdSchema, id: peerIdSchema,
  name: z.string().min(1).max(255), mime: z.string().max(255), size: z.number().int().min(0).max(MAX_BULK_BYTES),
  large: z.literal(true).optional(), timestamp: timestampSchema, metadata: metadataSchema,
}).strict();
/** Read receipts, edits, reactions and group rosters: signed records the receiver checks as if they came directly. */
export const mailboxAppSchema = z.object({ type: z.literal('app'), payload: z.unknown() }).strict();
export const mailboxPayloadSchema = z.discriminatedUnion('type', [mailboxMessageSchema, mailboxFileSchema, mailboxAppSchema]);
export type MailboxPayload = z.infer<typeof mailboxPayloadSchema>;

function context(senderId: string, recipientId: string, id: string, kind: MailboxKind) {
  return encoder.encode(JSON.stringify(['lastcall/mailbox/v1', senderId, recipientId, id, kind]));
}
/**
 * The pair key both devices already derive from their identity keys (X25519 from Ed25519, HKDF),
 * separated by purpose. Only these two devices can open an item, and an item cannot be moved to
 * another sender, recipient, ID or kind. There is no ratchet: unlike a live direct session, a stolen
 * identity key would open items still waiting on the server.
 */
function key(identity: DeviceIdentity, remotePublicKey: string, aad: Uint8Array) {
  const pair = hexToBytes(conversationInvite(identity, remotePublicKey));
  try { return hkdf(sha256, pair, encoder.encode('lastcall/mailbox/hkdf/v1'), aad, 32); }
  finally { pair.fill(0); }
}
function kindOf(payload: MailboxPayload): MailboxKind { return payload.type; }

export function sealMailboxItem(identity: DeviceIdentity, remotePublicKey: string, id: string, payload: MailboxPayload, random: RandomBytes = secureRandomBytes): string {
  peerIdSchema.parse(id);
  const parsed = mailboxPayloadSchema.parse(payload);
  const recipientId = userIdFromPublicKey(remotePublicKey);
  if (recipientId === identity.userId) throw new Error('Cannot send a mailbox item to self');
  if (parsed.type !== 'app' && parsed.conversationId.startsWith('dm:') && parsed.conversationId !== directConversationId(identity.userId, recipientId)) throw new Error('Mailbox conversation mismatch');
  const plaintext = encoder.encode(JSON.stringify(parsed));
  if (plaintext.length > MAX_PLAINTEXT_BYTES) throw new Error('Mailbox item exceeds limit');
  const aad = context(identity.userId, recipientId, id, kindOf(parsed));
  const nonce = randomChecked(random, 24); const derived = key(identity, remotePublicKey, aad);
  try { return mailboxEnvelopeSchema.parse(bytesToHex(nonce) + bytesToHex(xchacha20poly1305(derived, nonce, aad).encrypt(plaintext))); }
  finally { derived.fill(0); plaintext.fill(0); }
}

export function openMailboxItem(identity: DeviceIdentity, senderPublicKey: string, item: { from: string; id: string; kind: MailboxKind; envelope: string }): MailboxPayload {
  const envelope = mailboxEnvelopeSchema.parse(item.envelope);
  if (userIdFromPublicKey(senderPublicKey) !== item.from) throw new Error('Mailbox sender key mismatch');
  const aad = context(item.from, identity.userId, item.id, item.kind);
  const derived = key(identity, senderPublicKey, aad); let plaintext: Uint8Array | undefined;
  try {
    plaintext = xchacha20poly1305(derived, hexToBytes(envelope.slice(0, 48)), aad).decrypt(hexToBytes(envelope.slice(48)));
    if (plaintext.length > MAX_PLAINTEXT_BYTES) throw new Error('Mailbox item exceeds limit');
    const payload = mailboxPayloadSchema.parse(JSON.parse(decoder.decode(plaintext)));
    if (kindOf(payload) !== item.kind) throw new Error('Mailbox kind mismatch');
    if (payload.type !== 'app') {
      if (payload.id !== item.id) throw new Error('Mailbox item ID mismatch');
      if (payload.conversationId.startsWith('dm:') && payload.conversationId !== directConversationId(identity.userId, item.from)) throw new Error('Mailbox conversation mismatch');
    }
    return payload;
  } finally { derived.fill(0); plaintext?.fill(0); }
}

/** Service records get IDs from what they are, so the same receipt or edit sent twice is stored once. */
export function mailboxRecordId(parts: readonly (string | number)[]): string {
  return bytesToHex(sha256(encoder.encode(JSON.stringify(['lastcall/mailbox-record/v1', ...parts])))).slice(0, 32);
}
