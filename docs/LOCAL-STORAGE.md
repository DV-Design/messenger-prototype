# Local history storage

Since app 1.0.36 the history on the phone is a SQLite database of separately encrypted records
(`packages/core/src/local-records.ts`, `apps/mobile/src/record-store.ts`). Before, it was one sealed
file that was decrypted, re-encrypted and rewritten whole after every change.

## Why

XChaCha20-Poly1305 runs in JavaScript (Hermes has no JIT). Sealing a 500-message history took
~60 ms of the ~80 ms a save cost, on the JavaScript thread, after every message, receipt or read.
Measured with the core in Node without JIT on 500 messages:

| | Single file | Records |
|---|---|---|
| Save after one message changed | ~80 ms | ~12 ms, 2 records written |
| Start: read the history | ~85 ms (estimated: decrypt ~72 + validate ~12) | ~125 ms (521 records, measured) |
| One-time move of an existing history | — | ~210 ms |

## Records

| Key | Content |
|---|---|
| `meta` | state version, pending deliveries, verified and blocked contacts, order of contacts and chats |
| `c:<userId>` | one contact |
| `v:<conversationId>` | one chat without its lists |
| `l:<conversationId>:<field>` | ordered item ids of `messages`, `files`, `receipts`, `readReceipts`, `changes`, `tombstones` or `reactions` |
| `i:<id>` | one item of such a list |

A save builds these records from the validated state, compares them with what was last written,
and writes only the changed ones and removes the dropped ones, in one SQLite transaction. An item
whose content did not change keeps its id; a changed item gets a new id (the list record changes
with it). One writer per database is shared by every client of the account.

Each record is sealed on its own: key `HKDF-SHA256(device private key, "messenger/local-record/hkdf/v1", userId)`,
random 24-byte nonce, and authentication data `messenger/local-record/v1/<userId>/<record key>`, so a
record cannot be decrypted under another key or moved to another record. Loading fails when a
referenced record is missing or used twice, as a damaged sealed file did. Like the file before, a
copy of the whole database can be rolled back to an older copy by someone with access to the
app's private storage; that is outside this design.

## Migration

On the first start with records, an empty database and an existing `<userId>-<serverHash>.sealed`
file mean the history is still in the old file: it is opened, validated, and written as records.
The old file is deleted only after that write succeeded; if the write fails, the file stays and the
move is retried. Version-1 (hex) and version-2 (base64) sealed files are both read.

The database `<userId>-<serverHash>.db` lives in the same `messenger-v2` folder, so "Delete account"
removes it with the rest after closing it. Attachments are unchanged (separate encrypted files).
