# LastCall: email registration, binding and account recovery

Owner decisions (2026-11-04): an emailed code restores the account onto a **new**
device key; email is **required for new registrations**, optional for existing
users; letters go over plain SMTP, so the provider stays replaceable, and it must be
free (Yandex 360 was rejected for that reason). This supersedes the
"losing the key is not recoverable" and "no new phone/email" lines of
`USERNAME-CONTRACT.md`. Everything else in that contract stands.

## What recovery does and does not promise

Recovery returns the `@username` and display name. It does not return chat history,
the contact list, group membership or unsent queued messages: backups stay out of
scope and the old private key is gone. The new key has a new `userId`, because
`userId` is the hash of the public key.

There is no cryptographic link between the old and new key. The server and anyone
controlling the mailbox can move a username, and contacts must be told so honestly:
never migrate a conversation or re-encrypt queued messages silently, and never mark
the new key verified. Do not describe this as protection against a malicious server.

## Server state and privacy

The server stores no plaintext address. Lookup uses
`HMAC-SHA256(EMAIL_HASH_SECRET, ['lastcall/email/v1', normalized])`, where normalized
is trimmed and lowercased with no provider-specific rewriting. The address stays in
memory only while a letter is being sent, and for a recover challenge until it ends (up
to 10 minutes), because the notice letter needs it. Never log addresses, codes or proofs.

- `email_bindings(user_id PK REFERENCES directory_users, email_hash UNIQUE, verified_at)`
- `moved_identities(old_user_id PK, new_user_id, username, moved_at)`: when an account
  moves again, repoint earlier rows to the newest `new_user_id`.
- Account deletion removes the binding and the account's `moved_identities` rows, so
  deleted accounts are not forwarded and the username is freed as it is today.

Codes, challenges and proofs stay in bounded memory (max 4096), and a restart just
makes the user request a new code.

## Protocol

All three frames use the existing one-shot pattern of `resolve-profile`: a short-lived
`/directory` connection, the challenge is consumed, the signature proves the device key,
and the server replies and closes. They never authenticate or publish presence.
Each signature has its own purpose string and covers the challenge and all fields.

| Client frame | Fields | Reply |
|---|---|---|
| `email-start` | `purpose: register\|recover\|bind`, `email`, `locale: en\|ru`, `publicKey`, `signature` | `email-started {challengeId}` |
| `email-verify` | `challengeId`, `code` (6 digits), `publicKey`, `signature` | `email-verified {proof?, user?}` |

`authenticate` gains an optional `emailProof`, which is outside the signed payload and
is bound to the key on the server. It is used only when creating a profile.

**No enumeration.** `email-started` is identical and immediate whether or not the address
has an account: mail is sent in the background, and a random `challengeId` is returned
even when no code exists. Wrong code, unknown challenge and expired challenge all return
`email-code-invalid`. What the mailbox receives:

| Purpose | Address has an account | Address is free |
|---|---|---|
| `register` | "you already have an account, use Restore" (no code) | code |
| `recover` | code | "no account uses this address" (no code) |
| `bind` | same as register | code |

