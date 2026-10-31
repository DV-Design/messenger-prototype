# LastCall Android preview 0.7.2

- Download: https://lienad.ru/messenger/download/LastCall-0.7.2.apk
- Alternate: https://p2p.lienad.ru/download/LastCall-0.7.2.apk
- Preview alias: https://lienad.ru/messenger/download/messenger-preview.apk
- Local: `artifacts/LastCall-0.7.2.apk` (ignored binary)
- Package `dev.messenger.prototype`, version0.7.2, versionCode12, label LastCall
- ARM64, Android API24 minimum / target36 / compile37; same existing internal test certificate
- Size:54,979,729 bytes
- SHA256:`d5d0839ad0004c6476710e2ad4369c67f322d0c87ad418f1d1689a82bd73a951`
- Signing certificate SHA256:`fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c`

Published binary and preview alias were copied atomically before the updated
page. Full primary, alternate and preview-alias HTTPS downloads all matched the
exact size/hash above. Update both phones in place without deleting identity or
history; historical0.7.1 remains available.

`npm run build:apk` passed native Java/release assembly, forced JavaScript bundle
regeneration and packaged `nativeFcmConfigured=true`, version0.7.2/code12 gates.
Independent [QA1/6](../docs/reports/testing/2026-10/media-audio/claude-qa-cycle-1.md)
passed363unit (95mobile/71server/197core),11browser/1TURN-environment-skip,
all types/builds and Android+iOS JavaScript exports; lint0errors/one pre-existing
VoiceNote warning. New owner-authorized run has six allocations maximum; prior
history and its explicit one-off extension remain archived, not erased.

Changes: actual microphone-level waveform during voice capture; chronological
text/voice/file/photo/circle rows and latest-chat preview; original creation time
for new direct attachments across delayed/retried delivery; Android incoming and
outgoing audio output chooser showing observed available communication devices.
Legacy queued metadata is preserved for lost-ACK replay compatibility.

[Focused Android17 native acceptance](../docs/reports/debugging/2026-10/native-072.md)
verified in-place identity/history preservation, incoming/outgoing active/direct
bidirectional RTP with the actual speaker selected, voice capture and full
108744-byte delivery, and text→voice→text→file→text order. The AVD exposes no
earpiece/headset and was muted: no physical switching, microphone-amplitude
reaction or heard intelligibility is claimed. Fresh background/lockscreen/video
acceptance was not repeated; historical0.7.1 evidence below stays historical.
Physical Android metering/routes (`msg-qlk`), iOS adapter (`msg-uhw`), physical
video/Russian carriers/handover/OEM and APNs remain open. [Phone tasks](../docs/TESTING-RU.md).

---

# Historical LastCall Android preview 0.7.1

- Download: https://lienad.ru/messenger/download/LastCall-0.7.1.apk
- Alternate: https://p2p.lienad.ru/download/LastCall-0.7.1.apk
- Preview alias: https://lienad.ru/messenger/download/messenger-preview.apk
- Local: `artifacts/LastCall-0.7.1.apk` (ignored binary)
- Package `dev.messenger.prototype`, version0.7.1, versionCode11, label LastCall
- ARM64, Android API24 minimum / target36 / compile37; same existing internal test certificate
- Size:54,949,929 bytes
- SHA256:`a47c676b25b59ede87ca7cd3ad0fe067f52c2fe58957e342388166c622b1d53a`
- Signing certificate SHA256:`fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c`

The native release APK is published. Primary, alternate and preview-alias HTTP
downloads all matched the exact54,949,929bytes and SHA256 above. Update both
phones in place without deleting identity or history.

The owner explicitly approved exactly one extra QA allocation; cycles1–6 remain
historical, cycle7/7 ran with base6/effective7, and cycle8 is not authorized.
Cycle7 PASS covered81mobile/10monitor tests plus mobile tsc/lint0 errors; the full
340-unit/11-browser/1-TURN-skip result stays attributed to cycle4, and no full
core/server/e2e rerun is claimed. See the
[cycle7 report](../docs/reports/testing/2026-10/claude-qa-cycle-7.md).

