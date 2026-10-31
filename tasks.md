# Claude QA configuration (msg-tan)

- [X] Dedicated risk-based tester, three required skills and documented six-cycle protocol
  → Artifacts: [prompt](docs/qa/lastcall-release-tester.md), [protocol](docs/qa/CLAUDE-TESTER.md)
- [X] Verify authenticated tester/settings: cycle2/6 PASS,264unit tests and9browser scenarios;1TURNskip
  → Artifacts: [counter](docs/qa/claude-qa-state.json), [cycle1 auth blocker](docs/reports/testing/2026-10/claude-qa-cycle-1.md), [cycle2 verified results](docs/reports/testing/2026-10/claude-qa-cycle-2.md)
- [X] Show actual local agent stages, six-cycle history and stale/disconnected evidence without raw traces (msg-mio)
  → Artifacts: [monitor](infra/qa/monitor.mjs), [panel](infra/qa/monitor.html), [focused checks](infra/qa/monitor.test.mjs), [verification](docs/reports/testing/2026-10/live-monitor.md), [run instructions](docs/qa/CLAUDE-TESTER.md#local-progress-panel)

# LastCall 0.7.1: authenticated call invite and stable video (paused, unpublished)

- [X] Implement candidate0.7.1/code11 call invite, media gating, full-screen access and video stability; **not accepted** (msg-d1e, msg-si6)
  → Artifacts: [wake contract](docs/WAKE-CONTRACT.md), [candidate report](docs/reports/debugging/2026-10/call-invite-071.md), [native 0.7.1](docs/reports/debugging/2026-10/native-071.md)
- [X] Independent Claude QA cycles4–6/6: cycle4 full commands completed but response BLOCKED at280s; cycle5 source review PASS; cycle6 build/types/final-APK PASS (msg-tan)
  → Artifacts: [cycle4](docs/reports/testing/2026-10/claude-qa-cycle-4.md), [cycle5](docs/reports/testing/2026-10/claude-qa-cycle-5.md), [cycle6](docs/reports/testing/2026-10/claude-qa-cycle-6.md), [counter](docs/qa/claude-qa-state.json)
- [X] Build/sign final unpublished candidate; exact SHA256/size/certificate recorded; **native Android17 cold FCM FAIL**; no publication (main)
  → Artifacts: [APK record](artifacts/README.md), [native failure evidence](docs/reports/debugging/2026-10/native-071.md)
- [X] Guard Android push release configuration across every Expo/Gradle stage with packaged FCM/version/code gate (msg-c5v)
  → Artifacts: [helper](infra/build-android-release.sh), ignored positive log `.tmp/current/native-071/release-fixed.log`, [cycle6](docs/reports/testing/2026-10/claude-qa-cycle-6.md)
- [ ] Fix SDK58 `dataString:null` wrapper rejection: normalize only the known null SDK field, add installed-serializer fixtures, rebuild and retest real cold FCM answer/cancel (msg-el9)
  → Evidence: ignored PoC `.tmp/current/native-071/sdk-wrapper-repro.json`, [native report](docs/reports/debugging/2026-10/native-071.md); requires explicit user quota/extensions, no automatic cycle7
- [ ] Physical phone acceptance on published0.7.0: both phones updated in place, Android14+ full-screen access, locked/background/process-death/cancel/answer, >90s video with diagnostics on flicker; force-stop and iOS not guaranteed
  → Artifacts: [phone tasks](docs/TESTING-RU.md); 0.7.1-specific items deferred

# LastCall 0.7.0: background calls, read receipts and video

- [X] Refresh root/mobile README and linked wake/outbox status for published0.7.0, actual acceptance limits and current delivery/read behavior (msg-8vd)
  → Artifacts: [overview](README.md), [mobile guide](apps/mobile/README.md), [wake contract](docs/WAKE-CONTRACT.md), [outbox contract](docs/OUTBOX-CONTRACT.md)
- [X] Implement LastCall-owned incoming calls, automatic self-managed account and bounded call-specific background setup (msg-d1e)
  → Artifacts: [controller](apps/mobile/src/system-calls.ts), [native incoming UI](apps/mobile/plugins/calls/LastCallCallActivity.java), [native services](apps/mobile/plugins/calls/), [wake contract](docs/WAKE-CONTRACT.md)
- [X] Add durable signed P2P read receipts and clock/one-check/two-check indicators, including group and attachment progress (msg-3jo)
  → Artifacts: [signed receipts](packages/core/src/read-receipt.ts), [manager](packages/core/src/messenger.ts), [display model](apps/mobile/src/delivery-model.ts), [contract](docs/OUTBOX-CONTRACT.md)
- [X] Remove the permanent low-quality cap from missing bandwidth/high base RTT; preserve congestion adaptation and expose video measurements (msg-si6 implementation)
  → Artifacts: [policy](packages/core/src/video.ts), [transport](packages/core/src/session.ts), [policy regressions](packages/core/src/video.test.ts)
- [X] Claude QA cycle3/6:292unit tests, Chrome10PASS/1authenticated-TURNskip, lint/types/Android+iOS JS exports; same-certificate Android release build with forced bundle regeneration
  → Artifacts: [QA report](docs/reports/testing/2026-10/claude-qa-cycle-3.md), [persistent counter](docs/qa/claude-qa-state.json), [APK metadata](artifacts/README.md)
- [X] Focused emulator in-place upgrade preserves identity; own incoming activity above PIN, no pre-answer audio service, native expiry/reject cleanup
  → Artifacts: [native call sources](apps/mobile/plugins/calls/), [exact native evidence](docs/reports/debugging/2026-10/native-070.md)
- [X] API36 own-button locked answer with sustained bidirectional RTP beyond wake window; confirmed process-death/FCM cold-start own UI; publish0.7.0 and verify primary/alternate/preview exact bytes/hash
  → Artifacts: [native evidence and limits](docs/reports/debugging/2026-10/native-070.md), [release](artifacts/README.md), [phone tasks](docs/TESTING-RU.md)
- [ ] Physical phone UI/voice/video quality, Russian carriers/handover, OEM battery behavior and iOS/APNs/CallKit acceptance (msg-3z9, msg-9rr; msg-si6 physical acceptance)
  → Artifacts: [phone tasks](docs/TESTING-RU.md)

# LastCall 0.6.0: notifications, system calls and media (historical)

- [X] Pair-encrypted bounded text/file-name FCM previews with explicit capability and durable ACK separation (msg-l6n)
  → Artifacts: [crypto](packages/core/src/push-preview.ts), [provider](apps/server/src/providers.ts), [native evidence](docs/reports/debugging/2026-10/native-060.md)
- [X] Authenticated message/file notification tap opens the saved DM/group after restore (msg-05d)
  → Artifacts: [native routes](apps/mobile/plugins/notifications/LastCallNotificationsModule.java), [navigation](apps/mobile/src/components/NotificationNavigationBridge.tsx), [tests](apps/mobile/tests/notification-navigation.test.ts)
- [X] Android Telecom secure-lockscreen audio answer and independent live-call/headless timer ownership (msg-9sx)
  → Artifacts: [controller](apps/mobile/src/system-calls.ts), [native ownership](apps/mobile/plugins/calls/), [evidence](docs/reports/debugging/2026-10/native-060.md)
- [X] Foreground voice record/preview/send/delete and encrypted P2P file playback (msg-2kk)
  → Artifacts: [composer](apps/mobile/src/components/MediaComposer.tsx), [voice](apps/mobile/src/components/VoiceNote.tsx), [permission/cancel regressions](apps/mobile/tests/media.test.ts)
- [ ] User phone UI acceptance for circle finalize/playback and fullscreen/adaptive video (msg-46e, msg-si6)
  → Artifacts: [circle](apps/mobile/src/components/VideoNote.tsx), [fullscreen call](apps/mobile/src/components/CallOverlay.tsx), [adaptive policy](packages/core/src/video.ts), [regressions](packages/core/src/video.test.ts)
- [X] Remove retired stopped Docker TURN container after validating active native relay (msg-qa1)
  → Artifacts: [native runbook](infra/native-turn/README.md), [deployment](infra/public/README.md)
- [X] Independent review and final quality gates:264tests, Chrome9PASS/1TURNskip, Android release/R8 and iOS JS export
  → Artifacts: [review](docs/reports/code-reviews/2026-10/CR-2026-10-30-lastcall-060.md), [release](artifacts/README.md), [phone tasks](docs/TESTING-RU.md)
- [X] Publish same-certificate0.6.0/code9 and verify both public download hashes; UI acceptance handed to user by explicit request
  → Artifacts: [APK](https://lienad.ru/messenger/download/LastCall-0.6.0.apk), [phone tasks](https://lienad.ru/messenger/tasks.txt)
- [ ] Physical Android/Russian carriers, locked video-camera/OEM battery behavior and iOS/APNs/CallKit acceptance (msg-3z9, msg-9rr)

# Initial technical prototype (historical)

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

V0.1 follow-up is superseded by the later work below. TURN provisioning was
pending at that historical checkpoint; its completed external verification is
recorded in the current TURN section. Real-device feedback, iOS signing and
production protocol review remain in Beads.

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

# LastCall 0.3 implementation checkpoint (historical)

Phone verification/discovery was superseded by the user's 0.4 registration model.
Its former mobile paths were removed; implementation history remains in commit 907817b.

- [X] Strict phone/push service APIs, authenticated ICE and capability-aware wake
  → Artifacts: [core](packages/core/src/services.ts), [service tests](packages/core/src/services.test.ts)
- [X] Real SMS.ru/FCM adapters, bounded OTP/lookup/wake requests and persisted consent
  → Artifacts: [providers](apps/server/src/providers.ts), [services](apps/server/src/services.ts), [live contract tests](apps/server/test/services.test.ts)
- [X] Phone verification screens, consent-based phonebook hashes and conditional FCM
  → Artifacts: [historical phone screen](https://github.com/DV-Design/messenger-prototype/blob/907817b/apps/mobile/src/app/phone.tsx), [push](apps/mobile/src/components/PushBridge.tsx)
- [X] Locked production runtime/configuration, review and Android release build
  → Artifacts: [service setup](infra/public/SERVICES.md), [review](docs/reports/code-reviews/2026-10/CR-2026-10-28-services.md), [native evidence](docs/reports/debugging/2026-10/native-services.md)
- [X] Final APK download verification and public handoff (msg-s39)
  → Artifacts: [release record](artifacts/README.md), [phone testing tasks](docs/TESTING-RU.md)

# Required for working external services

## Active 0.5 delivery work

- [X] Firebase LastCall project and Android client configuration (server activation completed in0.5.1 below)
  → Artifacts: [setup checkpoint](infra/public/SERVICES.md)
- [X] Durable seven-day sender outbox for text and files, recipient persistence before ACK (msg-c0z, msg-row)
  → Artifacts: [manager](packages/core/src/messenger.ts), [regressions](packages/core/src/outbox.test.ts)
- [X] Authenticated group peer synchronization while original sender is offline (msg-c0z, msg-t02)
  → Artifacts: [signed records](packages/core/src/group-sync.ts), [real peer tests](tests/e2e/outbox-sync.spec.ts)
- [X] Network observer, bounded ten-second ICE/signaling recovery and explicit-leave compatibility (msg-3t3)
  → Artifacts: [contract](docs/NETWORK-HANDOVER-CONTRACT.md), [transport](packages/core/src/session.ts), [resume tests](apps/server/test/network-resume.test.ts)
- [X] Independent review, quality gates, Android artifact and publication
  → Artifacts: [review](docs/reports/code-reviews/2026-10/CR-2026-10-28-lastcall-05.md), [native evidence](docs/reports/debugging/2026-10/native-050.md), [release](artifacts/README.md), [APK](https://lienad.ru/messenger/download/LastCall-0.5.0.apk)

- [ ] Validate physical Android and iOS/APNs/system incoming calls (msg-3z9)
  → Artifacts: [push/wake audit and acceptance plan](docs/reports/debugging/2026-10/push-wake-2026-10-29.md), [provider setup](infra/public/SERVICES.md)
- [X] Audit missing push/wake: server credential absent, existing 0.5 tray/tap behavior and proposed bounded headless path
  → Artifacts: [read-only audit](docs/reports/debugging/2026-10/push-wake-2026-10-29.md)
- [X] Configure approved dedicated FCM-only account, external read-only credential and actual Android push
  → Artifacts: [configuration](infra/public/SERVICES.md), [native evidence](docs/reports/debugging/2026-10/native-051-push.md)
- [X] Implement bounded Android background P2P wake and durable no-tap text/small-file acceptance (msg-27d)
  → Artifacts: [task](apps/mobile/src/background-notifications.ts), [ownership](apps/mobile/src/wake-model.ts), [native evidence](docs/reports/debugging/2026-10/native-051-push.md)
- [X] Prevent initial native channel data loss with bilateral application readiness (msg-h3g)
  → Artifacts: [transport](packages/core/src/session.ts), [regressions](packages/core/src/data-ready.test.ts)
- [X] Review, final gates and same-certificate Android0.5.1/code7 release
  → Artifacts: [review](docs/reports/code-reviews/2026-10/CR-2026-10-29-background-push.md), [release](artifacts/README.md), [phone tasks](docs/TESTING-RU.md)
- [X] Retire phone registration/discovery requirement by user direction (msg-p7x)
- [X] Provision and validate reachable authenticated P2P relay fallback (msg-bcw)
  → Artifacts: [network choice](docs/NETWORK-CHOICE.md), [native deployment](infra/native-turn/README.md), [external evidence](docs/reports/code-reviews/2026-10/CR-2026-10-28-native-turn.md)
- [ ] Validate physical Russian operators, poor links and call handover (msg-9rr)

Firebase server FCM is configured and real Android emulator no-tap background
text/small-file delivery is verified in0.5.1. Physical Android acceptance,
iOS/APNs/system incoming calls remain tracked by msg-3z9. Firebase is needed for
notifications; username registration and server-directory sync do not need it.
SMS.ru is no longer required. Closed-app delivery remains pending; public TURN
is active and independently verified over UDP/TCP/TLS. Restart both 0.5 apps to
refresh ICE; the APK/version did not change for this server configuration.

# Public TURN fallback verified on the current server (msg-bcw)

- [X] Isolated authenticated relay configuration, private TLS copy and scoped certificate refresh
  → Artifacts: [deployment](infra/public/compose.turn.yaml), [runbook](infra/public/TURN.md), [refresh](infra/public/refresh-turn-cert.sh)
- [X] Independent configuration, TLS and LAN TCP allocation checks
  → Artifacts: [review and evidence](docs/reports/code-reviews/2026-10/CR-2026-10-28-turn-preparation.md)
- [X] User-applied router forwarding and native coturn after Docker Desktop UDP diagnosis
  → Artifacts: [native deployment](infra/native-turn/README.md), [relay review](docs/reports/code-reviews/2026-10/CR-2026-10-28-native-turn.md)
- [X] External UDP/TCP/TLS forced-relay text ACK, exact file bytes and bidirectional received audio RTP; authenticated production ICE enabled
  → Artifacts: [external run 40782070981](https://github.com/DV-Design/messenger-prototype/actions/runs/40782070981), [service configuration](infra/public/SERVICES.md)
- [ ] Automate certificate/public-IP maintenance before sustained deployment (msg-0aa)
- [ ] Review 32-allocation / 41-port capacity for a fully relayed eight-member mesh (msg-d05)

Only native Homebrew coturn 4.18.0 / `dev.lastcall.turn` is active; Docker
`lastcall-coturn` is stopped. Authenticated signaling now supplies 600-second
TURN credentials; anonymous GET `/ice` stays STUN-only. External relay evidence
does not replace physical Russian-operator tests (`msg-9rr`) or turn on FCM.

# LastCall 0.4: server usernames (msg-5oa)

- [X] Immutable unique username per installation key, canonical profile recovery
  → Artifacts: [contract](docs/USERNAME-CONTRACT.md), [server](apps/server/src/directory.ts)
- [X] Paginated server directory and Unicode login/name search
  → Artifacts: [core](packages/core/src/directory.ts), [contacts](apps/mobile/src/app/(tabs)/contacts.tsx)
- [X] Remove mobile phone binding and unnecessary phonebook permission
  → Artifacts: [mobile](apps/mobile/src/), [config](apps/mobile/app.config.ts)
- [X] Independent gates, Android upgrade, publication and pushed handoff
  → Artifacts: [release](artifacts/README.md), [testing tasks](docs/TESTING-RU.md)

# LastCall 0.4 additions: logo, permissions and wake (msg-8n8)

- [X] Edit supplied logo, reduce white margins and wire native launcher/splash
  → Artifacts: [icon](apps/mobile/assets/lastcall-icon.png), [provenance](apps/mobile/assets/README.md)
- [X] Automatic sequential native permission requests before registration
  → Artifacts: [gate](apps/mobile/src/components/PermissionSetupGate.tsx), [permissions](apps/mobile/src/permissions.ts)
- [X] Direct-first typed wake with short TTL, limits and cancelled/expired-call safety
  → Artifacts: [contract](docs/WAKE-CONTRACT.md), [core tests](packages/core/src/wake.test.ts), [server](apps/server/src/providers.ts)
- [X] Research similar projects, platform limits and architecture trade-offs
  → Artifacts: [study](docs/P2P-WAKE-RESEARCH-RU.md)
- [X] Final native evidence, public download verification and pushed checkpoint
  → Artifacts: [review](docs/reports/code-reviews/2026-10/CR-2026-10-28-lastcall-04.md), [release](artifacts/README.md)
