---
name: lastcall-devsecops
description: Release, deploy, and operate LastCall safely — Android APK build/signing/publish, static update manifest, Docker/Caddy/TURN changes, rollback, and secret handling.
---

# LastCall DevSecOps

Use this skill for release builds, server deployment, public static files, TURN, and incident work. Always verify before publishing; never print or commit credentials.

## Release checklist

1. Bump `apps/mobile/app.config.ts` (`version`, `android.versionCode`, `ios.buildNumber`), root and mobile `package.json` versions, and refresh the lockfile.
2. Run `npm run check` and `npm run test:e2e`.
3. Build with the external Firebase client config:
   ```sh
   export JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home
   export ANDROID_HOME="$HOME/Library/Android/sdk"
   export MESSENGER_GOOGLE_SERVICES_FILE="$HOME/.config/lastcall/google-services.json"
   npm run build:apk
   ```
   The script verifies packaged `version`, `versionCode` and `nativeFcmConfigured=true`, then prints size/SHA256.
4. Verify the APK independently: `apksigner verify --print-certs`, `aapt2 dump badging`, and compare the signing certificate with the previous release.
5. Sign `infra/public/latest.json` with `node infra/sign-update-manifest.mjs` using the offline key at `~/.config/lastcall/update-signing.key` (0600; back it up encrypted outside the repo). Publish atomically to `~/server/proxy/sites/messenger-public/download/` (APK, `.sha256`, preview alias) and only then replace `download/latest.json`. The signed manifest fields are `android.version`, `versionCode`, HTTPS `url`, optional `alternateUrl`, `sha256`, optional `notes`, and `signature`. If the signing key is lost, existing apps will reject all future manifests; plan a key-rotation release before that happens.
6. Download the published APK over both HTTPS hosts and compare size/SHA256. Verify `latest.json` is `application/json`.
7. Update `README.md`, `artifacts/README.md`, `docs/TESTING-RU.md`, `infra/public/SERVICES.md`, `infra/public/index.html` and `tasks.md`; commit and push. Never publish an unreviewed APK as an accepted release.

## Server deployment

- Signaling runs on the `proxy` Docker network with no published host port; only Caddy exposes 80/443.
- `TRUSTED_PROXY_CIDRS` must match the actual Docker network (currently `172.18.0.0/16`) or per-IP limits collapse to the Caddy address. Do not trust `X-Forwarded-For` from the public internet.
- Apply config changes with `docker compose ... config --quiet`, validate Caddy, reload gracefully, then check `/health`, `/ice`, directory and WSS.
- Preserve the `directory` volume and the existing Caddy routes for other lienad.ru applications. Keep the previous versioned APK for rollback.
- TURN uses HMAC credentials (600 s) and authenticated issuance. Renew the certificate before 2027-01-25; the native service requires a scheduled start after reboot.

## Host-only checks

macOS firewall/stealth, exposed dev ports, SSH guards, disk pressure and the signing-key backup are host concerns, not repository state. Report them separately and get explicit approval before changing the live proxy/firewall.

## Incident rules

- Do not rotate or delete the `directory` volume to fix connectivity.
- Do not unpublish versions silently; retain one rollback APK and document the reason.
- If a signing key or Firebase/TURN secret may have leaked, stop publishing, rotate the affected credential, and update `latest.json` only after a clean rebuild.