`msg-el9` is fixed: `call-push-model` normalizes only the known null `dataString`
wrapper before strict5/7 key counting, does not mutate input, checks raw size, and
still rejects unknown/non-null/conflicting fields. Faithful installed
`RemoteMessageSerializer` fixtures fail before and pass after.

Real Android17/API37.2 own-AVD acceptance passed on the same
`qa_native_071_1031` in-place upgrade. A true FCM cold start under PIN showed the
owned `LastCallCallActivity` at7.984s with the caller still connecting; native
answer reached active at16.527s after a deliberate15s RTC gate; direct
bidirectional RTP advanced from1429in/1489out to2443in/2502out over20s and was
still active at66.16s. Cancel without answer removed UI in1.637s, with no native
UI or AudioService and no microphone. The emulator audio output was disabled
(`fake Chrome audio` + `-no-audio`), so heard intelligibility is not claimed.
See [native 0.7.1 report](../docs/reports/debugging/2026-10/native-071-cycle7.md).

Limits: physical Pixel/Vivo voice/video quality, Russian carriers/handover, DPI,
OEM battery behavior and iOS/APNs/CallKit remain unverified. Cold ring at about
8s is not a universal instant-delivery promise. No DPI-invisibility claim.

---

# Historical LastCall Android preview 0.7.0

- Download: https://lienad.ru/messenger/download/LastCall-0.7.0.apk
- Alternate: https://p2p.lienad.ru/download/LastCall-0.7.0.apk
- Local: `artifacts/LastCall-0.7.0.apk` (ignored binary)
- Package `dev.messenger.prototype`, versionCode10, label LastCall
- ARM64, Android API24 minimum / target36; same existing internal test certificate
- Size:54,909,341 bytes
- SHA256:`ad39f92a0542ea5b90e05a3678a5475c1a8cddab2342f961a0f280da5757582f`
- Signing certificate SHA256:`fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c`

This historical 0.7.0 release was published. Actual downloads from the primary
URL, alternate URL and current-preview alias all matched the exact54,909,341bytes
and SHA256 above at that time. Update both peers in place without
deleting their installation identity or history; old strict receipt schemas are
not a downgrade-compatibility promise.

Calls use LastCall's own incoming UI and notification, with automatic self-managed
account registration on Android8+ rather than manual Phone-app setup. Android14+
full-screen notification permission still controls full-screen presentation. A
separate bounded call wake handles cold/suspended setup; an outgoing invitation
also requests wake after2.5s without a response even when RTC appears connected.
Push alone does not authorize ringing or microphone/camera capture.

Message/file indicators now separate clock (awaiting durable delivery), one check
(full recipient persistence) and two checks (actual foreground-chat read). Signed
P2P read receipts persist locally and replay to an offline author after reconnect;
groups show partial counts and require every intended recipient for full checks.
Preview display never constitutes delivery/read. Text, retained files and receipts
remain on participant devices; no server-content mailbox is introduced.

Video starts with a720p/30fps capture request and a1.8Mbit/s encoder ceiling,
leaving actual sending to WebRTC congestion control. Missing bandwidth estimates
and high base RTT no longer force the old low-resolution cap. This is a policy
change, not proof of perceived quality on physical phones. Voice/circle file
limits remain; a circle's hidden rectangular edges remain in the stored video.

