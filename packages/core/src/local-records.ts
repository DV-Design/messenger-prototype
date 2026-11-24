import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { base64ToBytes, bytesToBase64, hexToBytes, randomChecked, secureRandomBytes, type RandomBytes } from './crypto.js';
import { validateDeviceIdentity, type DeviceIdentity } from './directory.js';

/**
 * Local history as many small encrypted records instead of one sealed blob.
 *
 * Re-encrypting the whole history (XChaCha20 in JavaScript, ~60 ms for 500 messages on a phone
 * without JIT) after every change was the main stall left when opening and using chats. Here
 * each contact, chat, message, file, receipt, edit and reaction is its own record; a save compares
 * the records with what was last written and encrypts and writes only those that changed, in one
 * transaction of the platform store (SQLite on the phone).
 *
 * Records:
 * - `meta`: version, pending deliveries, verified and blocked contacts, and the order of contacts and chats;
 * - `c:<userId>`: a contact; `v:<conversationId>`: a chat without its lists;
 * - `l:<conversationId>:<field>`: the ordered item ids of one list of that chat;
 * - `i:<id>`: one list item (a message, file, receipt, edit, tombstone or reaction).
 *
 * Each record is sealed on its own with a key derived from the device key, and its key is bound into
 * the authentication data, so a record cannot be moved to another key. A referenced record that is
 * missing makes the whole history invalid, as a damaged sealed blob did before.
 */
export interface LocalRecord { key: string; value: string }
export interface LocalRecordStore {
  /** Every record, in any order (never the archive). */
  load(): Promise<LocalRecord[]>;
  /** Applies all of it atomically, or none of it; `archive` rows are added in the same transaction. */
  write(put: LocalRecord[], remove: string[], archive?: LocalRecord[]): Promise<void>;
  /**
   * Older history kept out of memory: rows whose key starts with `prefix` and sorts below `before`,
   * newest first. A store without these keeps no archive, and old history is then dropped as before.
   */
  loadArchive?(prefix: string, before: string | undefined, limit: number): Promise<LocalRecord[]>;
  dropArchive?(prefix: string): Promise<void>;
}

export const RECORD_LIST_FIELDS = ['messages', 'files', 'receipts', 'readReceipts', 'changes', 'tombstones', 'reactions'] as const;
type ListField = typeof RECORD_LIST_FIELDS[number];
type Json = Record<string, unknown>;
interface StoredShape { version: number; contacts: Json[]; conversations: Json[]; pending: unknown[]; verified?: unknown[]; blocked?: unknown[] }

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
const MAX_RECORD_CHARS = 8 * 1024 * 1024;

/** Turns a stored state into plaintext records, reusing item ids for items that did not change. */
export class LocalRecordLayout {
  private next = 0;
  /** What the store holds now (plaintext JSON by record key). */
  private committed = new Map<string, string>();

  /** Records for `state`; ids of unchanged items are taken from what was last committed. */
  layout(state: StoredShape): Map<string, string> {
    const records = new Map<string, string>();
    const contactIds: string[] = [];
    for (const contact of state.contacts) {
      const id = String(contact.userId);
      contactIds.push(id);
      records.set(`c:${id}`, JSON.stringify(contact));
    }
    const conversationIds: string[] = [];
    let next = this.next;
    for (const conversation of state.conversations) {
      const id = String(conversation.id);
      conversationIds.push(id);
      const scalars: Json = {};
      for (const [key, value] of Object.entries(conversation)) if (!(RECORD_LIST_FIELDS as readonly string[]).includes(key)) scalars[key] = value;
      records.set(`v:${id}`, JSON.stringify(scalars));
      for (const field of RECORD_LIST_FIELDS) {
        const items = conversation[field];
        if (!Array.isArray(items)) continue;
        // Previous ids of this list by content, so an unchanged item keeps its record.
        const reusable = new Map<string, string[]>();
        const previous = this.committed.get(`l:${id}:${field}`);
        if (previous) for (const itemId of JSON.parse(previous) as string[]) {
          const json = this.committed.get(`i:${itemId}`);
          if (json === undefined) continue;
          const ids = reusable.get(json);
          if (ids) ids.push(itemId); else reusable.set(json, [itemId]);
        }
        const ids: string[] = [];
        for (const item of items) {
          const json = JSON.stringify(item);
          let itemId = reusable.get(json)?.shift();
          if (itemId === undefined || records.has(`i:${itemId}`)) itemId = (next++).toString(36);
          ids.push(itemId);
          records.set(`i:${itemId}`, json);
        }
        records.set(`l:${id}:${field}`, JSON.stringify(ids));
      }
    }
    const { contacts: _contacts, conversations: _conversations, ...rest } = state;
    records.set('meta', JSON.stringify({ ...rest, contactOrder: contactIds, conversationOrder: conversationIds }));
    this.pendingNext = next;
    return records;
  }

