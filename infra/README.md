# Local signaling and TURN laboratory

Use Node 22.14+ and run `npm ci` at repository root. Run `npm run dev:server`
for a loopback listener on `127.0.0.1:8787`. `/health` reports process health;
`/ice` returns an empty list unless infrastructure was explicitly configured.
`STUN_URLS` is an optional comma-separated list; no public STUN service is implicit.
`TURN_URLS` and `TURN_SHARED_SECRET` must be set together. Credentials use the
coturn REST HMAC-SHA1 format and expire after 600 seconds (configurable 60–3600).
The shared secret never leaves the server; `/ice` returns short-lived credentials.

`HOST=0.0.0.0` explicitly enables LAN listening for a physical phone. Set
`ALLOWED_ORIGINS` to exact browser origins; native clients with no Origin are
permitted. This is an origin check, not authentication. Room access depends on a
random invitation; the server sees only its hash and sealed signaling. It retains
no messages or files. An unauthenticated `/ice` is suitable for this laboratory;
public deployment needs authenticated provisioning, quotas, HTTPS/WSS and abuse
controls. Do not expose this prototype as a public TURN credential dispenser.

The application bounds rooms (64), peers (128, 8 per IP), frames (96 KiB), socket
buffer (256 KiB), frame rate (120 / 10 seconds), bytes (512 KiB / 10 seconds), and
HTTP/upgrade requests (120 / IP / 10 seconds). IP buckets expire and are capped at
1024 entries. Reverse-proxy forwarded IP headers are deliberately not trusted;
all clients behind a proxy share the proxy limit. Idle unjoined sockets expire;
joined sockets must answer heartbeat pings. No payloads, invitations or room IDs
are logged. Changing rooms requires a leave first. Rooms contain at most 2 peers.
There is no mailbox, user directory, persistent identity or offline queue.

## Docker

From repository root, copy `infra/.env.example` to `infra/.env`, then:

```sh
docker compose --env-file infra/.env -f infra/compose.yaml up --build
```

Both signaling and TURN host mappings bind loopback by default. To add TURN,
generate a secret with `openssl rand -hex 32`, set `TURN_SHARED_SECRET` and
`TURN_URLS=turn:127.0.0.1:3478?transport=udp` in `infra/.env`, then run:

```sh
docker compose --env-file infra/.env -f infra/compose.yaml --profile turn up --build
```

For the same-machine two-browser relay test, set `TURN_ALLOW_LOOPBACK=true` to
allow local candidates through coturn. This must remain a local laboratory:
loopback peers and public TURN exposure together allow access to local services.
Docker Desktop NAT may require a reachable host/LAN `TURN_EXTERNAL_IP`, matching
`TURN_URLS`, and explicit relay-port forwarding. For physical devices use your
machine's LAN address, explicitly change host port mappings from `127.0.0.1` to
the chosen LAN interface, and allow UDP 3478 plus 49160–49200 in its firewall.
Do not assume publishing port 3478 alone makes relayed media reachable.

The local coturn recipe intentionally has no TLS certificates and no TURN/TCP
relay endpoints. This does not test DPI resistance or TCP-only mobile networks.
A remote deployment needs a reachable external IP and TLS provisioning before
advertising `turns:` URLs; TURN relay paths carry end-to-end encrypted WebRTC
media, but relay operation itself remains visible. HMAC credentials are valid
until expiry and cannot be individually revoked with this simple REST setup.

Stop with `docker compose --env-file infra/.env -f infra/compose.yaml --profile turn down`.
No volumes retain signaling or TURN messages. Keep `infra/.env` private.

The upstream coturn image marks its executable with the NET_BIND_SERVICE file
capability. Compose drops other capabilities but retains this one in its bounding
set; dropping every capability prevents Linux from executing turnserver (EPERM),
even though the laboratory listener uses an unprivileged port. No other Linux
capabilities or privileged container mode are needed.