Claude tester allocation3/6 PASS on Node24:63mobile+59server+170core=292unit
tests, Chrome10PASS/1explicit authenticated-TURNskip; lint0errors/one existing
VoiceNote warning, types and Android+iOS JavaScript exports PASS. See the
[cycle3 report](../docs/reports/testing/2026-10/claude-qa-cycle-3.md).
Native release assembly passed after an explicitly forced JS bundle regeneration.
An in-place0.6→0.7 API36 emulator installation preserved identity. LastCall's own
incoming activity appeared above PIN lock, without an active-audio service before
answer. Its own answer button activated the call/audio foreground service; RTP
counters increased in both directions from22in/22out to2629in/2626out after the
wake window. Incoming/setup services were no longer active while the audio service
remained active. Native timeout/reject cleanup was verified. After ordinary
process death (`am kill --user 0`), the old PID3514 was confirmed absent; FCM
cold-started PID4717 and the same owned incoming UI appeared above PIN at12.95s.
Warm/background samples were10.75–10.97s. These measured samples do not establish
instant delivery or physical-phone timing. The AVD ran with `-no-audio`: RTP proves
transport, not heard speech quality. API24/25 own-UI fallback is implemented but
was not emulated. See [exact native evidence](../docs/reports/debugging/2026-10/native-070.md).
Physical Android,
Russian carriers, OEM battery behavior, perceived video/voice quality and
iOS/APNs/CallKit remain separate acceptance work. No universal instant-delivery
or DPI-invisibility claim. See [phone tasks](../docs/TESTING-RU.md),
[wake contract](../docs/WAKE-CONTRACT.md) and [outbox contract](../docs/OUTBOX-CONTRACT.md).

## Rejected/unaccepted historical 0.7.1 candidates — never distribute

- **Pre-extension candidate** `e9c201...`: packaged `nativeFcmConfigured=false`;
  never published. Local ignored path: `.tmp/current/native-071/rejected-no-fcm.apk`.
- **Pre-extension candidate** SHA256
  `3d36731251871053711e48e0a9464a9259ffdd0024397d041cc412a253dd2122`,
  54,949,881 bytes: packaged FCM/version/code passed, but actual Android17 cold
  FCM showed no owned incoming UI within27s because the installed SDK serializer
  appended `dataString:null` and the strict5/7 parser rejected the6/8-key shape
  (`msg-el9`). It was never published. The old local file is now
  `.tmp/current/native-071-cycle7/prior-cycle6.apk`.
- These hashes remain **unaccepted history**, separate from the published
  `a47c676b...` build above. See the historical
  [FAIL report](../docs/reports/debugging/2026-10/native-071.md).

---

# Historical LastCall Android preview 0.6.0

- Download: https://lienad.ru/messenger/download/LastCall-0.6.0.apk
- Alternate: https://p2p.lienad.ru/download/LastCall-0.6.0.apk
- Local: `artifacts/LastCall-0.6.0.apk` (ignored binary)
- Package `dev.messenger.prototype`, versionCode9, label LastCall
- ARM64, Android API24 minimum / target36; same existing internal test certificate
- Size:54887217bytes
- SHA256:`43f0f5f50bc1f09f785c10e795724e1ed45608a1cf9ada67ed9afd3aa1ed1a0f`
- Signing certificate SHA256:`fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c`

Encrypted text/file-name push previews, authenticated notification tap routes,
Android Telecom lockscreen calls, P2P voice/circle files and fullscreen adaptive
video. Update both phones in place without deleting identity/history; enable
LastCall phone account once in Settings and grant notifications/mic/camera.
Circle UI crops the full rectangular stored video; hidden edges remain in the file.

Final root check:54mobile+59server+151core=264tests, lint/typecheck/build and
Android+iOS JavaScript exports PASS. Chrome9PASS/1explicit TURNskip. Final native
release/R8 build PASS; workspace-core bundle explicitly regenerated before assembly, signature,
package/version/ARM64 and server-key/temporary-trace scan PASS. Native/data/public
acceptance details: [report](../docs/reports/debugging/2026-10/native-060.md).
[Review](../docs/reports/code-reviews/2026-10/CR-2026-10-30-lastcall-060.md) and
[phone tasks](../docs/TESTING-RU.md). Physical carrier/OEM/voice quality and iOS/APNs
remain separate; no instant-delivery/DPI or production-crypto guarantee.