  private pendingNext = 0;

  /** The changes that turn the committed records into `records`. */
  diff(records: Map<string, string>): { put: [string, string][]; remove: string[] } {
    const put: [string, string][] = [];
    for (const [key, json] of records) if (this.committed.get(key) !== json) put.push([key, json]);
    const remove = [...this.committed.keys()].filter(key => !records.has(key));
    return { put, remove };
  }

  /** Call only after the store accepted the write. */
  commit(records: Map<string, string>): void {
    this.committed = records;
    this.next = Math.max(this.next, this.pendingNext);
  }

  /** Rebuilds the stored state from plaintext records and takes them as committed. */
  assemble(records: Map<string, string>): StoredShape {
    const read = (key: string) => {
      const json = records.get(key);
      if (json === undefined) throw new Error('Invalid local records');
      return JSON.parse(json) as unknown;
    };
    const meta = read('meta') as Json & { contactOrder?: unknown; conversationOrder?: unknown };
    if (!Array.isArray(meta.contactOrder) || !Array.isArray(meta.conversationOrder)) throw new Error('Invalid local records');
    const used = new Set<string>(['meta']);
    const take = (key: string) => {
      if (used.has(key)) throw new Error('Invalid local records');
      used.add(key);
      return read(key);
    };
    const contacts = meta.contactOrder.map(id => take(`c:${String(id)}`) as Json);
    let highest = -1;
    const conversations = meta.conversationOrder.map(rawId => {
      const id = String(rawId);
      const conversation = take(`v:${id}`) as Json;
      for (const field of RECORD_LIST_FIELDS) {
        if (!records.has(`l:${id}:${field}`)) continue;
        const ids = take(`l:${id}:${field}`);
        if (!Array.isArray(ids)) throw new Error('Invalid local records');
        conversation[field as ListField] = ids.map(itemId => {
          const numeric = parseInt(String(itemId), 36);
          if (Number.isFinite(numeric)) highest = Math.max(highest, numeric);
          return take(`i:${String(itemId)}`);
        });
      }
      return conversation;
    });
    const { contactOrder: _contactOrder, conversationOrder: _conversationOrder, ...rest } = meta;
    // Unreferenced leftovers are not part of the history; they stay committed, so the next save removes them.
    this.committed = new Map(records);
    this.next = highest + 1;
    this.pendingNext = this.next;
    return { ...rest, contacts, conversations } as StoredShape;
  }
}

/** Seals and opens single records; the key is derived once per store. */
export class LocalRecordCipher {
  private readonly key: Uint8Array;
  private readonly userId: string;

  constructor(identity: DeviceIdentity, private readonly random: RandomBytes = secureRandomBytes) {
    validateDeviceIdentity(identity);
    this.userId = identity.userId;
    this.key = hkdf(sha256, hexToBytes(identity.privateKey), encoder.encode('messenger/local-record/hkdf/v1'), encoder.encode(identity.userId), 32);
  }

  private aad(recordKey: string) { return encoder.encode(`messenger/local-record/v1/${this.userId}/${recordKey}`); }

