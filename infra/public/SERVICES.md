# Optional FCM and authenticated ICE configuration

## LastCall 0.5 setup checkpoint (2026-10-28)

Created Firebase project `lastcall-f8b4c` (LastCall), Spark/no-cost plan, without
Google Analytics. Registered Android package `dev.messenger.prototype`, nickname
LastCall Android. Downloaded and validated its client file, stored outside Git at
`/Users/daniel/.config/lastcall/google-services.json` (0600 in a 0700 directory).
The 0.5 native prebuild and JS/native release build use
`MESSENGER_GOOGLE_SERVICES_FILE` with this path. No Admin key enters the APK.

Prepared (not submitted) the dedicated service account `lastcall-push`. Issuing
its persistent JSON key and granting the FCM API role await the user's explicit
confirmation required by browser controls. The server remains genuinely disabled
until this is approved, provisioned, mounted and checked with an actual device.
The broader default Firebase Admin SDK service-account key has not been issued.

After confirmation use only `roles/firebasecloudmessaging.admin` on this project,
not Owner/Editor. It grants FCM send/topic resources, not app chat content:
[official role permissions](https://docs.cloud.google.com/iam/docs/roles-permissions/firebasecloudmessaging).
Store the downloaded JSON outside Git/static assets/APK, then use the explicit
override below. Validate actual content-free notification arrival in background,
tap/resume, recipient reconnection and real durable message ACK independently.
Do not equate valid credential parsing or provider acceptance with delivery.
APNs/PushKit/CallKit and iOS signing remain unconfigured.

Registration in 0.4 uses a unique username and a device installation key. No phone
number, SMS.ru account or Firebase configuration is needed to register and search
the server directory. Production ignores legacy SMS environment settings; old
phone endpoints remain unavailable for older clients.

The public preview currently has authenticated TURN enabled and FCM disabled.
The base compose file without the private TURN env still disables both; merely
building an SDK into the image does not configure a provider. Existing directory
data remains in its named volume. Keep the active env selection on recreation.

`compose.public.yaml` sets `REQUIRE_ICE_AUTH=1`. Public GET `/ice` remains STUN-only;
TURN REST credentials, if TURN is explicitly configured, are returned only by an
authenticated directory `ice` request with identity quotas. Do not disable this
flag to work around a legacy client. Standalone local `compose.yaml` keeps its
laboratory behavior.

## Disabled base and active deployment

The public file requires no environment file or private JSON mount:

```sh
docker compose -p messenger-public -f infra/compose.public.yaml config --quiet
docker build -f infra/Dockerfile.server -t messenger-signaling:preview .
```

The user authorized publication. The current deployment explicitly selects the
existing ignored TURN env and recreates only the LastCall signaling service:

```sh
docker compose --env-file infra/.env.public-turn -p messenger-public -f infra/compose.public.yaml config --quiet
docker compose --env-file infra/.env.public-turn -p messenger-public -f infra/compose.public.yaml up -d --no-deps signaling
```

Do not print resolved Compose configuration: it contains the shared TURN secret.
Omitting this env file on recreation would disable the working relay fallback.
Build uses a
locked builder install and a separate `npm ci --omit=dev` production dependency
stage. The final image includes `firebase-admin`'s external runtime imports and
transitive packages, runs as the Node image's `node` UID, and uses the compose
read-only root filesystem plus writable `/data` directory volume. No host ports,
additional privileges or changes to shared proxy services are needed.

## Firebase Cloud Messaging

Copy `infra/public/services.env.example` to ignored `infra/.env.public-services`.
Use a separate server service-account JSON, stored outside the repository and
readable by the container's Node UID. Set its absolute host path in
`FIREBASE_ADMIN_CREDENTIALS_FILE` in the ignored env file. Explicitly select the
optional override; the unconfigured default never references a missing file:

```sh
docker compose --env-file infra/.env.public-services --env-file infra/.env.public-turn -p messenger-public -f infra/compose.public.yaml -f infra/public/compose.firebase.example.yaml config --quiet
```

This is a future FCM recipe, not the current deployment. Keep the TURN env
**last**: the services example contains blank TURN values and must not overwrite
the active relay settings. Use the identical file order for the later authorized
`up -d --no-deps signaling` command after FCM credentials are approved.

The override bind-mounts the file read-only at `/run/secrets/firebase-admin.json`;
`create_host_path: false` prevents accidentally creating a directory for a mistyped
path. It sets `GOOGLE_APPLICATION_CREDENTIALS` only inside the signaling container.
Never copy the admin JSON into the image, static download folder or Android app.
The mobile Firebase client configuration is a separate artifact managed by the
mobile build. Invalid/missing/unreadable account JSON leaves push capability
false; valid credentials still require an external provider/device delivery check.

A wake intent contains no chat payload. The target must have watched the sender;
server consent and quotas apply. Provider acceptance is not recipient ACK and does
not guarantee that the OS opens a suspended app. After reopening, both peers still
need an available direct or authenticated encrypted relay connection to transfer
the sender-local pending message.

## TURN

Public TURN is active through native Homebrew coturn 4.18.0 and user LaunchAgent
`dev.lastcall.turn`; Docker `lastcall-coturn` is stopped. The user forwarded
3478 UDP/TCP, 5349 TCP and 49160–49200 UDP to the same ports on `192.168.1.26`.
Use the [native runbook](../native-turn/README.md); exactly one backend may own
those ports. The host-to-Docker UDP path failed locally; native mode removes
that NAT hop. No unrelated proxy, host VPN or application service was changed.

Each public hostname transport (UDP/TCP/TLS) passed forced-relay text ACK in
both directions, exact 30 KB file bytes, increasing received audio RTP bytes on
both peers and track cleanup. An independent external Azure IPv4 runner passed
3/3 transports in [run 40782070981](https://github.com/DV-Design/messenger-prototype/actions/runs/40782070981).
Actual production-issued 600-second credentials passed another 3/3 verification.
[Review/evidence](../../docs/reports/code-reviews/2026-10/CR-2026-10-28-native-turn.md).
These checks do not guarantee all Russian operators or DPI evasion.

`TURN_URLS` and `TURN_SHARED_SECRET` are set together in `infra/.env.public-turn`.
TTL is 600 seconds; authenticated services report relay=true, push=false and
phone features=false. Anonymous GET `/ice` remains STUN-only. Catalog/push never
receive chat content; TURN forwards encrypted packets without a chat archive,
with real server bandwidth and traffic metadata costs. Restart both 0.5 clients
to refresh ICE; the APK itself is unchanged. Certificate/public-IP automation
(`msg-0aa`) and physical Russian-operator tests (`msg-9rr`) remain open.

## Deployment and rollback

For a configured deployment, use the same explicit `--env-file` and `-f` selection
on the authorized `up -d` command; otherwise optional services stay disabled.
The active deployment uses the base compose file plus `infra/.env.public-turn`.
Reverting to only the base compose file and blank provider env deliberately
disables adapters on next preview-container recreation. Keep the named directory volume for stable users
and verification metadata. Active sockets and in-memory OTP challenges end when
the preview process restarts. Do not restart unrelated containers or delete the
shared proxy network.