Both normal-DNS/TLS public versioned downloads match the exact local bytes/hash;
landing/tasks/research match source. Previous versioned installers retained for rollback. No Firebase Admin credential
is embedded. Android client Firebase resources are required and are public config.

---

# LastCall Android preview 0.5.1

- Download: https://lienad.ru/messenger/download/LastCall-0.5.1.apk
- Alternate: https://p2p.lienad.ru/download/LastCall-0.5.1.apk
- Local: `artifacts/LastCall-0.5.1.apk` (ignored binary)
- Package `dev.messenger.prototype`, versionCode7; upgrade both peers in place.
- Size **46,427,337 bytes**; ARM64, minimum API24, target API36.
- SHA256: `c454eeb8f057b8ab74dccfa6dbfe6b93358b6a9739001a9f5cb8e5999973dec7`
- Same internal test signing certificate SHA256:
  `fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c`.

Firebase FCM is connected using a dedicated FCM-only server account; credential
is external and read-only, never included in Git/APK/static downloads. Android
advertises background support only after task registration succeeds; old peers
retain the notification/tap path. New bounded9s background transport restores
an existing identity and drains persistence before disposal. Shared UI ownership
avoids competing storage instances. Bilateral application-ready negotiation
prevents payload loss before native JS channel listeners are installed.

Real FCM, own preserved Android emulator: Home + ordinary process death, text
and35-byte file both durable-ACKed without notification tap at5.728s; Launcher
remained foreground. Saved text/file present after manual offline process
restart. Cold wake/foreground takeover completed at6.786s. Tray notification
also observed. Identity/history preserved on upgrade.

Final root check PASS:195tests (20mobile,50server,125core), lint/types,
Android/iOS JS exports/server build. Chrome9PASS/1explicit TURN skip. Final
Android release/R8 build820tasks/29s. APK metadata/signature verified; temporary
native diagnostic instrumentation removed. Public signaling rebuilt from final
sources; existing profiles, TURN and unrelated services preserved.

The seven-day sender queue and peer group sync remain. Files larger than the
wake budget retry later as whole files. Force-stop needs manual opening;
physical Russian operators/battery policies, iOS/APNs and native system calls
remain unvalidated/unconfigured. No server content queue or universal instant
delivery claim. Detailed [native evidence](../docs/reports/debugging/2026-10/native-051-push.md)
and [review](../docs/reports/code-reviews/2026-10/CR-2026-10-29-background-push.md).

# Historical Android preview 0.5.0

- Download: https://lienad.ru/messenger/download/LastCall-0.5.0.apk
- Alternate: https://p2p.lienad.ru/download/LastCall-0.5.0.apk
- Local: `artifacts/LastCall-0.5.0.apk` (ignored binary)
- Package `dev.messenger.prototype`, versionCode6, same internal test certificate.
- Size **46,380,521 bytes**; ARM64, minimum API24, target API36.
- SHA256: `47e8e8dfa6c69932969b677b54aa408b53b02c1580a5aec5db1eb56cbe770b8d`

Encrypted sender-held text/file queue waits up to seven days with original
deadlines across restart. Durable receiver storage precedes ACK; group progress
tracks final recipients. Verified member phones synchronize creator-signed roster,
author-signed text/files and signed recipient receipts even while author is offline.
Files retry whole bytes after reconnect; no chunk-offset resume claim. Limits:
5MiB/file,16 retained attachment blobs/40MiB total,100 pending texts, group8.
Delivered file history occupies this preview capacity; removal UI remains pending.

Native reachable-network observer invokes directory/signaling recovery and ICE
restart, retaining PC/live tracks within a ten-second application recovery budget.
Secret-token signaling resume retains roles; explicit leave frees state immediately.
This is not uninterrupted sound without network or verified cross-carrier service.
Public TURN is not deployed. No DPI invisibility or unconditional delivery claim.