**Limits.** Codes: 6 digits via `randomInt`, stored as an HMAC, 10 minutes, 5 attempts.
A new start replaces the previous challenge for the same address and purpose. Hourly
quotas: 3 per address and 5 per key, 20 per client IP, global `EMAIL_GLOBAL_PER_HOUR`
(default 200; keep it within the provider's allowance) (`email-rate-limited`).
These apply whether or not an account exists, so they reveal nothing. `Directory.open`
receives the client IP from `server.ts`. Not configured: `email-unavailable`. Refusals
that depend only on the signing key are allowed on `email-start`: `profile-required` for
`bind` without a profile, `device-already-registered` for the other purposes with one,
and `account-moved` for a retired key. Binding your own address sends a code.

**Results of `email-verify`:**

- `register`: returns `proof` (random, 15 minutes, bound to key and address hash). It is
  consumed only when the profile is inserted, so `username-taken` can retry with it.
- `bind`: key must own a profile. Sets or replaces its binding in one step. Fails with
  `email-taken` if the address now belongs to another account. Returns neither field.
- `recover`: atomically moves the account and returns `user`.

**The move, in one transaction:** fail with `device-already-registered` if the new key has
a profile and with `account-moved` if it is retired. Delete the old service records and row,
insert the new row with the same username and display name, repoint the binding, write
`moved_identities`. `userIdFromPublicKey` validates the key before any change. After commit:
close the old key's live connection with `account-moved`, send `identity-moved` to capable
watchers, and send a notice letter to the address.

**Registration gate.** `EMAIL_REQUIRED=1`: a new key without a valid proof gets
`email-required`. An address already bound gets `email-taken`. Existing profiles never need
a proof and always reconnect. A valid proof is honored even when the flag is off. The flag
lets the server ship first and be turned on only after SMTP and the new client are live.
Old clients on a fresh install simply see the error.

**Retired keys.** Any `authenticate` from a key in `moved_identities` gets terminal
`account-moved`. `resolve-profile` returns `null` for it.

**Contacts.** Server frame `identity-moved {oldUserId, user}`. Clients opt in with
`identityMovedV1: true` on `watch`, because the strict schema in released clients treats an
unknown frame as fatal and would disconnect them: never send it without the flag. It is sent
on the move to connections watching the old id, and on every capable `watch` for each listed
moved id. `watch` must also tolerate ids with no profile (check the `push_consent` foreign key).

## Client

`email-auth.ts` in core: `startEmailChallenge` and `verifyEmailChallenge`, modeled on
`resolveDeviceProfile` (bounded frames, 15 second timeout, socket always closed, network
failure never reported as a negative answer). `MessengerOptions` gains `emailProof`.
New terminal codes: `email-required`, `email-taken`, `account-moved`.

`MessengerClient` keeps `movedContacts` (old id to new user) in memory and snapshot, since the
server repeats it on every connect, so persisted state does not change. If the old contact is
blocked, the new identity is blocked as well and no prompt is shown. `acceptMovedContact(oldId)`
remembers the new user and opens a new direct chat. The old chat stays read-only history.

Mobile:

- Onboarding starts with Create account or Restore account. Create: email, code, then name,
  username and terms. Restore: email, code, done. Resend after 60 seconds. If the server
  answers `email-unavailable`, registration may continue without email; recovery cannot.
- Settings, Account section: bound address or a warning that without email a reinstall
  loses the account, plus bind and change. The address is kept in SecureStore with
  the same options as the profile and removed with the local account.
- One dismissible reminder in the chat list for users without an address.
- Old chat banner: says the contact restored the account on a new key, that the identity
  is not confirmed until the safety code is compared, and that unsent messages will not reach
  the new key. It has one action that opens the new chat. Applies to direct chats only.
- Retired device: `account-moved` shows a clear message and stops reconnecting.
- All strings in English and Russian via `t()`.

## Known limitations (state them, do not hide them)

- Changing the address does not notify the old one, since the server does not keep it.
- A phone unlocked by someone else can change the bound address.
- Groups still list the old id. The restored user has to be added again.
- Accounts without a bound address cannot be restored.
- Addresses are ASCII only, so Cyrillic-domain addresses are refused. This stops one
  value from becoming several recipients.
- Someone who knows an address can use up its three hourly requests or replace its
  active code, which delays a restore by up to an hour but grants nothing.

## Rollout

The server ships first: clients built from this contract send `identityMovedV1` on `watch`,
which an older server's strict schema refuses by closing the connection. This also applies
to any self-hosted server set in the app. `EMAIL_HASH_SECRET` must stay stable and backed
up, or no bound address can be found again. Turn on `EMAIL_REQUIRED=1` last.

## Validation

Server: every enumeration row above, including identical replies; code expiry and attempts;
proof binding, single use and survival across `username-taken`; quotas; the move's atomicity
(failure leaves the old account intact); repeat moves; retired-key rejection; `identity-moved`
only with the flag; `watch` with unknown ids; deletion cleanup; nothing plaintext in the
database; no address or code in logs. Core: schemas, helper cleanup and timeouts, signature
purpose separation. Mobile: pure flow-model tests. `npm run check` and `npm run test:e2e` must
pass. Delivery of real letters and the full flow on phones stay open until SMTP exists.
