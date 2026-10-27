# Public foreground preview: p2p.lienad.ru

This deployment publishes HTTPS/WSS signaling and a static browser/download page.
It is a foreground technical preview, not a production messaging service. There is
no account directory, mailbox, push delivery, durable history or audited ratchet.
The signaling process cannot decrypt PSK-sealed signaling and does not store chat,
files or media. Direct WebRTC peers still disclose IP addresses to each other.

## Layout and existing infrastructure

Repository sources:

- `infra/compose.public.yaml`: one isolated `messenger-signaling` container, existing
  external Docker network `proxy`, no published host ports.
- `infra/public/p2p.lienad.ru.caddy`: new hostname only, WebSocket/HTTP reverse proxy
  plus static files. Caddy manages its public TLS certificate.
- `infra/public/index.html`: fallback landing page until the browser build is copied.
- `infra/public/create-dns.py`: idempotently creates exactly the authorized DNS-only
  CNAME `p2p.lienad.ru -> lienad.ru`, TTL 300; refuses conflicting existing records.
- `infra/public/verify-deployment.ts`: real two-client WSS signaling smoke check.

Host deployment copies, outside this repository:

- `/Users/daniel/server/proxy/sites/p2p.lienad.ru.caddy`
- `/Users/daniel/server/proxy/sites/messenger-public/` (browser static assets)
- `/Users/daniel/server/proxy/sites/messenger-public/download/messenger-preview.apk`

Existing Caddy mounts `proxy/sites` read-only at `/etc/caddy/sites` and imports its
`*.caddy` files. The existing SNI router routes this hostname to Caddy. The preview
creates no new router listener and does not restart existing services.

## Deploy or update

From the repository root, using the existing Docker daemon:

```sh
# Credentials stay local; the script never invokes the DDNS notification helper.
# Supply CF_TOKEN/CF_ZONE in the process environment, or explicitly read a private
# environment file/LaunchAgent. No credential values are printed.
python3 infra/public/create-dns.py
# Existing host alternative:
# python3 infra/public/create-dns.py --env-plist /Users/daniel/Library/LaunchAgents/ru.lienad.ddns.plist

docker compose -p messenger-public -f infra/compose.public.yaml config --quiet
docker compose -p messenger-public -f infra/compose.public.yaml up -d --build
mkdir -p /Users/daniel/server/proxy/sites/messenger-public/download
cp infra/public/p2p.lienad.ru.caddy /Users/daniel/server/proxy/sites/p2p.lienad.ru.caddy
cp infra/public/index.html /Users/daniel/server/proxy/sites/messenger-public/index.html
# Validate before a graceful reload; never restart the shared Caddy container.
docker exec caddy caddy validate --config /etc/caddy/Caddyfile
docker exec caddy caddy reload --config /etc/caddy/Caddyfile
```

Build the browser client with a same-origin/public signaling URL before copying
`apps/probe/dist/` into `messenger-public/`. Copy assets without deleting `download/`.
The browser build is a diagnostic client, not a substitute for a native app. Publish
an actual verified Android APK at the download path above; do not publish an empty
placeholder. Caddy sends the APK attachment MIME type and disables caching for it.

The service permits exactly the browser origin `https://p2p.lienad.ru`; native clients
without an Origin are also permitted by the current protocol. An origin check is not
user authentication. `/ice` and `/health` use `Cache-Control: no-store`.

## ICE and connection limitations

The deployment explicitly advertises the public STUN services operated by Google
(`stun.l.google.com:19302`) and Cloudflare (`stun.cloudflare.com:3478`). Discovery
shares public IP addresses and timing metadata with these providers. STUN is not
an encrypted-media relay and does not guarantee a direct connection through CGNAT.

No TURN URLs or secret are configured. `/ice` issues no TURN credentials. Relay-only
mode therefore fails explicitly. Calls/files may fail across restrictive NATs,
UDP blocking or mobile networks until reachable TURN infrastructure is provisioned
and verified. This preview does not claim DPI evasion or availability in every
Russian network. A valid WSS connection alone does not prove media connectivity.

Current server peer/rate limits are intentionally unchanged. Because forwarded IP
headers are not trusted, all clients behind Caddy share its upstream IP bucket:
at most eight active peers (approximately four pairs) and shared request limits.
This protects a small preview; production capacity needs deliberate authenticated
quotas and trusted proxy handling rather than blindly trusting X-Forwarded-For.

## Verification

```sh
dig +short p2p.lienad.ru @1.1.1.1
dig +short p2p.lienad.ru @8.8.8.8
curl --fail-with-body -sS -D - https://p2p.lienad.ru/health
curl --fail-with-body -sS -D - https://p2p.lienad.ru/ice
node --import tsx infra/public/verify-deployment.ts
docker inspect messenger-signaling --format '{{.State.Status}} {{.State.Health.Status}}'
```

If this machine cached the previously nonexistent hostname, wait for negative DNS
cache expiry. For immediate origin verification, `curl --resolve` and optional
`PUBLIC_RESOLVED_IP` in the WSS smoke script can use the independently resolved A
address. These overrides preserve certificate/SNI validation and do not establish
that every resolver has refreshed. Never use `curl -k` to declare TLS successful.

Recorded first deployment, 2026-10-27: authoritative/public recursive CNAME resolution
returned `lienad.ru -> 178.222.108.208`; Let's Encrypt issued a certificate; public-IP
HTTPS `/health` and `/ice` returned 200 with TLS validation; real WSS two-peer join,
PSK-encrypted exchange and disconnect-presence check passed. The host's OS resolver
initially retained NXDOMAIN, so those first HTTPS/WSS checks used the resolved-IP
override. Browser media and Android download validation are separate milestones.

## Rollback and operations

To unpublish only this preview, remove its Caddy deployment file, validate and
gracefully reload Caddy, then stop its compose project:

```sh
rm /Users/daniel/server/proxy/sites/p2p.lienad.ru.caddy
docker exec caddy caddy validate --config /etc/caddy/Caddyfile
docker exec caddy caddy reload --config /etc/caddy/Caddyfile
docker compose -p messenger-public -f infra/compose.public.yaml down
```

Optionally remove only the `p2p` DNS record in Cloudflare and archive/delete the
preview static folder. Do not edit the apex record, existing Caddy sites, or proxy
network. Signaling updates restart only the preview container and disconnect its
active sessions. Caddy config reload is graceful. Check container status/health;
never log invitations, frame contents or credentials during troubleshooting.