Firebase project LastCall (`lastcall-f8b4c`) created on Spark without Analytics;
Android client registered and externally stored config included in native prebuild
and JS/native build. Server FCM key is not issued: awaiting explicit user approval
for the dedicated FCM-only account/key. Server push remains disabled; APNs/system
incoming calls remain unconfigured. No Admin credential included in APK or Git.

Final Node24 check PASS: **160 tests** (101core,46server,13mobile), lint/typecheck,
Android+iOS JS exports/server build. Chrome **9PASS/1explicit TURN skip**,27.5s:
exact file bytes and queue after restart, author-offline member synchronization,
same PC/live tracks plus changed ICE ufrag/stable signaling/bounded offers and
growing inbound audio packet count after recovery. Initial full-suite explicit
leave regression was corrected and original survivor assertion preserved.

Clean native release/R8/lint PASS:820tasks,3m4s; final reviewed fresh-Hermes build
30s. Packaged bytecode equals final generated bundle and is newer than final
source fixes. Backup=false, no READ_CONTACTS/WRITE_CONTACTS, Firebase messaging
services present; microphone/camera/notification permissions present. Signature
SHA256 `fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c`.

Public server8e843549b275 deployed independently of unrelated services; profile
volume preserved and rollback image0.4 retained. Normal-DNS/TLS health, encrypted
WSS exchange and username/catalog/resolver smoke PASS after final deployment.
Native upgrade/file/network evidence and public download comparison are recorded
in [native report](../docs/reports/debugging/2026-10/native-050.md) and
[review](../docs/reports/code-reviews/2026-10/CR-2026-10-28-lastcall-05.md).

Native Owner0 upgrade preserved username and six old messages. Actual Android
picker queued a29-byte file offline; force-stop/reopen restored file plus text
before recipient returned, then exact bytes and delivery ACK were verified. One
own-emulator Wi-Fi→CELLULAR→Wi-Fi cycle recovered direct text/ACK automatically.
No live native call/audio timing or physical carrier test is claimed. Own QA
browser/AVD exited, Wi-Fi restored, userdata retained. Both public HTTPS versioned
APKs were downloaded through normal DNS/TLS and match the local SHA/bytes exactly;
published landing/tasks/research files also match sources. Old APKs are retained.

# Historical Android preview 0.4.0

- Download: https://lienad.ru/messenger/download/LastCall-0.4.0.apk
- Alternate: https://p2p.lienad.ru/download/LastCall-0.4.0.apk
- Local: `artifacts/LastCall-0.4.0.apk` (ignored binary)
- Package `dev.messenger.prototype`, versionCode 5; same internal test certificate.
- Size **46,326,513 bytes**; ARM64, minimum API 24, target API 36.
- SHA256: `b6dbc5e508e908774772a65252e0de4cda675e7bc514b7e1be6a84d8d8f94394`

Server-confirmed immutable username per installation key, canonical profile
recovery and paginated server catalog/name search replace phone registration.
No SMS account or phonebook permission is needed. Includes the user's satellite
logo with reduced margins and automatic first-launch microphone/camera/photo/
notification permission sequence before registration. Declining a permission does
not prevent the remaining requests; already granted permissions do not re-prompt.

Direct-first typed message/file/call wake is implemented and tested with private
providers. **Firebase/APNs remain unconfigured**, so real push/background calling
is not claimed. File readiness wait <=60s retains sender memory only; actual
transfer has its existing ACK timeout. Calls wait <=30s and can be cancelled before
P2P starts. Public TURN is still pending. No unconditional instant-delivery claim.

