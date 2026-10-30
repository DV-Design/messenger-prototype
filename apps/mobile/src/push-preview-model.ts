import type { MessengerSnapshot, WakeIntent } from '@messenger/core';
export const MAX_PREVIEW_ENVELOPE_BYTES = 3000;
export const MAX_PREVIEW_BODY_BYTES = 800;
export const PREVIEW_DEDUP_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_LEDGER = 512;
const object = (value: unknown): Record<string, unknown> | undefined => typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
const utf8 = (value: string) => new TextEncoder().encode(value).length;

/** Only known Expo/FCM containers are traversed; ciphertext is never parsed as a wrapper. */
function dataObjects(payload: unknown): Record<string, unknown>[] {
  const pending: { value: unknown; depth: number }[] = [{ value: payload, depth: 0 }];
  const seen = new Set<object>(); const result: Record<string, unknown>[] = [];
  while (pending.length && seen.size < 32) {
    const { value, depth } = pending.shift()!;
    const record = object(value);
    if (!record || seen.has(record) || depth > 6) continue;
    seen.add(record);
    if (record.kind === 'lastcall-wake' || record.kind === 'lastcall-message-preview') result.push(record);
    for (const key of ['notification', 'request', 'content', 'data']) {
      if (object(record[key])) pending.push({ value: record[key], depth: depth + 1 });
    }
    for (const key of ['dataString', 'body']) {
      const encoded = record[key];
      if (typeof encoded !== 'string' || encoded.length > 8192 || utf8(encoded) > 12_288 || !encoded.trimStart().startsWith('{')) continue;
      try { pending.push({ value: JSON.parse(encoded), depth: depth + 1 }); } catch { /* Invalid wrappers are not trusted data. */ }
    }
  }
  return result;
}
export const isEncryptedMessagePreview = (payload: unknown): boolean => {
  try { return dataObjects(payload).some(data => data.kind === 'lastcall-wake' && typeof data.preview === 'string'); } catch { return false; }
};
export const isLocalMessagePreview = (payload: unknown): boolean => {
  try { return dataObjects(payload).some(data => data.kind === 'lastcall-message-preview'); } catch { return false; }
};
export function parseMessagePreview(payload: unknown, now = Date.now()): { envelope: string; intent: WakeIntent } | null {
  try {
    const candidates = dataObjects(payload).filter(data => data.kind === 'lastcall-wake' && data.preview !== undefined);
    if (!candidates.length) return null;
    const parsed = candidates.map(data => {
      if ((data.intentKind !== 'message' && data.intentKind !== 'file') || typeof data.intentId !== 'string' || !/^[a-f0-9]{32}$/.test(data.intentId)
        || typeof data.expiresAt !== 'string' || !/^[0-9]{10,16}$/.test(data.expiresAt)
        || typeof data.preview !== 'string' || !data.preview.length || data.preview.length > MAX_PREVIEW_ENVELOPE_BYTES || utf8(data.preview) > MAX_PREVIEW_ENVELOPE_BYTES) throw new Error('Invalid preview');
      const expiresAt = Number(data.expiresAt);
      if (!Number.isSafeInteger(expiresAt) || expiresAt <= now || expiresAt > now + 65_000) throw new Error('Expired preview');
      return { envelope: data.preview, intent: { kind: data.intentKind as 'message' | 'file', intentId: data.intentId, expiresAt } };
    });
    const first = parsed[0]!;
    if (parsed.some(value => value.envelope !== first.envelope || value.intent.kind !== first.intent.kind || value.intent.intentId !== first.intent.intentId || value.intent.expiresAt !== first.intent.expiresAt)) return null;
    return first;
  } catch { return null; }
}
/** Match preview and actual P2P by origin, never by wake-intent ID or message text. */
export const notificationIdentity = (scope: string, senderId: string, conversationId: string, messageId: string, kind = 'message'): string =>
  JSON.stringify(['lastcall/message-notification/v1', scope, senderId, conversationId, messageId, kind]);
