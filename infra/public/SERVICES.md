# Optional FCM and authenticated ICE configuration

## 0.6.0/code9

Android0.6 adds encrypted previews, authenticated notification routes, managed
Telecom calls, voice/circles and fullscreen adaptive video. See the
[native acceptance report](../../docs/reports/debugging/2026-10/native-060.md)
for exact emulator evidence and remaining physical-phone/iOS requirements.
User direction now permits an opaque authenticated encrypted preview through server/FCM. Plaintext is
never exposed; FCM may transiently retain ciphertext for TTL<=60s, so this is not
the old content-free transport claim. Full chat data remains sender-held/P2P with
recipient persistence before ACK; no server DB mailbox is introduced.

The separate `messagePreview` token capability defaults to 0 and requires updated
native preparation plus background-task support. Old 0.5.1 tokens keep generic
notifications. Encrypted text is bounded 800 UTF-8 bytes (earlier for escaping),
envelope 3000 bytes, full FCM data 4096 bytes. Visible headers bind sender/recipient,
intent/type and expiry; never log envelopes or decrypted previews. Existing
contact pins/membership validate client decryption. No preview produces chat ACK.

The private Firebase sender key/role and Compose selection below do not change.
Managed Android calls require a user-enabled LastCall phone account and the
requested native permissions; ringing follows a live authenticated call invite,
not FCM alone. Native PUBLIC notification presentation, cold call runtime lifetime,
answer/reject and API36 emulator evidence are recorded in the report; physical
phones, OEM battery behavior and locked video-camera eligibility remain separate.

## LastCall 0.5.1/code7 checkpoint (2026-10-29)

Firebase Cloud Messaging is now configured in production. The dedicated LastCall
sender account has only `roles/firebasecloudmessaging.admin`, rather than
Owner/Editor or the broader default Firebase Admin account. The private server
JSON is stored outside Git/APK/static files with owner-only access and mounted
read-only. The Android client configuration is a separate build input. Neither
private keys, token values nor private account details belong in public reports.
[Official role permissions](https://docs.cloud.google.com/iam/docs/roles-permissions/firebasecloudmessaging).

Authenticated signaling reports push=true and relay=true. On Android 0.5.0/code6,
an actual generic FCM notification arrived after Home followed by ordinary
process termination, and tapping opened LastCall; the sender's waiting text then
received a real durable recipient ACK over a direct peer connection. This was
not force-stop and does not establish automatic headless synchronization.

Android 0.5.1/code7 implements bounded background peer synchronization. On the
project's Android emulator, the final APK process was absent after ordinary process
termination; real FCM cold-started synchronization without tapping or opening the
app UI. Text and a 35-byte file obtained durable recipient ACK at 5728ms in one
measured direct-route run. This is not force-stop, physical-phone/locked-screen
or Russian-carrier acceptance. Only tokens with a successfully registered
background task opt into data-only FCM; older tokens retain notification+data.
Separate native foreground takeover completed both ACKs at 6786ms with recovery
from one transient session error. An offline manual relaunch after force-stop
retained the profile and saved text/file entries; this was not push after force-stop.
APNs/PushKit/CallKit and iOS signing remain unconfigured.

Registration in 0.4 uses a unique username and a device installation key. No phone
number, SMS.ru account or Firebase configuration is needed to register and search
the server directory. Production ignores legacy SMS environment settings; old
phone endpoints remain unavailable for older clients.

The public preview currently has authenticated TURN and FCM enabled.
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

The user authorized publication and the dedicated FCM account/key. The current
deployment selects both private environment files and the Firebase override,
recreating only the LastCall signaling service. Keep TURN env **last**, because
blank TURN values in the services example must not disable the working relay:

```sh
docker compose --env-file infra/.env.public-services --env-file infra/.env.public-turn -p messenger-public -f infra/compose.public.yaml -f infra/public/compose.firebase.example.yaml config --quiet
docker compose --env-file infra/.env.public-services --env-file infra/.env.public-turn -p messenger-public -f infra/compose.public.yaml -f infra/public/compose.firebase.example.yaml up -d --no-deps signaling
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

This override is active. Keep the TURN env **last**, and use the identical env/file
order when recreating the signaling container. Base-only recreation disables the
optional providers even when the SDK is installed.

The override bind-mounts the file read-only at `/run/secrets/firebase-admin.json`;
`create_host_path: false` prevents accidentally creating a directory for a mistyped
path. It sets `GOOGLE_APPLICATION_CREDENTIALS` only inside the signaling container.
Never copy the admin JSON into the image, static download folder or Android app.
The mobile Firebase client configuration is a separate artifact managed by the
mobile build. Invalid/missing/unreadable account JSON leaves push capability
false; valid credentials still require an external provider/device delivery check.

For a successfully opted-in background token, the 0.5.1 provider path uses high-
priority data-only FCM with generic presentation fields and a short intent TTL.
Legacy tokens keep notification+data. The task receives a bounded transport
window, then drains encrypted storage before cleanup; no microphone, auto-answer,
new identity or server-side content queue is introduced. The final APK passed
the specific cold-wake text/small-file emulator check above; physical devices,
locked screen, larger transfers and cellular operators still require testing.

FCM carries no plaintext chat, filename, SDP or private identity key. In 0.6.0 it
may transiently carry a bounded encrypted text preview with visible identity/intent
headers, plus bounded encrypted file-name preview; in published 0.5.1 the payload remains generic.
The coordination directory does retain profiles, display names, public device
keys, push tokens, consent and quotas. Signaling forwards opaque encrypted
SDP/candidate envelopes; the private installation seed stays on the device.
TURN forwards encrypted traffic without storing a chat archive.

A generic wake contains no chat payload; an opted-in preview adds only bounded
authenticated ciphertext, with no media/file bytes. The target must have watched the sender;
server consent and quotas apply. Provider acceptance is not recipient ACK and does
not guarantee that the OS opens a suspended app. After reopening, both peers still
need an available direct or authenticated encrypted relay connection to transfer
the sender-local pending message.

## TURN

Public TURN is active through native Homebrew coturn 4.18.0 and user LaunchAgent
`dev.lastcall.turn`; The retired Docker `lastcall-coturn` container was removed on 2026-10-30. The user forwarded
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
TTL is 600 seconds; authenticated services report relay=true, push=true and
phone features=false. Anonymous GET `/ice` remains STUN-only. The catalog retains
no chat mailbox; preview ciphertext may transiently cross server/FCM as described
above. TURN forwards encrypted packets without a chat archive,
with real server bandwidth and traffic metadata costs. Restart both 0.5 clients
to refresh ICE. This TURN configuration is compatible with 0.5.0; the new
background-sync path requires 0.5.1 on both peers. Certificate/public-IP automation
(`msg-0aa`) and physical Russian-operator tests (`msg-9rr`) remain open.

## Deployment and rollback

For a configured deployment, use the same explicit `--env-file` and `-f` selection
on the authorized `up -d` command; otherwise optional services stay disabled.
The active deployment uses the base compose file plus the Firebase override,
services env and TURN env last, as shown above.
Reverting to only the base compose file and blank provider env deliberately
disables adapters on next preview-container recreation. Keep the named directory volume for stable users
and verification metadata. Active sockets and in-memory OTP challenges end when
the preview process restarts. Do not restart unrelated containers or delete the
shared proxy network.
