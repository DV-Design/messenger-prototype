import * as SQLite from 'expo-sqlite';
import type { Directory } from 'expo-file-system';
import type { LocalRecordStore } from '@messenger/core';

/**
 * The history as encrypted records in SQLite (each row is sealed by the core with the device key;
 * SQLite only stores them). A save is one transaction holding just the rows that changed, run on
 * SQLite's own thread, so the JavaScript thread no longer encrypts and writes the whole history.
 */
const open = new Set<SQLite.SQLiteDatabase>();
/** One connection and store object per database, reused when the messenger is rebuilt. */
const stores = new Map<string, Promise<LocalRecordStore>>();

export function openRecordStore(directory: Directory, name: string): Promise<LocalRecordStore> {
  const key = `${directory.uri}|${name}`;
  let store = stores.get(key);
  if (!store) {
    store = connect(directory, name);
    stores.set(key, store);
    store.catch(() => stores.delete(key));
  }
  return store;
}

async function connect(directory: Directory, name: string): Promise<LocalRecordStore> {
  const path = decodeURIComponent(directory.uri.replace(/^file:\/\//, '')).replace(/\/+$/, '');
  const db = await SQLite.openDatabaseAsync(name, undefined, path);
  open.add(db);
  // WAL: a write does not block reads, and a crash mid-write leaves the last complete transaction.
  await db.execAsync('PRAGMA journal_mode = WAL; CREATE TABLE IF NOT EXISTS records (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL) WITHOUT ROWID;');
  return {
    load: () => db.getAllAsync<{ key: string; value: string }>('SELECT key, value FROM records'),
    write: (put, remove) => db.withExclusiveTransactionAsync(async transaction => {
      const upsert = await transaction.prepareAsync('INSERT OR REPLACE INTO records (key, value) VALUES (?, ?)');
      const drop = await transaction.prepareAsync('DELETE FROM records WHERE key = ?');
      try {
        for (const key of remove) await drop.executeAsync(key);
        for (const row of put) await upsert.executeAsync(row.key, row.value);
      } finally {
        await upsert.finalizeAsync();
        await drop.finalizeAsync();
      }
    }),
  };
}

/** Before the account's folder is deleted: an open database would keep its files alive. */
export async function closeRecordStores(): Promise<void> {
  const databases = [...open];
  open.clear();
  stores.clear();
  await Promise.all(databases.map(db => db.closeAsync().catch(() => {})));
}
