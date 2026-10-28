# Code review: LastCall 0.3 service integration

Date: 2026-10-28. Scope: changes since ddf5e16 in core service schemas/request
lifecycle, server provider adapters/SQLite authorization, mobile phone discovery
and conditional FCM, and the production dependency/configuration path.

## Result

PASS for the implementation checkpoint with external services explicitly disabled.
This does not approve a claim of working closed-app notifications, actual SMS
delivery, a deployed relay or production cryptographic security.

Main independently read the authentication/authorization and provider paths,
request correlation and cleanup, consent/cancellation behavior, runtime config and
dependencies. Existing encrypted content, ACK and legacy ready-frame boundaries
were preserved. Schema additions retain the existing SQLite profile volume.

## Findings corrected before release

- `packages/core/src/messenger.ts` wake scheduling originally sent intents even
  when push was unavailable, surfacing a server error during ordinary text sends.
  A focused regression reproduced the false error. Capability-aware scheduling
  now suppresses these intents, coalesces capability requests per connection and
  leaves delivery state dependent on peer ACK. Regression passed after the fix.
- `apps/mobile/src/discovery.ts` now clears cached matches after permission
  revocation. Failure to persist disabled consent pauses uploads and displays an
  explicit warning/retry instead of claiming permanent disablement.
- `apps/server/src/services.ts` rejects provider acceptance after the OTP expires
  and bounds shutdown even if provider disposal never resolves. Both are tested.

## Validation

- Node 24 root lint, typecheck, tests and builds: PASS, **85 tests**
  (44 core, 31 server, 10 mobile).
- Real Chrome interoperability: **6 passed**, forced-TURN test explicitly skipped
  because no validated relay is configured. Exact file bytes and actual media
  tracks are checked; synthetic audio does not establish intelligibility.
- Real `MessengerClient` plus live server and private injected providers:
  verification/discovery/authenticated ICE/offline wake control plane PASS.
  Provider acceptance does not mark pending text delivered. Fake provider tests
  do not prove delivery through SMS.ru or Google.
- Production server npm audit: **0 advisories** at this check. The known Expo
  development-toolchain advisory remains tracked separately in msg-bkt.
- Docker image build/runtime: PASS; Node UID, readonly root, full locked Firebase
  runtime dependencies, SQLite volume and genuinely disabled capabilities checked.
- Public deployment: healthy; normal DNS/TLS on both hostnames, authenticated
  directory, service RPCs, STUN-only ICE and correlated disabled-service errors PASS.
  Legacy two-peer encrypted signaling and three-user presence/connect smoke PASS.
- Android clean native release: PASS, R8 and release lint enabled; 819 tasks,
  3m07s. Package/version/signature/ARM64/min24/target36, embedded Hermes bundle and
  HTTPS base verified. Contacts/camera/microphone requested, WRITE_CONTACTS absent,
  Android backup disabled. Native upgrade evidence is recorded separately in
  [native services smoke](../../debugging/2026-10/native-services.md).
- Android and iOS JavaScript exports: PASS. No signed native iOS build or APNs test.

## Required follow-up

- msg-3z9: user Google login, real Firebase project/client/server configuration,
  Android rebuild, physical-device background notification tests and iOS/APNs.
- msg-p7x: SMS.ru account/API configuration and actual verified-phone discovery.
- msg-bcw: provision a reachable authenticated relay and prove forced-relay bytes,
  audio and cross-network connectivity. Public TLS alone is insufficient.
- msg-218: contact requests/blocking and abuse controls remain necessary. The
  current watch allow-list is a protocol subscription; incoming contacts are
  automatically remembered by the preview and are not a full human approval flow.
- msg-t02: sender-local pending text requires both peers to become available;
  encrypted offline content custody has not been introduced.
- msg-4vs: independent protocol review, ratchet and device/key lifecycle remain.

Phone hashes are enumerable personal metadata, not anonymous identifiers. FCM
receives a device token and generic wake notification; no chat text, files, call
SDP or phonebook names are placed in that payload. Actual account credentials
remain external and are not included in the repository or APK.
