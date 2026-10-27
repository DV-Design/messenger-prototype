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
