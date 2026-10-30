# LastCall public preview

0.6.0/code9 adds encrypted text/file-name previews, authenticated notification
routing, managed Android lockscreen calls, voice/circles and fullscreen adaptive
video. Exact emulator evidence and limits are in the
[native report](../../docs/reports/debugging/2026-10/native-060.md). Physical
phones/carriers and iOS remain separate. Short preview
ciphertext may transit server/FCM with TTL<=60s by explicit user direction, without
plaintext or server DB chat storage. This changes the earlier generic-only push
boundary. `messagePreview` is a separate opt-in capability with default 0; old
receivers keep generic notifications. Native notification PUBLIC visibility and
cold-call lifetime/Telecom evidence are scoped to the emulator report. See
[SERVICES.md](SERVICES.md) and [wake contract](../../docs/WAKE-CONTRACT.md).

Voice/circles require a fresh native prebuild/APK for Expo audio/camera/video;
a JS-only export does not install those native modules. Explicit foreground capture
produces AAC/M4A voice <=120s or video <=30s targeting 480p/600 kbit/s, each <=5 MiB.
Media uses the existing encrypted seven-day sender file queue, including 16 retained
blobs / 40 MiB capacity. No server recorder, media endpoint or chat mailbox is added.
Test locked cold ringing >12s, explicit answer with inbound RTP >15s, cleanup/next
call, text/file notification tap routing and record/preview/cancel/retry on the final
0.6.0/code9 APK before publishing. Physical devices/APNs remain separate.

0.5.1/code7 adds bounded Android FCM background synchronization and bilateral
application-readiness protection before the first peer data. Both Android apps
must update in place. The sender-held encrypted text/file queue still waits up
to seven days; signed group copies synchronize between member devices. No server
content mailbox was added. Network recovery retains active PC/tracks within a
bounded 10s window, without guaranteeing uninterrupted audio.

FCM is active through a dedicated sender account with only the FCM administration
role; its private key remains outside Git/APK/static assets and is mounted read-only.
Authenticated signaling reports push=true and relay=true. On the project's Android
emulator, real FCM cold-started the final APK after ordinary process death without
tapping or opening its UI: text and a 35-byte file received durable ACK at 5728ms
in one direct-route run. Separate foreground takeover passed at 6786ms after one
transient session error recovered. An offline manual relaunch after force-stop
retained the profile and saved text/file entries; push after force-stop is not
claimed. Physical phones, locked screen and Russian operators remain unverified;
APNs remains unconfigured; Android managed calls have scoped emulator acceptance.

Public authenticated TURN is active and independently verified over UDP/TCP/TLS.
Keep the prior signaling image and versioned APK available for rollback.

Primary gateway: **https://lienad.ru/messenger**. The legacy
`https://p2p.lienad.ru` endpoint remains compatible. The apex gateway avoids the
reproduced negative DNS cache on some resolvers; it uses normal DNS and TLS.

## Layout

- `infra/compose.public.yaml`: isolated Node24 signaling/directory service on the
  existing external `proxy` Docker network, no published host ports.
- Native Homebrew coturn 4.18.0 is managed only by user LaunchAgent
  `dev.lastcall.turn`; The retired Docker `lastcall-coturn` container was removed on 2026-10-30. Router forwards
  3478 UDP/TCP, 5349 TCP and 49160–49200 UDP to the same ports on `192.168.1.26`.
  See the [native runbook](../native-turn/README.md); run exactly one relay backend.
- Named `directory` volume: SQLite public profiles, push tokens, recipient watch
  consent and service quotas after configuration. Legacy phone tables may remain
  from 0.3, but phone verification/discovery is no longer enabled in production.
  Public device keys and display names are profile data. Private identity seeds,
  OTP values, chat, group definitions, files and media never enter this database. Push metadata and any legacy phone hashes are personal data.
- `messenger-apex.caddy.inc`: narrow /messenger route fragment in the existing
  apex Caddy site. Preserve all other routes. Strip prefix before upstream.
- `p2p.lienad.ru.caddy`: legacy hostname routing, including /directory.
- Static files live in the dedicated LastCall public directory managed by the
  existing proxy; private credentials must never be copied there.
