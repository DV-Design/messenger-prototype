# Encrypted server mailbox (1.0.40)

User direction (2026-11-23): messages go through the server encrypted, the way secret chats
do in well-known messengers; files, voice notes and video circles keep going directly. The server
must know a file is waiting, keep it in its place in the queue and show the recipient where it will
appear, waiting for the sender's phone. Pushes say only who has unread messages, never the text.

This supersedes the "the server has no chat-content mailbox" rule of
[OUTBOX-CONTRACT.md](OUTBOX-CONTRACT.md) for texts and service records. The sender-held outbox
stays: it is still the source of truth and the fallback for anything the server does not take.

## What goes where

| Item | Path | Server keeps |
|---|---|---|
| Text (direct and group) | mailbox, encrypted | ciphertext until the recipient's phone takes it, ≤ 7 days |
| Read receipt, edit, delete for everyone, reaction | mailbox, encrypted (`app`) | the same |
| Group roster (before a group's first item) | mailbox, encrypted (`app`) | the same |
| File, voice note, video circle (≤ 5 MiB and up to 1 GiB) | direct, as before | an encrypted announcement (`file`): name, type, size, origin |
| Calls | direct, as before | nothing new |

## Encryption

`packages/core/src/mailbox.ts`. XChaCha20-Poly1305 with a key from HKDF over the existing pair
secret (Ed25519→X25519 of both identities, `conversationInvite`), info
`lastcall/mailbox/hkdf/v1`, bound by AAD to sender, recipient, item ID and kind. Only the two
devices can open an item; an item cannot be replayed under another sender, recipient, ID or kind.
There is no ratchet: unlike a live direct session, someone holding an identity key could open items
still on the server. This is stated in the privacy policy and must not be described as a
production ratchet.

## Protocol

Directory frames (`packages/core/src/directory.ts`, schemas in `mailbox-wire.ts`):

- `services` with `mailboxV1: true`: the server records that this account takes mailbox items
  and answers `mailboxV1: true`. Only clients with `MessengerOptions.mailbox` ask.
- `mailbox-put {to, items[≤32, ≤72 KiB]}` → `mailbox-stored {accepted, reason?}`. All or nothing.
  `unsupported`: the recipient's app never asked for the mailbox (older app), so the sender keeps
  the direct path. `full`: quotas (4000 items / 48 MiB per recipient, 1500 per pair, 2 GiB total).
- `mailbox-fetch {after?}` → `mailbox {items, users, receipts, more}`, oldest first. `users`
  carries public profiles of senders, so a first message from someone new opens a chat.
- `mailbox-ack {items: [{from, id, delivered}], receipts}` → `mailbox-acked`. A taken item is
  deleted. A delivered `message` leaves a receipt `{to, id}` for its sender (≤ 7 days) until the
  sender acknowledges it; that receipt is the second tick. Files never produce a receipt: they
  count as delivered only after the direct transfer.
- `mailbox-available`: nudge to a connected phone that asked for the mailbox.

Client (`MessengerClient`):

- After a text is saved it is posted at once; recipients the server accepted are recorded in
  `pending.mailboxed`. Those texts need no direct connection, no wake and no delivery request, so
  the phone does not open WebRTC just to send text. Single tick = on the server.
- An item is acknowledged only after it is saved locally. A failed local save leaves it on the
  server; invalid, forged, blocked or unknown-chat items are dropped (`delivered: false`).
- A file announcement creates a placeholder (`MessengerFile.waiting`) at the file's own timestamp,
  counted as unread. The bytes still come over the direct path and are checked against the signed
  origin (groups) or the direct-file timing; then `waiting` is cleared.
- The file's sender keeps its delivery request (`delivery-sync`), so the server still wakes both
  phones to meet for the transfer.

## Pushes

- Mailbox push: the existing content-free `lastcall-delivery` (role `recipient`) with a long TTL,
  only for senders the recipient allows (`push_consent`, i.e. contacts), at most once per 15 s
  burst, retried with growing pauses (20 min doubling, ≤ 12 h, 10 times) while items wait.
  Service records never wake a phone.
- The phone wakes, fetches, saves and shows one notice per chat: title = sender (or group),
  body = "You have an unread message" / "You have unread messages: N". No text, no file name.
- The server drops encrypted text previews that older senders still attach to wakes; older
  recipients get a generic wake.

## Compatibility

- New app, new server: mailbox. New app, older recipient app: server refuses, direct path.
- New app, old server: the server rejects `mailboxV1` in `services`; the existing probe falls back
  without `deliveryV1`/`mailboxV1`. Deploy the server before releasing 1.0.40.
- Server tables: `mailbox_users`, `mailbox_items`, `mailbox_receipts`, `mailbox_push`; all
  removed with the account. Directory frame limit raised from 16 to 80 KiB.

## Verification

- Core: `mailbox.test.ts` (sealing, tampering, wrong pair/ID/kind).
- Server: `test/mailbox.test.ts` with real `MessengerClient`s over WebSockets: offline delivery,
  delivered and read ticks, first message from a stranger, file placeholder order, group roster and
  message to offline members, refusal for older apps; storage, quotas, push cooldown/retry rules.
