# Android internal preview 0.1.0

- Download: https://p2p.lienad.ru/download/messenger-preview.apk
- Local file: `artifacts/messenger-preview.apk` (ignored binary)
- Package: `dev.messenger.prototype`, versionCode 1
- Architecture: arm64-v8a; minimum Android API 24, target API 36
- Size: 36,108,047 bytes
- SHA-256: `0191098333077d5e3238b63c65fa7681209b98d0d295e791489cbb28c1e834ff`

Standalone release APK with embedded Hermes JavaScript. Signed with the Expo
template Android debug certificate for internal installation, not store release.
APK Signature Scheme v2 verified with Android apksigner. Android system backup is
disabled. This internal laboratory build explicitly permits private-LAN HTTP;
the default public signaling endpoint is HTTPS `https://p2p.lienad.ru`.

Local native `:app:assembleRelease` passed (602 tasks), including R8 and release
lint. Inspected package metadata, ARM64 libraries, embedded JS and manifest.
Downloaded the published HTTPS file and compared bytes with the local artifact.
Phone runtime behavior still requires user testing; native compilation and browser
WebRTC checks do not prove real-device audio quality or censorship resistance.

See [testing tasks](../docs/TESTING-RU.md). iOS signing/distribution is separate.