- Versioned Android APKs in `download/`; diagnostic probe in `diagnostics/`;
  index.html and tasks.txt at root. Build probe with relative asset paths.

Caddy imports `proxy/sites/*.caddy` read-only. Copy the route fragment inside
`lienad.ru.caddy` before its fallback handle; it is not a standalone site. Validate
before a graceful reload; do not restart shared services. Keep the previous APK
for rollback. Publish APKs atomically after signature/metadata verification.

```sh
docker compose --env-file infra/.env.public-services --env-file infra/.env.public-turn -p messenger-public -f infra/compose.public.yaml -f infra/public/compose.firebase.example.yaml config --quiet
docker build -f infra/Dockerfile.server -t messenger-signaling:preview .
docker compose --env-file infra/.env.public-services --env-file infra/.env.public-turn -p messenger-public -f infra/compose.public.yaml -f infra/public/compose.firebase.example.yaml up -d --no-deps signaling
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
STUN providers: Google/Cloudflare (observe discovery IP metadata). Direct ICE is
preferred; authenticated TURN supplies UDP/TCP/TLS fallback with 600-second
credentials issued only after signed directory authentication. Anonymous HTTP
`GET /ice` intentionally stays STUN-only (`REQUIRE_ICE_AUTH=1`).
Standard WebRTC is recognizable; this build does not promise DPI evasion.

The directory contains searchable public usernames, keys and display names.
Presence is ephemeral and restricted to explicit authenticated subscriptions.
Content uses direct WebRTC where possible; TURN forwards encrypted packets on
the fallback route, with bandwidth/traffic metadata cost and no chat archive.
Pending text and files stay in the sender-local encrypted queue. One live
directory connection per device identity. Android 0.5.1 has the bounded background
FCM path above; iOS/APNs remains unconfigured, while managed Android calls
have scoped emulator acceptance in 0.6.0. No audited ratchet, key transparency or multi-device
identity yet. Server updates briefly disconnect preview sessions. In 0.4,
registration uses a unique username bound to the installation key and a persistent
server profile. No SMS account is required. FCM carries no plaintext chat, filename, SDP or private identity key. The 0.6.0
preview path may transiently carry authenticated ciphertext and visible identity/
intent headers; the published 0.5.1 path remains generic. Signaling forwards opaque encrypted
SDP/candidate envelopes; private installation seeds stay on their devices.

## Rollback

To roll back code, rebuild the previous Git revision and retain the same named
volume. Do not delete the volume merely to restart the service. To unpublish,
remove only the added apex /messenger fragment and legacy p2p site, validate/reload
Caddy, then stop only `messenger-public` compose (without `-v`). Preserve other
apex/share/api routes, Docker networks and existing applications.

The idempotent `create-dns.py` helper is retained for the exact p2p CNAME only.
Credentials stay local; it never invokes the host DDNS notification helper.

Optional FCM and authenticated ICE configuration is documented in
[SERVICES.md](SERVICES.md). The base compose file alone disables providers; the
active deployment explicitly selects the Firebase override and both env files
as shown above. Keep services env first and TURN env last; the blank TURN fields
in the services example must not disable the active relay. Preserve this exact
selection on recreation and never print resolved Compose configuration. Public `GET /ice` cannot issue
TURN credentials when `REQUIRE_ICE_AUTH=1`.

External evidence: [GitHub Actions run 40782070981](https://github.com/DV-Design/messenger-prototype/actions/runs/40782070981)
at commit `5088fce`, 2026-10-28 22:43–22:44 UTC, passed all three forced-relay
transports from an independent Azure IPv4 runner: bidirectional text ACK, exact
30 KB file bytes, increasing inbound audio RTP bytes on both peers, and track
cleanup. The private run is owner-accessible. An additional local verifier used
actual server-issued 600-second credentials and passed 3/3 transports.
[Review and evidence](../../docs/reports/code-reviews/2026-10/CR-2026-10-28-native-turn.md).
No long-term TURN secret left the host; six 15-minute test credentials were held
only in an encrypted temporary Actions secret, deleted after the job. This
proves the external relay path, not every operator, DPI bypass or continuous
call handover. Certificate/public-IP automation remains follow-up `msg-0aa`.
