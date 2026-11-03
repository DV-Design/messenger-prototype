# Firebase app for the Google Play build

Goal: add the Android app `ru.lastcall.app` to the existing Firebase project
`lastcall-f8b4c4`, then give the build a matching `google-services.json`.
The existing file is only for `dev.messenger.prototype` and must not be reused.

## Manual steps (Firebase Console)

1. Open https://console.firebase.google.com/ and select project **lastcall-f8b4c4**.
2. Project settings (gear) → **Your apps** → **Add app** → Android.
3. Android package name: `ru.lastcall.app` (exact).
   App nickname: `LastCall Play`.
   Debug signing certificate SHA-1: leave empty; FCM and Play App Signing do not
   require it for this app. Do not add the upload-key fingerprint unless a
   Google API that needs it is added later.
4. Register app → **Download google-services.json**.
5. Move the file outside the repository and restrict permissions:
   ```sh
   mv ~/Downloads/google-services.json ~/.config/lastcall/google-services-play.json
   chmod 600 ~/.config/lastcall/google-services-play.json
   ```
6. Verify it contains exactly the Play package (without printing keys):
   ```sh
   jq -r '.client[].client_info.android_client_info.package_name' \
     ~/.config/lastcall/google-services-play.json
   # expected: ru.lastcall.app
   ```
7. In Firebase → Project settings → Cloud Messaging, confirm the Firebase Cloud
   Messaging API (V2) is enabled. The existing server service account and
   `~/.config/lastcall/firebase-admin.json` stay unchanged.

## CLI alternative

If you log in with `! firebase login`, the assistant can add the app and download
the file with Firebase CLI. Manual creation is equally fine and avoids sharing a
browser session.

## Rebuild the store AAB

```sh
cd /Users/daniel/server/messenger-prototype
set -a
. "$HOME/.config/lastcall/keystores/lastcall-upload.properties"
set +a
export LASTCALL_DISTRIBUTION=store
export LASTCALL_ANDROID_PACKAGE=ru.lastcall.app
export LASTCALL_IOS_BUNDLE_ID=ru.lastcall.app
export MESSENGER_GOOGLE_SERVICES_FILE="$HOME/.config/lastcall/google-services-play.json"
export ANDROID_HOME="$HOME/Library/Android/sdk"
cd apps/mobile
npx --no-install expo prebuild --platform android --no-install
cd android
./gradlew :app:createBundleReleaseJsAndAssets --rerun-tasks \
  -PreactNativeArchitectures=arm64-v8a -Pexpo.camera.barcode-scanner-enabled=false
./gradlew :app:bundleRelease -PreactNativeArchitectures=arm64-v8a \
  -Pexpo.camera.barcode-scanner-enabled=false
```

Then verify inside
`apps/mobile/android/app/build/outputs/bundle/release/app-release.aab`:

- `base/assets/app.config`: version `1.0.8`, versionCode `22`,
  `distribution: "store"`, `directUpdates: false`,
  `nativeFcmConfigured: true`, package `ru.lastcall.app`.
- `base/manifest/AndroidManifest.xml`: no `REQUEST_INSTALL_PACKAGES`.
- `base/resources/.../google_app_id` (or the packaged google-services resource)
  exists.
- The AAB is signed by the upload key certificate `CN=LastCall Upload`,
  SHA256 `ad52a7b387b27104a2055cce8823df51421a1a331d7d34c2533177e6dec24781`.

Do not upload an AAB with `nativeFcmConfigured=false`; push, including incoming
call invitations, will not work in the store package.
