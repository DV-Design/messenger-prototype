# Haptics and in-chat sounds (msg-bd1, branch `feat/delivery-requests`)

Status: 1.0.22/code36 built (AAB sha256 a8bd4eea…76d0f9); emulator-tested.

- [X] Feedback model (incoming baseline, open-chat cue, call connect/end, throttle) with tests
  → Artifacts: [model](apps/mobile/src/feedback-model.ts), [runtime](apps/mobile/src/feedback.ts), [tests](apps/mobile/tests/feedback.test.ts)
- [X] Haptics via expo-haptics (Android system haptics); native SoundPool sounds without audio focus, muted on silent/vibrate and in calls
  → Artifacts: [native](apps/mobile/plugins/notifications/LastCallNotificationsModule.java), [sounds generator](infra/generate-ui-sounds.mjs), [settings](apps/mobile/src/components/FeedbackSettings.tsx)
- [X] Gates: mobile 208, server 133, core 265, e2e 16 PASS / 1 skip
- [X] Two Android emulators upgraded 1.0.21 → 1.0.22: sent/incoming SoundPool started, nothing on vibrate mode, long press gave LONG_PRESS haptic
- [ ] Upload 1.0.22 to Play internal and closed testing
- [ ] Physical phones: loudness of the sounds, haptic strength on vivo

# Message reactions (msg-7ek, branch `feat/delivery-requests`)

Status: published to Google Play internal testing as 1.0.21/code35 on 2026-11-10 (AAB sha256 2b3e5a3b…f35425); emulator-tested. Contract: [docs/REACTIONS-CONTRACT.md](docs/REACTIONS-CONTRACT.md).

- [X] Signed `message-reaction` records, SDP marker, storage version 7, relay and trimming in core
  → Artifacts: [record](packages/core/src/message-reaction.ts), [client](packages/core/src/messenger.ts), [tests](packages/core/src/message-reaction.test.ts), [e2e](tests/e2e/outbox-sync.spec.ts)
- [X] Emoji row in the message menu, pills under messages and files
  → Artifacts: [components](apps/mobile/src/components/Reactions.tsx), [model](apps/mobile/src/reaction-model.ts), [tests](apps/mobile/tests/reactions.test.ts), [chat](apps/mobile/src/app/chat/[id].tsx)
- [X] Gates: core 265, server 133, mobile 201, e2e 16 PASS / 1 skip
- [X] Two Android 16 emulators on a store-flavor build: set, add the same, take back while the other app was force-stopped; arrives on reopen
- [ ] Physical phones, groups on a device, mixed with 1.0.20 (older side must receive nothing and show no error)

# Edit and delete messages, chats and contacts (msg-n9n, branch `feature/email-recovery`)

Status: test build only. Contract: [docs/MESSAGE-CHANGE-CONTRACT.md](docs/MESSAGE-CHANGE-CONTRACT.md).

- [X] Signed message changes, tombstones, hidden chats, contact removal in core
  → Artifacts: [core](packages/core/src/message-change.ts), [tests](packages/core/src/message-change.test.ts), [e2e](tests/e2e/outbox-sync.spec.ts)
- [X] Message menu, edit mode, delete chat and contact, "My contacts" section (not yet run on a device)
  → Artifacts: [menu](apps/mobile/src/components/MessageActions.tsx), [model](apps/mobile/src/message-actions-model.ts), [chat](apps/mobile/src/app/chat/[id].tsx)
