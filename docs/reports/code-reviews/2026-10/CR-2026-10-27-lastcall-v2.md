# Code Review: LastCall 0.2

Date: 2026-10-27. Scope: new directory/identity API, manager lifecycle,
peer protocol extensions, mobile storage/navigation, public gateway and APK.
Reviewed recent relevant commits de55951/2767763 and changed/new source. Generated
files and lockfile internals excluded from line review; dependency changes checked.

## Verdict

PASS for a limited technical preview after the fixes below. Production security,
background delivery and Russian operator availability remain unverified. This is
an implementation review, not an independent cryptographic audit.

## Findings corrected before publication

- P0 — `apps/mobile/app.config.ts:39`: ImagePicker false camera/microphone config
  emitted global Android permission-removal directives, overriding WebRTC. Final
  APK inspection exposed missing CAMERA/RECORD_AUDIO despite JS configuration.
  Replaced both values with call usage strings, regenerated native files cleanly,
  inspected Android manifest and iOS introspected permission descriptions. Added
  final-APK permission/signature/embedded-bundle checks to CI. Tracked msg-gjz.
- P1 — `packages/core/src/messenger.ts:100`: fatal server error names initially did
  not match the manager; replacement could trigger competing reconnects. Corrected
  actual codes and stopped automatic reconnect after session-replaced. Regression
  checks no new socket over 31 seconds.
- P1 — `packages/core/src/messenger.ts:216`: recipient group file sending originally
  depended on existing pairs. Mobile inferred group connectivity from DM rows,
  missing valid B-C transport without a DM. Core now establishes/waits for recipient
  connections and mobile relies on core readiness. Unit and real three-browser
  tests send exact file bytes from both creator and recipient.
- P1 — `apps/mobile/src/storage.ts:56`: adapter bound initially smaller than core
  ciphertext-hex bound. Unified with exported core maximum; valid bounded history
  will not fail just because ciphertext encoding doubles its length.
- P1 — old production defaults: new-subdomain DNS negative cache reproducible,
  base-path URL construction discarded gateway prefix, and one proxy-IP allowance
  admitted only eight sockets. Added stable apex prefix with endpointUrl tests;
  deliberate bounded public capacity includes directory plus pair sockets.

## Remaining issue

P1 — `packages/core/src/messenger.ts:106` and `apps/server/src/directory.ts:111`:
authenticated users can send unsolicited connect notifications, which automatically
add a bounded contact. Repeated accounts can consume another user's contact/pair
capacity. Bounds prevent unlimited memory growth but do not provide consent/block
policy. Follow-up **msg-218** adds contact requests/block controls and per-identity
abuse quotas before broader rollout. No new production-readiness claim is made.

## Reviewed safeguards

- One-use expiring challenge; signed profile fields; key-bound ID validation;
  parameterized SQLite; unique usernames; old-socket ownership check on replacement.
- Strict bounded control frames and explicit presence subscriptions; directory does
  not accept chat/file/media; no device seed or frame logging.
- Domain-separated keys; authenticated sealed local state; serialized writes;
  immutable creator-defined group membership; receiver ACK and per-recipient fanout.
- No intentional disconnect on navigation/background; independent peer sessions;
  version/package/signing continuity; Android backup disabled.

## Escalation before production

New cryptographic identity/pair protocol, SQLite schema, /directory API and
@noble/curves dependency need specialist security review. Ratchet, authenticated
configuration/channel binding, device lifecycle/key verification tracked msg-4vs.
Mobile push/system call integration msg-3z9, TURN msg-bcw, field measurements msg-9rr.

## Validation

- Full lint/typecheck/test/build: PASS; 30 core +20 server tests.
- Real browser transport suite: 6 PASS, 1 explicit TURN skip. Final groupfile
  regression rerun PASS after last core change; no screenshot matrix.
- Public normal-DNS TLS/WSS: legacy encrypted signaling PASS; three-identity
  directory/search/presence/connect PASS on both apex gateway and p2p hostname.
- Deployed server bundle hash equals verified local bundle; SQLite named volume
  mounted writable, container healthy; other apex application still unchanged.
- Expo Android+iOS JS export: PASS. Native Android release/signature/final manifest
  verification recorded with exact artifact hash in artifacts/README.md.
- No physical-device call/audio/DPI validation or signed iOS IPA claimed.
