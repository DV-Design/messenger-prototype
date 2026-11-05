#!/usr/bin/env bash
#
# Reproducible Google Play AAB build.
#
# Enforces the store distribution, matching Firebase client config, upload-key
# signing, and verifies the packaged constants after assembly. Never uploads or
# copies the AAB. Credentials stay outside the repository.
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd -P)"
MOBILE_DIR="$REPO_ROOT/apps/mobile"
ANDROID_DIR="$MOBILE_DIR/android"
AAB_PATH="$ANDROID_DIR/app/build/outputs/bundle/release/app-release.aab"
PACKAGE=ru.lastcall.app
VERSION=1.0.14
VERSION_CODE=28

die() { printf 'build:aab: ERROR: %s\n' "$*" >&2; exit 1; }
command -v node >/dev/null || die "node is required"
command -v npx >/dev/null || die "npx is required"
command -v unzip >/dev/null || die "unzip is required"
command -v jq >/dev/null || die "jq is required"
command -v java >/dev/null || die "java is required"
JAVA_HOME_DETECTED="$(java -XshowSettings:properties -version 2>&1 | awk -F'= ' '/java.home =/{print $2; exit}')"
JARSIGNER="$JAVA_HOME_DETECTED/bin/jarsigner"
[[ -x "$JARSIGNER" ]] || die "jarsigner was not found under the active Java runtime"
command -v bundletool >/dev/null || die "bundletool is required"

[[ -z "${LASTCALL_CAPTION_TEST_AUDIO:-}" ]] || die "LASTCALL_CAPTION_TEST_AUDIO must not reach a store build"
SERVICES_FILE="${MESSENGER_GOOGLE_SERVICES_FILE:-}"
[[ -n "$SERVICES_FILE" ]] || die "MESSENGER_GOOGLE_SERVICES_FILE is not set"
[[ "$SERVICES_FILE" = /* && -f "$SERVICES_FILE" && -r "$SERVICES_FILE" ]] || die "Firebase client config must be a readable absolute path"
case "$SERVICES_FILE" in "$REPO_ROOT"/*) die "Firebase client config must stay outside the repository" ;; esac
PACKAGES="$(jq -r '.client[].client_info.android_client_info.package_name' "$SERVICES_FILE")"
grep -qx "$PACKAGE" <<<"$PACKAGES" || die "Firebase config does not contain $PACKAGE"
if grep -qx 'dev.messenger.prototype' <<<"$PACKAGES"; then
  printf 'build:aab: warning: Firebase config still contains the direct-test package; use the Play-only file if possible.\n'
fi

if [[ -z "${LASTCALL_RELEASE_KEYSTORE:-}" ]]; then
  PROPERTIES="$HOME/.config/lastcall/keystores/lastcall-upload.properties"
  [[ -f "$PROPERTIES" ]] || die "Set LASTCALL_RELEASE_KEYSTORE or provide $PROPERTIES"
  set -a; . "$PROPERTIES"; set +a
fi
for name in LASTCALL_RELEASE_KEYSTORE LASTCALL_KEYSTORE_PASSWORD LASTCALL_KEY_ALIAS LASTCALL_KEY_PASSWORD; do
  [[ -n "${!name:-}" ]] || die "$name is not set"
done

export LASTCALL_DISTRIBUTION=store
export LASTCALL_ANDROID_PACKAGE="$PACKAGE"
export LASTCALL_IOS_BUNDLE_ID="$PACKAGE"
export MESSENGER_GOOGLE_SERVICES_FILE="$SERVICES_FILE"
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
[[ -d "$ANDROID_HOME" ]] || die "ANDROID_HOME does not exist"

printf 'build:aab: [1/3] Expo prebuild (store)\n'
(cd "$MOBILE_DIR" && npx --no-install expo prebuild --platform android --no-install)

printf 'build:aab: [2/3] bundle JavaScript and assemble release AAB\n'
(cd "$ANDROID_DIR" && ./gradlew :app:createBundleReleaseJsAndAssets --rerun-tasks \
  -PreactNativeArchitectures=arm64-v8a -Pexpo.camera.barcode-scanner-enabled=false)
(cd "$ANDROID_DIR" && ./gradlew :app:bundleRelease \
  -PreactNativeArchitectures=arm64-v8a -Pexpo.camera.barcode-scanner-enabled=false)

[[ -f "$AAB_PATH" ]] || die "AAB was not produced"

printf 'build:aab: [3/3] verify packaged store constants\n'
EXPECTED="$VERSION" CODE="$VERSION_CODE" PACKAGE="$PACKAGE" AAB="$AAB_PATH" node <<'NODE'
const fs = require('fs');
const { execFileSync } = require('child_process');
const expected = { version: process.env.EXPECTED, code: Number(process.env.CODE), package: process.env.PACKAGE };
const raw = execFileSync('unzip', ['-p', process.env.AAB, 'base/assets/app.config'], { maxBuffer: 16 * 1024 * 1024 });
const config = JSON.parse(raw.toString('utf8'));
const actual = {
  version: config.version,
  code: config.android && config.android.versionCode,
  package: config.android && config.android.package,
  nativeFcmConfigured: config.extra && config.extra.nativeFcmConfigured,
  distribution: config.extra && config.extra.distribution,
  directUpdates: config.extra && config.extra.directUpdates,
};
const want = { version: expected.version, code: expected.code, package: expected.package, nativeFcmConfigured: true, distribution: 'store', directUpdates: false };
for (const key of Object.keys(want)) {
  if (actual[key] !== want[key]) throw new Error(`packaged ${key}=${JSON.stringify(actual[key])}, expected ${JSON.stringify(want[key])}`);
}
console.log(JSON.stringify({ ok: true, packaged: actual }));
NODE

MANIFEST="$(bundletool dump manifest --bundle="$AAB_PATH")"
grep -q "package=\"$PACKAGE\"" <<<"$MANIFEST" || die "AAB manifest package mismatch"
grep -q "versionCode=\"$VERSION_CODE\"" <<<"$MANIFEST" || die "AAB versionCode mismatch"
if grep -q 'REQUEST_INSTALL_PACKAGES' <<<"$MANIFEST"; then die "store AAB still requests REQUEST_INSTALL_PACKAGES"; fi
"$JARSIGNER" -verify "$AAB_PATH" >/dev/null 2>&1 || die "AAB signature verification failed"

SHA="$(shasum -a 256 "$AAB_PATH" | awk '{print $1}')"
SIZE="$(stat -f%z "$AAB_PATH")"
printf 'build:aab: OK\n%s\nsize=%s bytes\nsha256=%s\n' "$AAB_PATH" "$SIZE" "$SHA"