- [X] Gates: `npm run check` (245 core, 116 server, 154 mobile), `npm run test:e2e` 15 PASS / 1 skip
- [X] Publish test build 1.0.11/code25, not offered through `latest.json`
  → Artifacts: [APK](https://p2p.lienad.ru/download/LastCall-1.0.11.apk), [details](artifacts/README.md)
- [X] New client connects to 1.0.9 on native Android: emulator check, messages and calls both ways (msg-5a9)
  → Artifacts: [report](docs/reports/debugging/2026-11/native-1012.md)
- [X] Fix signaling queue stall after a peer restart, about 30 s (msg-abo)
  → Artifacts: [session](packages/core/src/session.ts), [test](packages/core/src/data-ready.test.ts)
- [X] Fix CI, red since 2026-10-27: camera patch on clean checkout, missing ripgrep, hour-aligned quota tests (msg-km1)
  → Artifacts: [plugin](apps/mobile/plugins/withPersistentCircleCamera.cjs), [workflow](.github/workflows/check.yml), [tests](apps/server/test/services.test.ts)
- [X] Build and publish test APK 1.0.12/code26, build AAB, upload draft releases to Play
  → Artifacts: [APK](https://p2p.lienad.ru/download/LastCall-1.0.12.apk), [details](artifacts/README.md)
- [ ] Physical test on two phones with 1.0.12
- [ ] Owner: App access attestation, send Play changes for review, publish the internal draft (msg-2o0)

# Email registration and account recovery (msg-3zf, branch `feature/email-recovery`)

Status: server deployed with `EMAIL_REQUIRED` off, client in test builds only. Contract: [docs/EMAIL-RECOVERY-CONTRACT.md](docs/EMAIL-RECOVERY-CONTRACT.md).

- [X] Core protocol and one-shot helpers
  → Artifacts: [core](packages/core/src/email-auth.ts), [tests](packages/core/src/email-auth.test.ts)
- [X] Server: keyed address hash, codes, proofs, atomic account move, contact notice
  → Artifacts: [server](apps/server/src/email-auth.ts), [tests](apps/server/test/email-auth.test.ts)
- [X] Privacy policy, terms and store listing text
  → Artifacts: [privacy](infra/public/privacy.html), [terms](infra/public/terms.html), [store guide](store/PLAY-CONSOLE.md)
- [X] Mobile onboarding, settings, reminder and chat banner (not yet run on a device)
  → Artifacts: [onboarding](apps/mobile/src/app/onboarding.tsx), [flow model](apps/mobile/src/email-flow-model.ts), [tests](apps/mobile/tests/email-flow-model.test.ts)
- [X] Gates: `npm run check` (220 core, 116 server, 150 mobile), `npm run test:e2e` 11 PASS / 1 skip
- [X] Free mail provider Brevo: domain records in Cloudflare, SMTP key in `infra/.env.public-services` (msg-60q)
- [X] Server deployed from this branch on 2026-11-04 with `EMAIL_REQUIRED` off; rollback image `messenger-signaling:rollback-1.0.9`, database backup on the same volume
- [X] Real letter: reached a narod.ru inbox from `noreply@lienad.ru`, the code was accepted and refused on replay; no account created
- [X] Publish test build 1.0.10/code24, not offered through `latest.json`
  → Artifacts: [APK](https://p2p.lienad.ru/download/LastCall-1.0.10.apk), [details](artifacts/README.md)
- [X] Forward `admin@lienad.ru` through Cloudflare Email Routing; MX, SPF and DKIM checked over DoH on 2026-11-04, the owner saw a letter from another mailbox arrive (msg-60q)
- [ ] Physical test: register, reinstall, restore, contact warning on a second phone
- [X] Set the policy's effective date, name Brevo, publish privacy and terms (2026-11-04); legal review still recommended
- [X] Update Play Data safety with the email address (saved, not yet sent for review)
- [ ] Check a real registration letter reaches Gmail before review; Google's reviewers need the code
- [ ] Release client, physical acceptance on reinstall, then `EMAIL_REQUIRED=1`

# LastCall 1.0.9 / code23: Play-package push, background delivery and calls fix

Status: root cause found. The server sent every FCM message with `restrictedPackageName: 'dev.messenger.prototype'`, so the Play package `ru.lastcall.app` (1.0.8) never received wake/preview/call pushes: no background delivery, notifications or incoming calls.

- [X] Remove package restriction from FCM messages (server fix also restores pushes for installed 1.0.8)
  → Artifacts: [providers](apps/server/src/providers.ts), [regression](apps/server/test/fcm-package.test.ts)
- [X] PiP host detection independent of applicationId (namespace differs in the store build)
  → Artifacts: [PiP](apps/mobile/plugins/pip/LastCallPip.java)
- [X] Redeploy signaling and build store AAB 1.0.9/code23
  → Artifacts: [AAB](artifacts/README.md), 41,617,605 bytes, SHA256 `a199b6c2ccbf8117e9b9fde389a553c17ee62dafcf603444f4d7030e25836996`
- [X] Upload AAB to the Alpha closed-testing track as `LastCall 1.0.9 closed`, rollout 100%; Google's pre-review check passed
- [X] Send the change for Google review (user, 2026-11-04)
- [X] Google approved `LastCall 1.0.9 closed` (listed as available to selected testers, 2026-11-04)
- [X] Publish `LastCall 1.0.9 internal` to the internal testing track (2026-11-04 11:57)
- [ ] Physical acceptance: closed app receives text, notification and incoming call

# LastCall 1.0.8 / code22: Google Play compliance (in progress)

Status: Play Console draft app created (app ID 4973089023189492670), store listing and app-content declarations filled, and 1.0.8/code22 published to the **internal testing** track as unreviewed. Testers are not added yet. Active-services declaration needs three demo video links; closed testing needs 12 testers for 14 days.

- [X] Add persisted local blocking and enforce it on calls/notifications
  → Artifacts: [core](packages/core/src/messenger.ts), [chat menu](apps/mobile/src/components/SafetyMenu.tsx), [settings](apps/mobile/src/app/(tabs)/settings.tsx)
- [X] Add authenticated server-side report metadata storage and community/terms pages
  → Artifacts: [server](apps/server/src/services.ts), [server handler](apps/server/src/directory.ts), [guidelines](infra/public/community.html), [terms](infra/public/terms.html)
- [X] Build store AAB `ru.lastcall.app` 1.0.8/code22 with upload key and fixed namespace
  → Artifacts: [namespace plugin](apps/mobile/plugins/withLastCallNamespace.cjs), [store guide](store/PLAY-CONSOLE.md)
- [X] Add Firebase Android app `ru.lastcall.app`, rebuild final AAB with FCM
  → Artifacts: [AAB](artifacts/README.md), 41,617,435 bytes, SHA256 `436b90a56289e6070f6d88a99b2a7187ec8dcd42351a641385b29bdedd8c635f`
- [X] Capture English/Russian emulator screenshots at 1080×1920 from store build
  → Artifacts: [en](store/screenshots/en/), [ru](store/screenshots/ru/)
- [X] Upload AAB to Play Console internal testing and fill Data safety/content rating
  → Internal release `LastCall 1.0.8 internal`, published unreviewed 2026-11-03
- [X] Record foreground-service demo videos and finish active-services declaration
  → [camera](https://p2p.lienad.ru/demo/lastcall-foreground-camera.mp4), [microphone](https://p2p.lienad.ru/demo/lastcall-foreground-microphone.mp4), [phone call](https://p2p.lienad.ru/demo/lastcall-foreground-phone-call.mp4)
- [X] Add internal tester `populizator@googlemail.com`
- [X] Configure closed-testing countries and release: Alpha is active in 178 countries/regions
- [ ] Reach 12 closed-testing testers and run 14 days (the dashboard showed 2 on 2026-11-04)
  → User will add testers (`store/PLAY-TESTING.md`)
- [ ] Add Russian store listing translation (AI-assets disclosure confirmed as not AI)

# LastCall 1.0.7 / code21: segmented circle camera switch (published, verified)

Status: verified on the affected Vivo X200 Ultra. Segment recording plus a local Media3 merge replaces reliance on one persistent CameraX recording surviving a lens rebind.

- [X] Record a separate circle segment around each lens switch and merge them into one MP4
  → Artifacts: [composer](apps/mobile/src/components/MediaComposer.tsx), [merge wrapper](apps/mobile/src/video-merge.ts), [native module](apps/mobile/modules/lastcall-video/)
- [X] Verify native merge on an Android API36 emulator with differently sized H.264/AAC clips
  → Artifacts: [instrumentation test](apps/mobile/modules/lastcall-video/android/src/androidTest/java/ru/lastcall/video/CircleMergerTest.kt)
- [X] Publish test candidate 1.0.7/code21
  → Artifacts: [APK](https://p2p.lienad.ru/download/LastCall-1.0.7.apk), 54,155,814 bytes, SHA256 `c771d655edbaa0373848ae5d45d83f755baa520e9976d286186bbfab9bebe3b1`

# LastCall 1.0.6 / code20: camera-switch candidate (published, superseded)

Status: superseded by 1.0.7. CameraX 1.7.0-rc01, pause/resume and rebind without an explicit `unbindAll` still stopped on the affected device.

- [X] Add CameraX 1.7.0-rc01 force-resolution and pause/resume persistent recording around rebind
  → Artifacts: [patch](apps/mobile/patches/expo-camera+58.0.14+persistent-circle-camera.patch), [plugin](apps/mobile/plugins/withPersistentCircleCamera.cjs), [JS guard](apps/mobile/src/components/MediaComposer.tsx)
- [X] Publish test candidate 1.0.6/code20
  → Artifacts: [APK](https://p2p.lienad.ru/download/LastCall-1.0.6.apk), 54,017,237 bytes, SHA256 `d9bdd0f02ac3b38cc710ed140ac1a9a72e8245331ea53c3e896cb4a582191450`

# LastCall 1.0.4 / code18: English-primary localization (published)

Status: **1.0.4/code18 is published**. English is the default UI language;
Russian is selected when the phone's primary locale is Russian. Store submission
is still pending.

- [X] JS localization with English fallback and Russian device-locale selection
  → Artifacts: [i18n](apps/mobile/src/i18n.ts), [entry](apps/mobile/index.js), [tests](apps/mobile/tests/i18n.test.ts)
- [X] Native Android call/notification strings and localized permission metadata
  → Artifacts: [resources](apps/mobile/plugins/strings/), [plugin](apps/mobile/plugins/withLastCallStrings.cjs), [locale files](apps/mobile/locales/)
- [X] Publish direct 1.0.4: APK, signed latest.json and metadata
  → Artifacts: [release record](artifacts/README.md), [APK](https://p2p.lienad.ru/download/LastCall-1.0.4.apk), 53 967 857 bytes, SHA256 `ecc82e53fdbe835e42d9cdceff67b2b436fb16477d5d13fc829a40aa5b7c566e`

# LastCall 1.0.3 / code17: circle preview, camera continuity, emoji codes, store prep (published)

Status: **1.0.3/code17 is published** as a direct test build. Store publication is
prepared but not submitted; iOS/APNs and physical-device acceptance remain open.

- [X] Recorded-circle preview with playback and retake; CameraX 1.6.2 persistent-recording switch fix
  → Artifacts: [composer](apps/mobile/src/components/MediaComposer.tsx), [camera plugin](apps/mobile/plugins/withPersistentCircleCamera.cjs), [test](apps/mobile/tests/circle-camera-plugin.test.ts)
- [X] Five-emoji safety codes for chats and calls
  → Artifacts: [crypto](packages/core/src/content-crypto.ts), [safety modal](apps/mobile/src/components/SafetyCode.tsx), [call UI](apps/mobile/src/components/CallOverlay.tsx)
- [X] In-app account deletion and privacy policy
  → Artifacts: [server](apps/server/src/directory.ts), [services](apps/server/src/services.ts), [settings](apps/mobile/src/app/(tabs)/settings.tsx), [privacy](docs/PRIVACY-RU.md)
- [X] Store build mode, signing injection, store assets and release checklist
  → Artifacts: [config](apps/mobile/app.config.ts), [signing plugin](apps/mobile/plugins/withReleaseSigning.cjs), [store guide](docs/STORE-RELEASE.md), [assets](store/)
- [X] Publish direct 1.0.3: APK, signed latest.json and metadata
  → Artifacts: [release record](artifacts/README.md), [APK](https://p2p.lienad.ru/download/LastCall-1.0.3.apk), 55 083 537 bytes, SHA256 `4e8c457afff0467206bfa160083b4148db0ffe13a647fedcd089d5c5b57243a8`

# LastCall 1.0.2 / code16: E2E content, verified updates, server hardening (published)

Status: **1.0.2/code16 is published** with the existing test certificate. Both
peers must update before exchanging content; there is no plaintext fallback.
Independent QA and native acceptance on physical phones remain pending.

- [X] Session-level E2E content encryption for text/files/voice/circles/application frames (ephemeral X25519 + Ed25519-signed hello + HKDF + XChaCha20-Poly1305, replay rejection)
  → Artifacts: [cipher](packages/core/src/content-crypto.ts), [session](packages/core/src/session.ts), [tests](packages/core/src/content-crypto.test.ts), [session tests](packages/core/src/content-session.test.ts)
- [X] Safety number for direct chats and call verification code; persist verified contacts in encrypted state
  → Artifacts: [modal](apps/mobile/src/components/SafetyCode.tsx), [chat](apps/mobile/src/app/chat/[id].tsx), [call overlay](apps/mobile/src/components/CallOverlay.tsx), [state](packages/core/src/messenger.ts)
- [X] Signed update manifest, in-app APK download, SHA-256 verification and system installer
  → Artifacts: [signer](infra/sign-update-manifest.mjs), [manifest](infra/public/latest.json), [client](apps/mobile/src/updates.ts), [notice](apps/mobile/src/components/UpdateNotice.tsx)
- [X] Trust X-Forwarded-For only from configured proxies; per-IP limits and IPv6 /64 aggregation
  → Artifacts: [client-ip](apps/server/src/client-ip.ts), [server](apps/server/src/server.ts), [config](infra/compose.public.yaml), [tests](apps/server/test/client-ip.test.ts)
- [X] Clear plaintext preview/share caches; update Expo/RN/React and remove high advisories
  → Artifacts: [attachments](apps/mobile/src/attachments.ts), [layout](apps/mobile/src/app/_layout.tsx), [package](apps/mobile/package.json)
- [X] Publish 1.0.2: tests, APK, SHA256, signed manifest and metadata
  → Artifacts: [release record](artifacts/README.md), [APK](https://p2p.lienad.ru/download/LastCall-1.0.2.apk), 55 077 273 bytes, SHA256 `fbc3169483a469664f2fd6e7e9912b3f4a0853a16bab73524f37934d8e1777be`

# LastCall 1.0.1 / code15: first release (published)

Status: **1.0.1/code15 is published** with the existing test certificate. The
1.0.0 candidate and rc2 builds are superseded and were never final releases.
Independent QA and native acceptance on physical phones remain pending and are
not claimed. Prior 0.7.2 run is archived unchanged; no history reset.

- [X] Keep live video visible with native Android PiP and timed call controls (msg-huh)
  → Artifacts: [PiP plugin](apps/mobile/plugins/withLastCallPip.cjs), [PiP sources](apps/mobile/plugins/pip/), [PiP bridge](apps/mobile/src/call-pip.ts), [PiP model](apps/mobile/src/call-pip-model.ts), [controls model](apps/mobile/src/video-controls-model.ts), [panel](apps/mobile/src/components/CallOverlay.tsx), [PiP checks](apps/mobile/tests/with-last-call-pip.test.ts), [call UI checks](apps/mobile/tests/call-ui.test.ts)
- [X] Switch front/rear call camera and record a continuous Android circle across the switch (msg-unx)
  → Artifacts: [expo-camera patch](apps/mobile/patches/expo-camera+58.0.14+persistent-circle-camera.patch), [patch plugin](apps/mobile/plugins/withPersistentCircleCamera.cjs), [call camera](apps/mobile/src/call-camera.ts), [call camera model](apps/mobile/src/call-camera-model.ts), [composer](apps/mobile/src/components/MediaComposer.tsx), [patch checks](apps/mobile/tests/circle-camera-plugin.test.ts)
- [X] Fix failed call-audio switches and stale errors after successful routing (msg-kfr)
  → Artifacts: [audio bridge](apps/mobile/src/call-audio.ts), [audio model](apps/mobile/src/call-audio-model.ts), [native routes](apps/mobile/plugins/calls/LastCallAudioRoutes.java), [route checks](apps/mobile/tests/call-audio.test.ts), [call UI](apps/mobile/src/components/CallOverlay.tsx)
- [X] Fix incoming video showing the local camera for streamless remote tracks (msg-4s6)
  → Artifacts: [session](packages/core/src/session.ts), [client wiring](packages/core/src/messenger.ts), [native factory](apps/mobile/src/native.ts), [panel guard](apps/mobile/src/components/CallOverlay.tsx), [checks](packages/core/src/video.test.ts)
- [X] Register FCM wake and background sync without notification permission (msg-vtd)
  → Artifacts: [token](apps/mobile/src/notifications.ts), [push bridge](apps/mobile/src/components/PushBridge.tsx), [background task](apps/mobile/src/background-notifications.ts)
- [X] Publish first LastCall 1.0.1 with default endpoint p2p.lienad.ru (msg-oq0)
  → Artifacts: [release record](artifacts/README.md), [APK](https://p2p.lienad.ru/download/LastCall-1.0.1.apk), [phone tasks](docs/TESTING-RU.md), 54 995 081 bytes, SHA256 `a7d1f61d08ba13bc1dda168c831d58ea041ca3468a181c5af9a557c318aca41e`

# LastCall 0.7.2: voice waveform, mixed timeline and Android call audio (published 2026-10-31)

- [X] Real live microphone waveform with bounded history; recording/cancel lifecycle (msg-cmg)
  → Artifacts: [composer](apps/mobile/src/components/MediaComposer.tsx), [waveform](apps/mobile/src/components/RecordingWaveform.tsx), [level model](apps/mobile/src/waveform-model.ts), [checks](apps/mobile/tests/waveform.test.ts)
- [X] One chronological text/voice/file/photo/circle timeline; preserve new direct-file creation time through queue/restart/replay (msg-0tw)
  → Artifacts: [timeline](apps/mobile/src/timeline-model.ts), [chat](apps/mobile/src/app/chat/[id].tsx), [timing](packages/core/src/direct-file.ts), [queue regressions](packages/core/src/direct-file.test.ts), [timeline checks](apps/mobile/tests/timeline.test.ts)
- [X] Incoming/outgoing Android earpiece/speaker/connected-headset selection with observed state and stale-call guards (msg-5bn)
  → Artifacts: [call UI](apps/mobile/src/components/CallOverlay.tsx), [controller](apps/mobile/src/call-audio-model.ts), [native routes](apps/mobile/plugins/calls/LastCallAudioRoutes.java), [checks](apps/mobile/tests/call-audio.test.ts)

Implementation and gates verified: native Java/release/packaged FCM PASS; independent [QA1/6](docs/reports/testing/2026-10/media-audio/claude-qa-cycle-1.md),363unit/11browser PASS/1TURN skip; [focused native evidence](docs/reports/debugging/2026-10/native-072.md) covers observed speaker on incoming/outgoing direct calls, captured/delivered voice and mixed text/voice/file order. APK0.7.2/code12 published; all3fullHTTPS downloads match exact bytes/hash in [release record](artifacts/README.md). New run cap6; [old history preserved](docs/qa/runs/lastcall-060-qa-2026-10-30.json).

- [ ] Physical Android waveform response/heard quality and incoming/outgoing audio/video earpiece↔speaker/BT/wired hotplug; emulator has no earpiece/headset (msg-qlk)
  → Artifacts: [focused phone tasks](docs/TESTING-RU.md), [native limits](docs/reports/debugging/2026-10/native-072.md)
- [ ] iOS native audio-route adapter and signed-device acceptance; chooser currently hidden/unsupported (msg-uhw)
  → Artifacts: [mobile guide](apps/mobile/README.md)

Existing physical Pixel/Vivo video, Russian carriers/handover, DPI and iOS/APNs acceptance remains open (`msg-si6`, `msg-3z9`, `msg-9rr`).

# Claude QA configuration (msg-tan)

- [X] Dedicated risk-based tester, three required skills and documented six-cycle protocol
  → Artifacts: [prompt](docs/qa/lastcall-release-tester.md), [protocol](docs/qa/CLAUDE-TESTER.md)
- [X] Verify authenticated tester/settings: cycle2/6 PASS,264unit tests and9browser scenarios;1TURNskip
  → Artifacts: [counter](docs/qa/claude-qa-state.json), [cycle1 auth blocker](docs/reports/testing/2026-10/claude-qa-cycle-1.md), [cycle2 verified results](docs/reports/testing/2026-10/claude-qa-cycle-2.md)
- [X] Show actual local agent stages, six-cycle history and stale/disconnected evidence without raw traces (msg-mio)
  → Artifacts: [monitor](infra/qa/monitor.mjs), [panel](infra/qa/monitor.html), [focused checks](infra/qa/monitor.test.mjs), [verification](docs/reports/testing/2026-10/live-monitor.md), [run instructions](docs/qa/CLAUDE-TESTER.md#local-progress-panel)

# LastCall 0.7.1: authenticated call invite and stable video (published 2026-10-31)

- [X] Implement call invite, media gating, full-screen access and video stability (msg-d1e, msg-si6)
  → Artifacts: [wake contract](docs/WAKE-CONTRACT.md), [call-invite report](docs/reports/debugging/2026-10/call-invite-071.md)
- [X] Independent Claude QA cycles4–6/6: cycle4 full commands BLOCKED at280s; cycle5 source review PASS; cycle6 build/types/final-APK PASS (msg-tan)
  → Artifacts: [cycle4](docs/reports/testing/2026-10/claude-qa-cycle-4.md), [cycle5](docs/reports/testing/2026-10/claude-qa-cycle-5.md), [cycle6](docs/reports/testing/2026-10/claude-qa-cycle-6.md)
- [X] Guard Android push release across every Expo/Gradle stage with packaged FCM/version/code gate (msg-c5v)
  → Artifacts: [helper](infra/build-android-release.sh), ignored positive log `.tmp/current/native-071-cycle7/release.log`
- [X] Fix SDK58 `dataString:null` wrapper rejection; normalize only known null field, installed-serializer fixtures; 81mobile/10monitor PASS (msg-el9)
  → Artifacts: [cycle7](docs/reports/testing/2026-10/claude-qa-cycle-7.md), [mobile tests](apps/mobile/tests/call-pushes.test.ts)
- [X] Explicit owner approval added exactly one cycle7/7; history1–6 preserved, no cycle8 (msg-tan)
  → Artifacts: [cycle7 report](docs/reports/testing/2026-10/claude-qa-cycle-7.md)
- [X] Real Android17 native PASS: cold FCM PIN ring7.984s, answer16.527s, direct RTP active at66s from call start, cancel1.637s; publish0.7.1 and verify all3 exact downloads (main)
  → Artifacts: [native report](docs/reports/debugging/2026-10/native-071-cycle7.md), [release record](artifacts/README.md)
- [X] Historical pre-extension candidate3d native FAIL retained; local file moved to ignored `.tmp/current/native-071-cycle7/prior-cycle6.apk`
  → Artifacts: [historical FAIL report](docs/reports/debugging/2026-10/native-071.md)
- [ ] Physical Pixel/Vivo voice/video quality, Russian carriers/handover, DPI and iOS/APNs/CallKit remain open (msg-3z9, msg-9rr, msg-si6)
  → Artifacts: [phone tasks](docs/TESTING-RU.md); emulator audio was disabled, so heard speech is not claimed

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
