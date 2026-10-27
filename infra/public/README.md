# LastCall public preview

Primary gateway: **https://lienad.ru/messenger**. The legacy
`https://p2p.lienad.ru` endpoint remains compatible. The apex gateway avoids the
reproduced negative DNS cache on some resolvers; it uses normal DNS and TLS.

## Layout

- `infra/compose.public.yaml`: isolated Node24 signaling/directory service on the
  existing external `proxy` Docker network, no published host ports.
- Named `directory` volume: SQLite public profiles only. Device keys, chat,
  group definitions, files and media never enter this database.
- `messenger-apex.caddy.inc`: narrow /messenger route fragment in the existing
  apex Caddy site. Preserve all other routes. Strip prefix before upstream.
- `p2p.lienad.ru.caddy`: legacy hostname routing, including /directory.
- Static root: `/Users/daniel/server/proxy/sites/messenger-public`.
- Versioned Android APKs in `download/`; diagnostic probe in `diagnostics/`;
  index.html and tasks.txt at root. Build probe with relative asset paths.

Caddy imports `proxy/sites/*.caddy` read-only. Copy the route fragment inside
`lienad.ru.caddy` before its fallback handle; it is not a standalone site. Validate
before a graceful reload; do not restart shared services. Keep the previous APK
for rollback. Publish APKs atomically after signature/metadata verification.

```sh
docker compose -p messenger-public -f infra/compose.public.yaml config --quiet
docker compose -p messenger-public -f infra/compose.public.yaml up -d --build
docker exec caddy caddy validate --config /etc/caddy/Caddyfile
docker exec caddy caddy reload --config /etc/caddy/Caddyfile
curl --fail-with-body https://lienad.ru/messenger/health
curl --fail-with-body https://lienad.ru/messenger/ice
node --import tsx infra/public/verify-deployment.ts
node --import tsx infra/public/verify-directory.ts
docker inspect messenger-signaling --format '{{.State.Status}} {{.State.Health.Status}}'
```

Do not use resolved-IP overrides as evidence that client DNS works. The primary
checks above must succeed through the OS resolver and certificate validation.
The original apex application must still return its original content.

## Capacity and transport

Preview limits: 256 total and per-proxy-IP WebSockets, 256 transport rooms, 10,000
profiles, 1,200 HTTP/upgrades per proxy-IP/minute. A user has a directory socket
and independent signal sockets for active peer pairs. The two-peer limit belongs
to each private pair transport, not the global directory. Forwarded client IP
headers are deliberately not trusted. Authenticated directory frames are bounded
and rate limited; this is preview capacity, not a scaling claim.

Browser origins: https://lienad.ru and https://p2p.lienad.ru. Native requests without
Origin remain accepted; directory identity uses signed one-use challenges.
STUN providers: Google/Cloudflare (observe discovery IP metadata). No public TURN
is currently configured. Restrictive NAT/UDP filtering can prevent direct media.
Standard WebRTC is recognizable; this build does not promise DPI evasion.

The directory contains searchable public usernames, keys and display names.
Presence is ephemeral and restricted to explicit authenticated subscriptions.
Content is direct WebRTC; pending text is queued locally on the sender. One live
directory connection per device identity. iOS/Android background delivery requires
future push/system-call work. No audited ratchet, key transparency or multi-device
identity yet. Server updates briefly disconnect preview sessions.

## Rollback

To roll back code, rebuild the previous Git revision and retain the same named
volume. Do not delete the volume merely to restart the service. To unpublish,
remove only the added apex /messenger fragment and legacy p2p site, validate/reload
Caddy, then stop only `messenger-public` compose (without `-v`). Preserve other
apex/share/api routes, Docker networks and existing applications.

The idempotent `create-dns.py` helper is retained for the exact p2p CNAME only.
Credentials stay local; it never invokes the host DDNS notification helper.
