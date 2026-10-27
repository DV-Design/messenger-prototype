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
