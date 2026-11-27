# Sign-up through Telegram, access requests, contact search, Russian data

Owner's decisions of 2026-11-27. This file describes the design; it is not evidence of a release.

## Goals

- A phone number for every new account, confirmed by Telegram (our own bot, no SMS): contact
  search by number and identification.
- Accounts made through Telegram need **no email and no invitation**.
- People who cannot use Telegram ask the administrator; an approved request delivers an
  invitation code straight into the waiting app, which then registers by email as before.
- Accounts that already exist (email) stay as they are and may link a number later.
- Data of users with a Russian number lives first on the Russian server; Italy, where the service
  runs, keeps a copy (2015 ministry clarifications: primary database in Russia, copy abroad).

## Telegram bot

- The owner creates the bot with @BotFather; the token lives only in the server environment
  (`TELEGRAM_BOT_TOKEN`), never in the repository or the app.
- The Italian server long-polls `getUpdates` (no inbound webhook, nothing new exposed).
- The app asks the server for a link (`telegram-start`, signed by the device key, purpose
  `register`, `recover` or `bind`) and gets `https://t.me/<bot>?start=<token>` (one-time,
  10 minutes, bound to the device key).
- The bot answers `/start <token>` with one button, "Share my phone number"
  (`request_contact`). It accepts a contact only when `contact.user_id` equals the sender's id
  (the person's own number, not a forwarded card), refuses `+888` (anonymous numbers without a
  SIM), and replies "Done, return to LastCall".
- The app checks the session (`telegram-check`, signed) when it comes back to the foreground and
  every 2 s while the screen is open: `pending`, `verified`, `expired`.
- Stored: `phone_hash = HMAC(PHONE_HASH_SECRET, E.164)` and the number's country. The number
  itself is kept only for Russian numbers and only on the Russian server (identification).
  The Telegram user id is not stored.

| Purpose | Number free | Number has an account |
|---|---|---|
| register | proof → profile form (name, @username), no email, no invitation | "This number already has an account" → offer Restore |
| recover | "No account uses this number" | account moves to this device key (as email recovery) |
| bind | number linked to the signed-in account | "This number belongs to another account" |

## Access requests

- `access-request` (signed by the device key): name, optional contact, message (≤ 500 chars).
  Limits: one open request per device key, 3 per key per day, 20 per address per hour.
- The server's system account **@lastcall** ("LastCall", key in the server environment) sends
  every administrator (`REGISTRATION_ADMIN_USER_IDS`) a direct message: who, what they wrote,
  and "Settings → Invitations → Requests".
- Administrators see **Settings → Invitations → Requests** with Approve / Decline.
- Approve creates a normal invitation code (not counted in the daily five) bound to that request.
- The requester's app checks `access-request-status` (signed): `pending`, `approved` with the
  code, or `declined`. Approved opens email sign-up with the code filled in.

## Contact search by number

- Privacy setting **Who can find me by my number**: Everyone (default) / My contacts / Nobody.
  "My contacts" means people whose updates you receive (the existing watch list).
- The app reads the phone book only after the contacts permission and only when the person taps
  "Find friends from contacts"; it sends normalised numbers over TLS, at most 500 per request
  and 5000 per day. The server hashes them, answers with matching LastCall users and keeps
  nothing.
- Only users with a confirmed number and a matching setting are returned.

## Russian data

- "Russian user" = confirmed number in the Russian numbering plan (+7 except Kazakhstan's
  +7 6xx / 7xx).
- The Russian server runs a small store service (`ru-store`) reachable from Italy only through a
  restricted SSH tunnel.
- Registration, recovery and number linking of a Russian user write the profile, number, number
  hash and email hash to `ru-store` **first**; Italy commits only after the Russian write
  succeeded. Without the Russian server, Russian sign-ups wait ("try again later").
- Later changes (last seen, push token, contacts watch list, deletion) are sent to `ru-store`
  right after Italy commits; a full reconciliation of all Russian users runs every 10 minutes.
- Messages stay end-to-end encrypted and pass through Italy's mailbox as before.
- Every 30 minutes the Russian server makes an SQLite copy, encrypts it with `age` to a public
  key whose private key exists only on the owner's Mac, and copies it to Italy for disaster
  recovery.
- Still owed outside the code: notices to Roskomnadzor (personal data operator, cross-border
  transfer to Italy, a Convention 108 country) and a lawyer's view of the identification rule.

## Start screen

```
LastCall
[ Continue with Telegram ]            ← main
[ Restore account ]  → Through Telegram (number) | Through email
Other ways ▸
   Sign up with email (invitation may be needed)
   I have an invitation code
   No Telegram? Ask for access
```

Telegram screen: "Open Telegram" → "Waiting for your number…" → (register) name and @username →
done. Below: "Can't use Telegram?" → access request.

Access request: Name · How to reach you (optional) · Why you can't use Telegram → Send →
"Request sent. The answer will appear here." → approved → email sign-up with the code.

Settings → Account → Phone number: "+7 ••• ••• 12 · through Telegram" or "Link number through
Telegram". Settings → Privacy → Who can find me by my number. Contacts → Find friends from
contacts. Settings → Invitations → Requests (administrators).