Node24 lint/types/tests/build: **113 PASS**. Chrome interoperability **6 PASS / 1
explicit TURN skip**. Clean Android release/R8/lint: 819 tasks, 5m26s; final fresh
Hermes build after review fixes: 28s. APK embeds exactly that generated bytecode
with HTTPS default, with a timestamp later than final core/mobile edits. Final
signature/version/ARM64/min24/target36/backup=false verified. READ_CONTACTS and
WRITE_CONTACTS absent; CAMERA/RECORD_AUDIO/POST_NOTIFICATIONS present. Generated
launcher adaptive XML references the logo through a native12% safe-zone inset.
Same certificate SHA256:
`fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c`.

Android+iOS JS exports PASS; no signed native iOS artifact. Public normal-DNS/TLS
username/catalog/resolve/Cyrillic-search smoke PASS on both hostnames. Native code4
upgrade and fresh synthetic Android-profile permission checks recorded separately.

Both published HTTPS APKs were downloaded through ordinary DNS/TLS and compared
byte-for-byte with the verified local file. Upgrade retained the original native
profile and six-message conversation. Fresh isolated Android user: microphone
prompt appeared automatically before registration, denial continued to camera and
notification prompts; photos were already granted, so no photo popup is claimed.
Notification permission works without falsely claiming configured FCM. Satellite
icon appeared in onboarding/launcher; restart did not repeat automatic prompts.
Cancelled offline outgoing call closed immediately and did not start later.

[Native evidence](../docs/reports/debugging/2026-10/native-040.md) ·
[Review](../docs/reports/code-reviews/2026-10/CR-2026-10-28-lastcall-04.md) ·
[Testing tasks](../docs/TESTING-RU.md) ·
[P2P/push options](../docs/P2P-WAKE-RESEARCH-RU.md)

# LastCall Android service preview 0.3.0 (historical)

- Download: https://lienad.ru/messenger/download/LastCall-0.3.0.apk
- Alternate: https://p2p.lienad.ru/download/LastCall-0.3.0.apk
- Local: `artifacts/LastCall-0.3.0.apk` (ignored binary)
- Package `dev.messenger.prototype`, versionCode 4, same internal test certificate.
- Size **44,637,258 bytes**; arm64, minimum Android API 24, target API 36.
- SHA256: `7bf3d634aaa60ceb2884ecb49086a8b44137ecb6c24c61cb52f43e0ce09dd645`

Phone verification/discovery and FCM integration are implemented, but the actual
Firebase/SMS.ru accounts are not configured. This APK has **no Firebase Android
client configuration** and explicitly reports push unavailable. The server reports
SMS unavailable. It does not yet fix closed-app notification delivery or provide
actual phone matching; a configured rebuild and real delivery tests are required.
Public TURN is also not deployed.

Clean native release/R8/lint PASS: 819 tasks, 3m07s. Verified final signature,
code4/package/label, ARM64/min24/target36, embedded Hermes bytecode/default HTTPS,
READ_CONTACTS/CAMERA/RECORD_AUDIO, absence of WRITE_CONTACTS and disabled backup.
POST_NOTIFICATIONS is present through the notification dependency; its manifest
presence is not proof of configured push. Certificate SHA256:
`fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c`.

Root lint/types/build and **85 tests** PASS; real Chrome **6 PASS/1 TURN skip**.
Android/iOS JavaScript exports PASS; no signed native iOS artifact. Production
server audit reports 0 advisories. Public server normal DNS/TLS/directory/service
smoke PASS on both hostnames with genuine disabled-provider status.

Downloaded the published APK from both HTTPS hostnames through normal DNS and
verified exact equality with the signed local file. Upgrade from code3 preserved
the native QA identity/history/permissions; current messages and recipient ACK
passed in both directions, and all six messages survived process relaunch.
Versioned 0.2.1/0.2.0/0.1.0 installers remain available for rollback.

[Native upgrade evidence](../docs/reports/debugging/2026-10/native-services.md) ·
[Review](../docs/reports/code-reviews/2026-10/CR-2026-10-28-services.md) ·
[Testing tasks](../docs/TESTING-RU.md)

