# Signaling and authenticated directory server

Run on Node 24. `createSignalingServer()` is importable without binding a port;
`src/main.ts` is the CLI. `npm run build -w @messenger/server` produces a bundled
Node entrypoint; core source is bundled and `ws` remains an external dependency.

The listener defaults to `127.0.0.1:8787`. GET `/health` and `/ice`, WS `/signal`
and WS `/directory` share its origin, socket, frame, byte and rate bounds. The
reverse proxy may strip `/messenger` from the public URL before forwarding.
Forwarded IP headers are deliberately ignored. Native clients without Origin
are allowed; browser Origins must match `ALLOWED_ORIGINS` exactly.

`/signal` retains private rooms with at most two peers each; it forwards opaque,
sealed signaling and never stores messages or files. Those rooms do not constrain
the total number of directory users or simultaneous independent conversations.

`/directory` issues a random single-use 15-second challenge. Ed25519 authentication
binds the challenge, public key, username and display name using core helpers.
User IDs derive from public keys. Usernames are globally unique in the directory.
Only authenticated clients may search/lookup, replace their explicit presence
watch set (maximum 200 IDs), or request a connection to an online user. Connection
notifications obtain sender identity from the authenticated socket; caller-supplied
sender fields and all chat/file/media frames are rejected. Only one directory
socket owns an identity; replacing it cannot let stale callbacks mark it offline.

SQLite stores public key, stable ID, username, display name and lastSeen only.
Presence, watch sets, challenges, content and private keys are never stored.
`DIRECTORY_DB_PATH` selects the database; an unset value uses `:memory:` for
isolated development/tests. A deployment must set a persistent path and mount its
parent directory, including SQLite WAL/SHM sidecars. Graceful shutdown persists
lastSeen; reopening a database always starts with all users offline. During an
unclean crash, lastSeen reflects the last persisted observation. Operate one server
process per directory; live socket ownership is local to that process.

Explicit capacity settings:

| Environment variable | Default |
| --- | ---: |
| `MAX_CONNECTIONS` | 128 |
| `MAX_CONNECTIONS_PER_IP` | 8 |
| `MAX_ROOMS` | 64 |
| `DIRECTORY_MAX_USERS` | 10000 |
| `REQUEST_LIMIT` | 120 |
| `RATE_WINDOW_MS` | 10000 |

A reverse proxy may combine clients under one source IP: raise its bounded
connection/request settings explicitly instead of trusting arbitrary forwarded
headers. Limits count both directory and signaling sockets. Directory frames have
a 16 KiB limit; signaling has 96 KiB, and outgoing socket buffers remain bounded.
Unknown or malformed directory frames close the socket. Heartbeat pings remove
unreachable peers; unauthenticated sockets cannot remain open indefinitely.

TURN configuration retains short-lived REST credentials via `TURN_URLS` and
`TURN_SHARED_SECRET`; `STUN_URLS` is optional and no public service is implicit.
No frame payloads, rooms, identity seeds or authentication credentials are logged.
Storage errors use generic messages without profile values or database paths.

## Optional verified-phone, push and authenticated ICE services

New directory services are opt-in requests. Existing clients receive the same
`ready` shape and no unsolicited new frames. `services` reports four facts:
configured SMS verification adapter, configured push adapter, configured relay,
and whether the requesting identity has actually completed phone verification.
Missing credentials leave the respective capability false and requests return
`service-unavailable`; neither verification nor provider success is simulated.

- `SMSRU_API_ID` plus random `PHONE_VERIFICATION_SECRET` (at least 32 UTF-8 bytes)
  enables the SMS.ru TLS POST adapter. OTPs are random six digits; only an HMAC
  bound to identity/challenge/phone hash stays in memory. Lifetime is five minutes,
  five wrong attempts invalidate it, and a new accepted challenge invalidates an
  older challenge for that identity. The server returns a challenge only after
  SMS.ru accepts the intended recipient. Provider rejection, timeout or an
  already-expired response does not verify a phone or return a usable challenge.
- SMS reservations survive reconnect/restart in SQLite: >=60 seconds between
  attempts per identity **and** phone hash; hourly defaults 5 per identity, 3 per
  phone, 60 globally. `SMS_IDENTITY_MAX_PER_HOUR`, `SMS_PHONE_MAX_PER_HOUR` and
  `SMS_MAX_PER_HOUR` deliberately configure these spend caps. Failed provider
  attempts conservatively consume reservations because acceptance may be unknown.
- Only verified hashes and verification time enter the phone table. A phone
  already bound to another identity cannot be silently reassigned. Discovery
  requires the querying identity's own completed verification, accepts at most
  100 exact hashes per batch, and allows 120 requests / 10000 hashes per hour.
  The mobile client should cache unchanged books rather than repeatedly upload
  hashes. These enumerable hashes are personal metadata, not anonymous discovery.
- `GOOGLE_APPLICATION_CREDENTIALS` points to a private read-only Firebase Admin
  service-account JSON. Missing/invalid files leave push disabled. The maintained
  `firebase-admin` SDK sends only a generic LastCall notification and wake kind;
  no sender, chat text, filenames, SDP or contact names enter FCM. Android channel
  is `lastcall-messages`. Provider acceptance is never a message delivery ACK.
- Each authenticated identity owns one FCM token; another identity cannot claim
  a currently bound token. Tokens are never in public user/search/service frames.
  Recipient watch sets persist as a bounded wake allow-list. Merely searching for
  or adding a recipient does not grant the sender notification permission: the
  recipient must have sent its own authenticated watch containing that sender.
- Wake intents are collapsed per recipient for 30 seconds, including while its
  directory socket appears online but the OS has suspended execution. Hourly
  quotas are 120 attempts per sender and 1000 globally. No content mailbox is
  added: the notification invites reopening; ordinary P2P then delivers the
  sender-local pending text. Both devices still need availability for content.
- Providers have timeouts and bounded concurrency (4 SMS / 8 push). A timed-out
  underlying request retains its slot until it settles; abandoned work cannot
  grow without bound. Shutdown is bounded even for an injected/hung provider.

Set **`REQUIRE_ICE_AUTH=1` on a public deployment**. GET `/ice` then returns only
explicitly configured STUN entries, and only authenticated directory `ice`
requests can obtain expiring TURN credentials, bounded to 60 requests per identity
and 1000 globally per hour. Default laboratory behavior remains compatible with
legacy standalone PeerSession. Provisioning a TURN URL/credential does not prove
that a carrier/firewall path works; validate a forced-relay path separately.

Private tests inject `SMSProvider` / `PushProvider` and a clock; there is no public
mock mode, OTP lookup, fixed production code, SMS.ru `test=1` switch, or fake
verified identity. Production secrets belong only in server environment/read-only
secret files, never in the APK, repository, URLs or logs. Real accounts, Android
Firebase client setup, user permission and a physical-device check remain required
before claiming actual SMS/push delivery; iOS also needs APNs/signing setup.

Adapter references: [SMS.ru HTTP API](https://sms.ru/api/send),
[Firebase Admin setup](https://firebase.google.com/docs/admin/setup),
[FCM Admin messaging](https://firebase.google.com/docs/cloud-messaging/send/admin-sdk).
