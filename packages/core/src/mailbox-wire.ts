import { z } from 'zod';
import { peerIdSchema, roomIdSchema } from './protocol.js';

/**
 * Server mailbox wire format (1.0.40). The server stores and forwards opaque envelopes: what it sees
 * is who wrote to whom, when, how big, and whether the item is a message, a file announcement or a
 * service record (read receipt, edit, reaction, group roster). Text, file names and conversation
 * IDs are inside the envelope, encrypted for the recipient's device.
 */
export const MAILBOX_KINDS = ['message', 'file', 'app'] as const;
export const mailboxKindSchema = z.enum(MAILBOX_KINDS);
export type MailboxKind = z.infer<typeof mailboxKindSchema>;
/** 24-byte nonce followed by ciphertext, as hex. 32 KiB of plaintext at most. */
export const MAX_MAILBOX_ENVELOPE_CHARS = 2 * (24 + 32 * 1024 + 16);
export const mailboxEnvelopeSchema = z.string().min(2 * (24 + 16 + 1)).max(MAX_MAILBOX_ENVELOPE_CHARS).regex(/^(?:[0-9a-f]{2})+$/);
export const MAX_MAILBOX_PUT_ITEMS = 32;
export const MAX_MAILBOX_PAGE_ITEMS = 64;
export const MAX_MAILBOX_RECEIPTS = 256;
/** Bytes of envelopes in one put or one page; the frames themselves stay under the server's limits. */
export const MAX_MAILBOX_BATCH_CHARS = 72 * 1024;
export const mailboxPutItemSchema = z.object({
  id: peerIdSchema, kind: mailboxKindSchema, envelope: mailboxEnvelopeSchema,
  expiresAt: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
}).strict();
export type MailboxPutItem = z.infer<typeof mailboxPutItemSchema>;
export const mailboxItemSchema = z.object({
  seq: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), from: roomIdSchema, id: peerIdSchema,
  kind: mailboxKindSchema, envelope: mailboxEnvelopeSchema, sentAt: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
}).strict();
export type MailboxItem = z.infer<typeof mailboxItemSchema>;
/** "Your message reached this person's phone", produced by the server when the recipient took it. */
export const mailboxReceiptSchema = z.object({ to: roomIdSchema, id: peerIdSchema }).strict();
export type MailboxReceipt = z.infer<typeof mailboxReceiptSchema>;
export const mailboxAckSchema = z.object({ from: roomIdSchema, id: peerIdSchema, delivered: z.boolean() }).strict();
export type MailboxAck = z.infer<typeof mailboxAckSchema>;
export const mailboxRefusalSchema = z.enum(['unsupported', 'full']);
