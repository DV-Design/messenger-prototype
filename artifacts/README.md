# LastCall Android service preview 0.3.0

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