export function messagePreviewBody(text: string, alreadyTruncated = false): string {
  if (!alreadyTruncated && utf8(text) <= MAX_PREVIEW_BODY_BYTES) return text;
  let body = ''; let size = 0;
  for (const point of text) {
    const length = utf8(point);
    if (size + length > MAX_PREVIEW_BODY_BYTES - 3) break;
    body += point; size += length;
  }
  return body + '…';
}
export type SeenPreview = { id: string; until: number };
/** Serial local+headless dedup. Native IDs cover an OS-post / ledger-write crash gap. */
export class PreviewDeduper {
  private entries = new Map<string, number>();
  private loaded = false;
  private queue = Promise.resolve();
  constructor(private readonly storage: { load(): Promise<unknown>; save(value: SeenPreview[]): Promise<void>; contains(id: string): Promise<boolean> }, private readonly now = Date.now) {}
  async prepare() {
    if (this.loaded) return;
    const saved = await this.storage.load();
    if (saved !== null && !Array.isArray(saved)) throw new Error('Invalid notification ledger');
    const now = this.now();
    for (const value of (saved ?? []).slice(-MAX_LEDGER)) {
      const item = object(value);
      if (item && typeof item.id === 'string' && /^lastcall-message-[a-f0-9]{64}$/.test(item.id) && typeof item.until === 'number' && Number.isSafeInteger(item.until) && item.until > now) this.entries.set(item.id, item.until);
    }
    this.loaded = true;
  }
  async run(id: string, display: () => Promise<boolean>): Promise<boolean> {
    let shown = false;
    const operation = this.queue.catch(() => {}).then(async () => {
      await this.prepare(); const now = this.now();
      for (const [key, until] of this.entries) if (until <= now) this.entries.delete(key);
      if (this.entries.has(id)) return;
      if (!(await this.storage.contains(id))) { shown = await display(); if (!shown) return; }
      this.entries.set(id, now + PREVIEW_DEDUP_TTL_MS);
      while (this.entries.size > MAX_LEDGER) this.entries.delete(this.entries.keys().next().value!);
      await this.storage.save([...this.entries].map(([key, until]) => ({ id: key, until })));
    });
    this.queue = operation;
    await operation; return shown;
  }
}
/** Baseline persisted history before first directory-ready; never replay it as fresh. */
export class IncomingMessageTracker {
  private online = false;
  private seen = new Set<string>();
  next(snapshot: MessengerSnapshot): { kind: 'message' | 'file'; conversationId: string; senderId: string; messageId: string; text: string; displayName: string }[] {
    const result: ReturnType<IncomingMessageTracker['next']> = [];
    const current = new Set<string>();
    for (const conversation of snapshot.conversations) for (const message of conversation.messages) {
      if (message.status !== 'received') continue;
      const key = notificationIdentity('', message.from, conversation.id, message.id); current.add(key);
      if (this.online && !this.seen.has(key)) {
        const sender = snapshot.contacts.find(contact => contact.userId === message.from);
        if (sender && conversation.memberIds.includes(sender.userId)) result.push({ kind: 'message', conversationId: conversation.id, senderId: sender.userId, messageId: message.id, text: message.text, displayName: sender.displayName });
      }
    }
    for (const conversation of snapshot.conversations) for (const file of conversation.files) {
      if (file.deliveryStatus !== 'received' || file.status !== 'complete' || !file.blobKey) continue;
      const key = notificationIdentity('', file.senderId, conversation.id, file.id, 'file'); current.add(key);
      if (this.online && !this.seen.has(key)) {
        const sender = snapshot.contacts.find(contact => contact.userId === file.senderId);
        if (sender && conversation.memberIds.includes(sender.userId)) result.push({ kind: 'file', conversationId: conversation.id, senderId: sender.userId, messageId: file.id, text: `Файл: ${file.name}`, displayName: sender.displayName });
      }
    }
    this.seen = current;
    if (snapshot.status === 'online') this.online = true;
    return result;
  }
}
