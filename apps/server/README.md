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
User IDs derive from public keys. Usernames are globally unique and immutable per
installation key. Reconnecting with another username fails with
`device-already-registered`; a stale signed display name never replaces the
canonical persisted profile. Existing databases keep their current bindings.
Only authenticated clients may search/lookup/list, replace their explicit presence
watch set (maximum 200 IDs), or request a connection to an online user. Connection
notifications obtain sender identity from the authenticated socket; caller-supplied
sender fields and all chat/file/media frames are rejected. Only one directory
socket owns an identity; replacing it cannot let stale callbacks mark it offline.

SQLite stores public profiles and the service metadata described below. Live
presence, ephemeral watch sets, challenges, content and private keys are not stored.
A database trigger rejects username changes. `resolve-profile` uses a separate,
purpose-bound Ed25519 signature over a consumed one-time challenge and returns
only that key's own profile (or null). It neither registers a user nor changes
presence, and closes its short-lived socket afterward.

Authenticated `list-users` returns at most 100 profiles ordered by unique username;
fetching 101 rows derives an optional keyset cursor without offsets. Search accepts
at most 48 characters, matches a login prefix or name substring, and uses Unicode
NFKC plus lowercase for Russian and compatibility characters. SQL LIKE wildcards
are escaped as literals and parameters remain bound. Offline profiles are included.
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

## Push and authenticated ICE services

The public configuration permanently disables phone registration/discovery.
`SMSRU_API_ID`, `PHONE_VERIFICATION_SECRET` and old SMS quota variables are ignored;
no production SMS provider is initialized. Public `services` always reports
`phoneVerification=false` and `phoneVerified=false`, including identities with old
verified-phone rows. Phone RPCs return `service-unavailable`. Existing stored
metadata is retained without exposing phone hashes or wiping user data.

Existing clients receive the same `ready` shape and no unsolicited new frames.
`services` independently reports configured push and TURN relay capabilities.

- `GOOGLE_APPLICATION_CREDENTIALS` points to a private read-only Firebase Admin
  service-account JSON. Missing/invalid files leave push disabled. The maintained
  `firebase-admin` SDK sends only a generic LastCall notification and wake kind;
  no sender, chat text, filenames, SDP or contact names enter FCM. Typed payloads
  add only `intentKind`, `intentId`, `expiresAt` strings to existing
  `kind=lastcall-wake`, with remaining-lifetime Android TTL. Generic call copy says
  a call is waiting; it does not claim system incoming-call integration. Calls use
  a separate collapse tag from data alerts. Android channel
  is `lastcall-messages`. Provider acceptance is never a message delivery ACK.
- Each authenticated identity owns one FCM token; another identity cannot claim
  a currently bound token. Tokens are never in public user/search/service frames.
  Recipient watch sets persist as a bounded wake allow-list. Merely searching for
  or adding a recipient does not grant the sender notification permission: the
  recipient must have sent its own authenticated watch containing that sender.
- Legacy `{type:'wake',to}` stays compatible. Typed wake adds an all-or-none
  `kind` (`message`/`file`/`call`), random 32-hex `intentId` and positive safe-integer
  `expiresAt` in milliseconds. Partial fields or content payloads are rejected.
  Expired intents return a generic `wake-expired`; future deadlines are clamped
  to server time plus 60 seconds for data or 30 seconds for calls and rechecked
  immediately before provider invocation. The server holds no delayed send queue.
- A bounded memory map (maximum 4096 sender/recipient/intent IDs) suppresses repeats
  until deadline expiry, including retries after provider failure. It stores no
  content and is cleared on shutdown. Existing SQLite recipient cooldowns persist;
  calls use a separate 30-second cooldown so a data alert does not hide a call.
  Message/file/legacy alerts share one 30-second recipient cooldown, including while
  its directory socket appears online but the OS has suspended execution. Hourly
  quotas are 120 attempts per sender and 1000 globally. No content mailbox is
  added: the notification invites reopening; ordinary P2P then delivers the
  sender-local pending text. Both devices still need availability for content.
- Providers have timeouts and bounded concurrency (8 push). A timed-out
  underlying request retains its slot until it settles; abandoned work cannot
  grow without bound. Shutdown is bounded even for an injected/hung provider.

Set **`REQUIRE_ICE_AUTH=1` on a public deployment**. GET `/ice` then returns only
explicitly configured STUN entries, and only authenticated directory `ice`
requests can obtain expiring TURN credentials, bounded to 60 requests per identity
and 1000 globally per hour. Default laboratory behavior remains compatible with
legacy standalone PeerSession. Provisioning a TURN URL/credential does not prove
that a carrier/firewall path works; validate a forced-relay path separately.

Private regression tests may explicitly inject `enableLegacyPhoneServices`,
`SMSProvider` and a clock to retain isolated OTP coverage. There is no environment
switch or public route that enables those tests, no OTP lookup and no simulated
production success. Normal factory use defaults to phone features disabled even
if a provider is injected. Secrets belong only in the server environment/read-only
secret files, never in the APK, repository, URLs or logs. Android Firebase client
setup, notification permission and a physical-device check remain required before
claiming real closed-app push delivery; iOS also needs APNs/signing setup.

Adapter references: [Firebase Admin setup](https://firebase.google.com/docs/admin/setup),
[FCM Admin messaging](https://firebase.google.com/docs/cloud-messaging/send/admin-sdk).