  seal(recordKey: string, json: string): string {
    const nonce = randomChecked(this.random, 24);
    const ciphertext = xchacha20poly1305(this.key, nonce, this.aad(recordKey)).encrypt(encoder.encode(json));
    return `1.${bytesToBase64(nonce)}.${bytesToBase64(ciphertext)}`;
  }

  open(recordKey: string, value: string): string {
    if (typeof value !== 'string' || value.length > MAX_RECORD_CHARS) throw new Error('Invalid local record');
    const parts = value.split('.');
    if (parts.length !== 3 || parts[0] !== '1' || !/^[A-Za-z0-9+/]{32}$/.test(parts[1]!) || !/^[A-Za-z0-9+/]+={0,2}$/.test(parts[2]!) || parts[2]!.length % 4 !== 0) throw new Error('Invalid local record');
    return decoder.decode(xchacha20poly1305(this.key, base64ToBytes(parts[1]!), this.aad(recordKey)).decrypt(base64ToBytes(parts[2]!)));
  }

  /** Forget the key when the account is closed. */
  wipe(): void { this.key.fill(0); }
}

/** Ties layout, cipher and store together for one account. */
export class LocalRecordWriter {
  private readonly layout = new LocalRecordLayout();
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private readonly store: LocalRecordStore, private readonly cipher: LocalRecordCipher) {}

  /** Reads and writes of one store run one at a time, whichever client asks. */
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const next = this.queue.catch(() => {}).then(work);
    this.queue = next;
    return next;
  }

  /** The stored state, or null when the store has nothing yet. */
  read(): Promise<StoredShape | null> { return this.serial(() => this.readNow()); }
  write(state: StoredShape, archive: { key: string; json: string }[] = []): Promise<number> { return this.serial(() => this.writeNow(state, archive)); }
  get archives(): boolean { return typeof this.store.loadArchive === 'function' && typeof this.store.dropArchive === 'function'; }
  /** One page of archived rows, decrypted, newest first. */
  readArchive(prefix: string, before: string | undefined, limit: number): Promise<{ key: string; json: string }[]> {
    return this.serial(async () => (await this.store.loadArchive!(prefix, before, limit)).map(row => ({ key: row.key, json: this.cipher.open(row.key, row.value) })));
  }
  dropArchive(prefix: string): Promise<void> { return this.serial(() => this.store.dropArchive!(prefix)); }

  private async readNow(): Promise<StoredShape | null> {
    const rows = await this.store.load();
    if (!rows.length) return null;
    const records = new Map<string, string>();
    for (const row of rows) records.set(row.key, this.cipher.open(row.key, row.value));
    return this.layout.assemble(records);
  }

  /** Writes what changed since the last successful write; returns how many records were written. */
  private async writeNow(state: StoredShape, archive: { key: string; json: string }[]): Promise<number> {
    const records = this.layout.layout(state);
    const { put, remove } = this.layout.diff(records);
    if (!put.length && !remove.length && !archive.length) return 0;
    const sealed = archive.map(row => ({ key: row.key, value: this.cipher.seal(row.key, row.json) }));
    await this.store.write(put.map(([key, json]) => ({ key, value: this.cipher.seal(key, json) })), remove, ...(sealed.length ? [sealed] : []));
    this.layout.commit(records);
    return put.length;
  }
}

/**
 * One writer per store and device key, shared by every client of that account: a client that
 * replaces another (after a wake or a reconnect) continues the same committed view and id counter
 * instead of writing over records the other one still believes it owns.
 */
const writers = new WeakMap<LocalRecordStore, Map<string, LocalRecordWriter>>();
export function localRecordWriter(store: LocalRecordStore, identity: DeviceIdentity, random?: RandomBytes): LocalRecordWriter {
  let byIdentity = writers.get(store);
  if (!byIdentity) { byIdentity = new Map(); writers.set(store, byIdentity); }
  let writer = byIdentity.get(identity.userId);
  if (!writer) { writer = new LocalRecordWriter(store, new LocalRecordCipher(identity, random)); byIdentity.set(identity.userId, writer); }
  return writer;
}
