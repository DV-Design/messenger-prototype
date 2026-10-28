# Initial technical prototype

- [X] Shared authenticated signaling and WebRTC core (verified: 15 tests)
  → Artifacts: [core](packages/core/src/session.ts), [crypto](packages/core/src/crypto.ts)
- [X] Bounded signaling server and local TURN deployment recipe (verified server, Docker build)
  → Artifacts: [server](apps/server/src/server.ts), [infra](infra/README.md)
- [X] Android/iOS foreground client source; standalone Android APK verified
  → Artifacts: [mobile](apps/mobile/README.md), [APK record](artifacts/README.md)
- [X] Browser interoperability and media/file integration checks (5 passed; TURN still pending)
  → Artifacts: [integration checks](tests/e2e/messenger.spec.ts), [probe](apps/probe/README.md)
- [X] Architecture, threat model, runbook and follow-up issues
  → Artifacts: [architecture](docs/ARCHITECTURE.md), [README](README.md), [user testing](docs/TESTING-RU.md)
- [X] Review and quality gates; native Android release, TLS/WSS and APK download verified
  → Artifacts: [review](docs/reports/code-reviews/2026-10/CR-2026-10-27-prototype.md), [public deployment](infra/public/README.md)
- [X] Publish public HTTPS preview and Android installer
  → Artifacts: [app](https://p2p.lienad.ru/download/messenger-preview.apk), [tasks](https://p2p.lienad.ru/tasks.txt)

V0.1 follow-up is superseded by the V0.2 work below. Real-device feedback, iOS
signing, TURN and production protocol review remain in Beads.

# LastCall 0.2

- [X] Authenticated persistent directory and presence for all users (msg-4jw)
  → Artifacts: [directory](apps/server/src/directory.ts), [server tests](apps/server/test/directory.test.ts)
- [X] Independent P2P conversations, private small groups and encrypted local outbox (msg-r0o)
  → Artifacts: [manager](packages/core/src/messenger.ts), [three-client checks](tests/e2e/directory.spec.ts)
- [X] Familiar mobile chats/contacts/settings and global calls (msg-ymj)
  → Artifacts: [routes](apps/mobile/src/app/), [storage](apps/mobile/src/storage.ts)
- [X] Stable public gateway, LastCall APK and real normal-DNS verification (msg-9mf)
  → Artifacts: [gateway](infra/public/messenger-apex.caddy.inc), [release](artifacts/README.md), [testing tasks](docs/TESTING-RU.md)
- [X] Correct native camera/microphone permission plugin conflict (msg-gjz)
  → Artifacts: [config](apps/mobile/app.config.ts), [CI artifact checks](.github/workflows/check.yml)

V2 review: [report](docs/reports/code-reviews/2026-10/CR-2026-10-27-lastcall-v2.md).
Remaining work tracked in Beads; voice notes/group calls/push/ratchet/field networks
are separate tasks. Unsolicited-contact controls tracked msg-218.

# LastCall 0.2.1

- [X] Reproduce and correct missing-message delivery and stalled connections (msg-7v3)
  → Artifacts: [scope](docs/DELIVERY-FIX-CONTRACT.md), [delivery regressions](packages/core/src/delivery.test.ts)
- [X] Device contact sync/linking and application permission setup (msg-o0b)
  → Artifacts: [mobile](apps/mobile/src/), [scope](docs/DELIVERY-FIX-CONTRACT.md)
- [X] Native delivery evidence, final APK verification/publication and repository handoff
  → Artifacts: [release](artifacts/README.md), [testing tasks](docs/TESTING-RU.md)

# LastCall 0.3 implementation checkpoint

- [X] Strict phone/push service APIs, authenticated ICE and capability-aware wake
  → Artifacts: [core](packages/core/src/services.ts), [service tests](packages/core/src/services.test.ts)
- [X] Real SMS.ru/FCM adapters, bounded OTP/lookup/wake requests and persisted consent
  → Artifacts: [providers](apps/server/src/providers.ts), [services](apps/server/src/services.ts), [live contract tests](apps/server/test/services.test.ts)
- [X] Phone verification screens, consent-based phonebook hashes and conditional FCM
  → Artifacts: [phone screen](apps/mobile/src/app/phone.tsx), [discovery](apps/mobile/src/discovery.ts), [push](apps/mobile/src/components/PushBridge.tsx)
- [X] Locked production runtime/configuration, review and Android release build
  → Artifacts: [service setup](infra/public/SERVICES.md), [review](docs/reports/code-reviews/2026-10/CR-2026-10-28-services.md), [native evidence](docs/reports/debugging/2026-10/native-services.md)
- [X] Final APK download verification and public handoff (msg-s39)
  → Artifacts: [release record](artifacts/README.md), [phone testing tasks](docs/TESTING-RU.md)

# Required for working external services

- [ ] Configure Firebase and validate actual Android closed-app notifications; iOS/APNs/system calls (msg-3z9)
- [ ] Configure SMS.ru and prove real phone verification and automatic discovery (msg-p7x)
- [ ] Provision and validate reachable authenticated P2P relay fallback (msg-bcw)
  → Artifacts: [service contract](docs/SERVICES-CONTRACT.md), [network choice](docs/NETWORK-CHOICE.md)

Firebase project/client/server configuration and SMS.ru account access are absent.
The 0.3 APK is an implementation checkpoint with explicit unavailable-service
states. It must not be described as a completed closed-app delivery fix.
