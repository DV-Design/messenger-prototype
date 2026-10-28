# Optional SMS, FCM and authenticated ICE configuration

The public preview starts with SMS, FCM and TURN genuinely disabled. Merely
building the SDK into the image does not configure an external provider. This
recipe does not create an SMS/Firebase account, claim notification delivery, or
provision a media relay. Existing directory data remains in its named volume.

`compose.public.yaml` sets `REQUIRE_ICE_AUTH=1`. Public GET `/ice` remains STUN-only;
TURN REST credentials, if TURN is explicitly configured, are returned only by an
authenticated directory `ice` request with identity quotas. Do not disable this
flag to work around a legacy client. Standalone local `compose.yaml` keeps its
laboratory behavior.

## Disabled default

The public file requires no environment file or private JSON mount:

```sh
docker compose -p messenger-public -f infra/compose.public.yaml config --quiet
docker build -f infra/Dockerfile.server -t messenger-signaling:preview .
```

The user authorized publication; the base 0.3 preview was deployed with providers
disabled. Configured providers still require their actual account credentials.
Build uses a
locked builder install and a separate `npm ci --omit=dev` production dependency
stage. The final image includes `firebase-admin`'s external runtime imports and
transitive packages, runs as the Node image's `node` UID, and uses the compose
read-only root filesystem plus writable `/data` directory volume. No host ports,
additional privileges or changes to shared proxy services are needed.

## SMS.ru

Copy `infra/public/services.env.example` to `infra/.env.public-services`, which is
ignored by Git and the Docker build context. Set `SMSRU_API_ID` to the real account
API ID and generate an independent random `PHONE_VERIFICATION_SECRET` of at least
32 bytes. Empty or incomplete values do not enable the adapter. Keep the send
quotas deliberately small during provider verification. The secret digests OTPs
in server memory; restart invalidates pending challenges, not verified phone hashes.

Validate without printing expanded configuration/credentials:

```sh
docker compose --env-file infra/.env.public-services -p messenger-public -f infra/compose.public.yaml config --quiet
```

Only an actual provider-accepted send returns a challenge. There is no public fixed
OTP, test-phone bypass or pretend SMS success. Inspect service capabilities through
authenticated API calls, then verify a real phone with the provider configured.

## Firebase Cloud Messaging

Use a separate server service-account JSON, stored outside the repository and
readable by the container's Node UID. Set its absolute host path in
`FIREBASE_ADMIN_CREDENTIALS_FILE` in the ignored env file. Explicitly select the
optional override; the unconfigured default never references a missing file:

```sh
docker compose --env-file infra/.env.public-services -p messenger-public -f infra/compose.public.yaml -f infra/public/compose.firebase.example.yaml config --quiet
```

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

`TURN_URLS` and `TURN_SHARED_SECRET` must be set together only after a reachable
relay is provisioned and tested across the intended networks. TURN TTL defaults
to 600 seconds. This optional env file does not publish relay ports, install TLS
certificates or alter the shared proxy. A relay configured flag is not a successful
forced-relay/media test. The external TURN host, firewall, TLS and actual transport
verification remain separate work.

## Deployment and rollback

For a configured deployment, use the same explicit `--env-file` and `-f` selection
on the authorized `up -d` command; otherwise optional services stay disabled.
The 0.3 deployment used only the unconfigured base compose file. Reverting
to only the base compose file and blank provider env disables adapters on next
preview-container recreation. Keep the named directory volume for stable users
and verification metadata. Active sockets and in-memory OTP challenges end when
the preview process restarts. Do not restart unrelated containers or delete the
shared proxy network.