# LastCall Android diagnostic preview 0.2.1

- Download: https://lienad.ru/messenger/download/LastCall-0.2.1.apk
- Samepackage `dev.messenger.prototype`, versionCode3, same testcertificate.
- Size43,758,960bytes, arm64, Android7+.
- SHA256: `dc1b3dff9e8f03f07267c914594fc9646857c86ee6a0871896e05efece8923b5`

This is an interim diagnostic/contact-permission update. It does NOT implement
closed-app push delivery, automatic verified-phone discovery or a publicrelay.
Those requirements were clarified during this session and require configured
FCM/SMS services plus relay infrastructure. Do not present0.2.1 as fixing them.

Verified finalsignature/version/embeddedJS+defaultHTTPSbase, READ_CONTACTS,
CAMERA/RECORD_AUDIO, noWRITE_CONTACTS; fullnative release+R8 PASS. Downloadedpublic
HTTPSAPK equals localverifiedbytes. Actualemulatorupgradepreservedidentity/history;
permissioncenter persistedonce, contactsALLOW→cameraDENY→microphoneALLOW, photos
alreadygranted(nofourthprompt); native phonebook read displayedownsyntheticcontact.
ForegroundbidirectionalP2P andrecipientACK PASS, includingrestart. This isnotphysical
carrier/backgroundtesting. [Evidence](../docs/reports/debugging/2026-10/native-delivery.md).

Root59tests+lint/types/buildPASS; Chrome6PASS/1TURNskip.
Previousversionedinstallersretainedforrollback; downgrademayneedAndroidhandling.

# LastCall Android preview 0.2.0

- Download: https://lienad.ru/messenger/download/LastCall-0.2.0.apk
- Alternate hostname: https://p2p.lienad.ru/download/LastCall-0.2.0.apk
- Local file: `artifacts/LastCall-0.2.0.apk` (ignored binary)
- Package: `dev.messenger.prototype`, versionCode 2, label LastCall
- Architecture: arm64-v8a; minimum Android API 24, target API 36
- Size: 43,572,672 bytes
- SHA-256: `132238b8bce0c80e0f2b4b85cf3f193c7be351839c2584d0851acc2d5260836b`

Standalone release APK with embedded Hermes JavaScript and HTTPS base URL
`https://lienad.ru/messenger`. No Metro/Expo Go needed. Same internal test signing
certificate as0.1: SHA256
`fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c`.
Install as an update without deleting the prior app. This is not a store signature.

Final clean native build passed:819tasks, R8 and release lint enabled. Verified v2
APK signature, package/version/label/ARM64, embedded JS+URL, CAMERA and RECORD_AUDIO
permissions, Android backup disabled. ImagePicker global permission-removal conflict
was corrected before this release; regenerated manifests inspected, including iOS
camera/microphone usage descriptions through Expo introspection.

Downloaded the versioned public HTTPS file through normal OS DNS and validated
byte-for-byte equivalence with the verified local APK. Both public hostnames serve
it; apex application outside /messenger remains unchanged. Previous0.1 installer
retained at `download/LastCall-0.1.0.apk`, SHA256
`0191098333077d5e3238b63c65fa7681209b98d0d295e791489cbb28c1e834ff`.
Rollback installation may require Android's explicit downgrade handling; do not
uninstall casually, because local identity/history can be lost.

Root lint/typecheck/test/build passed (30core+20server tests); real Chrome scenarios
6passed/1TURNskip plus final group-recipient-file regression passed. Native physical
phone behavior still requires user testing. No signed iOS IPA, background incoming
call guarantee, Russian operator audio/DPI result or independent crypto audit.

[Testing tasks](../docs/TESTING-RU.md) · [Review](../docs/reports/code-reviews/2026-10/CR-2026-10-27-lastcall-v2.md)
