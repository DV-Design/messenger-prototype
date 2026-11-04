# LastCall — Google Play Console package

Use with `store/listing-en.md` and `store/listing-ru.md`. Values are drafts for the
1.0.8 store build (`ru.lastcall.app`, versionCode 22); legal review is still
required. Nothing here has been submitted.

Final AAB: 41,617,435 bytes, SHA256
`436b90a56289e6070f6d88a99b2a7187ec8dcd42351a641385b29bdedd8c635f`,
upload certificate SHA256
`ad52a7b387b27104a2055cce8823df51421a1a331d7d34c2533177e6dec24781`.
Firebase Android app `LastCall Play` is registered; the client config is outside
the repository at `~/.config/lastcall/google-services-play.json`.

## App identity

- Package: `ru.lastcall.app`
- Default language: English (United States); add Russian (ru-RU) listing.
- App name: LastCall — Secure Messenger / LastCall — защищённый мессенджер.
- Category: Communication.
- Contact email: admin@lienad.ru.
- Privacy policy: https://p2p.lienad.ru/privacy.html
- Account deletion URL: https://p2p.lienad.ru/privacy.html
- Community guidelines: https://p2p.lienad.ru/community.html
- Terms of use: https://p2p.lienad.ru/terms.html

## App access

Registration is open inside the app: choose a display name and a unique
`@username`; no email, phone number or password is required. A new installation
can create an account immediately. To exercise chat/calls, register a second
installation with another username. Mention this in “App access → All
functionality is available without restrictions” and add the registration note
in reviewer instructions.

## Ads and content declarations

- Contains ads: No.
- In-app purchases: No.
- News app: No.
- COVID-19 contact tracing: No.
- Government app: No.
- Financial features: No.
- Health features: No.
- Target audience: 18+; not designed for children.
- User-generated content: Yes. In-app reporting and user blocking exist in every
  chat under the header menu → Safety options.
- Users interact / communicate: Yes.
- Shares user location: No.
- Digital purchases: No.

## Content rating questionnaire

- Violence, blood, sexual content, nudity, profanity, controlled substances,
  gambling: No.
- User-generated content, user-to-user communication, sharing of personal
  information: Yes.
- Users can report UGC and block users: Yes.
- Ads: No.
Answer truthfully; Google will assign the final rating. Expect at least Teen.

## Data safety draft

Collected (all encrypted in transit; no sale; no advertising/analytics):

| Data type | Required? | Purpose |
|---|---|---|
| Name (display name) | Required for account | App functionality, account management |
| User IDs (username, user ID, public key) | Required | App functionality, account management |
| Messages (other in-app messages) | User content | App functionality |
| Photos and videos (circles, selected media) | Optional | App functionality |
| Audio (voice notes, call audio) | Optional | App functionality |
| Files and documents | Optional | App functionality |
| Device or other IDs (push token, user/device ID, IP) | Required for service | App functionality, security/fraud prevention |

- Data is encrypted in transit: yes (TLS, DTLS/SRTP and the session content
  encryption layer).
- Users can request data deletion: yes; account deletion is in the app and at
  the deletion URL. Reports are retained for moderation/legal obligations and
  the reporter ID is anonymized on account deletion.
- Data shared with third parties: Firebase Cloud Messaging (Google) receives the
  push token and technical delivery metadata for app functionality. TURN relay
  carries encrypted WebRTC packets. No data is sold.
- Message content is not stored on the developer’s server. Local history and
  queued media are encrypted on the device; the sender queue expires after
  7 days.
- No independent security review: do not claim one.

Review the Data safety answers against the final build. If the reviewer treats
peer-to-peer delivery differently from collection, keep the declared message and
media categories—do not under-declare.

## Permission declarations

- `USE_FULL_SCREEN_INTENT`: incoming audio/video calls. Explain that it is used
  only for a live, authenticated call invitation; the user can decline.
- Foreground services `phoneCall`, `microphone`, `camera`: active calls and
  explicit voice/video-circle recording. Recording stops when the screen or call
  ends.
- `MANAGE_OWN_CALLS`: LastCall registers its own phone account for system call
  UI; it is not a default dialer and does not access the phone app’s call log.
- `POST_NOTIFICATIONS`: message delivery notifications; denied permission does
  not block background synchronization.
- `RECORD_AUDIO`, `CAMERA`: calls and user-started recordings.
- `READ/WRITE_EXTERNAL_STORAGE` are capped at Android 12L (API 32) by the
  libraries; modern Android uses the system photo picker and app storage.

## Store build gates

Before upload verify the AAB:

```sh
export LASTCALL_DISTRIBUTION=store
export LASTCALL_ANDROID_PACKAGE=ru.lastcall.app
export LASTCALL_IOS_BUNDLE_ID=ru.lastcall.app
export MESSENGER_GOOGLE_SERVICES_FILE="$HOME/.config/lastcall/google-services.json"
set -a; . "$HOME/.config/lastcall/keystores/lastcall-upload.properties"; set +a
npx --no-install expo prebuild --platform android --no-install
cd android
./gradlew :app:createBundleReleaseJsAndAssets --rerun-tasks \
  -PreactNativeArchitectures=arm64-v8a -Pexpo.camera.barcode-scanner-enabled=false
./gradlew :app:bundleRelease -PreactNativeArchitectures=arm64-v8a \
  -Pexpo.camera.barcode-scanner-enabled=false
```

Required packaged values: version1.0.8/code22, package `ru.lastcall.app`,
`extra.distribution=store`, `extra.directUpdates=false`,
`nativeFcmConfigured=true`, no `REQUEST_INSTALL_PACKAGES`. The AAB must be signed
with the upload key (not the Play App Signing key). Upload to internal testing
first, install from Play, then run `docs/TESTING-RU.md`.

## Account type and rollout

- **Organization account:** production access is available after normal review.
- **Personal account created after 13 Nov 2023:** Google requires closed testing
  with at least 12 testers who opted in for at least 14 continuous days before
  production access. Prepare testers before submitting.
- Keep the upload keystore and passwords backed up offline; losing the upload key
  requires a Play App Signing upload-key reset.

## Current Play Console state (2026-11-03)

- Developer account `5535707229234088478`, app `4973089023189492670`
  (`ru.lastcall.app`).
- Internal testing release `LastCall 1.0.8 internal` published, unreviewed.
- English (en-US) default listing saved with icon, feature graphic and six
  1080×1920 screenshots; category Communication; contact email/site filled.
- Privacy, ads, app access, IARC rating, target audience (18+), Data safety,
  advertising ID, government, financial and health declarations saved.
- Full-screen intent declaration saved (calls, default grant requested).
- Active-services declaration saved with demo videos:
  - https://p2p.lienad.ru/demo/lastcall-foreground-camera.mp4
  - https://p2p.lienad.ru/demo/lastcall-foreground-microphone.mp4
  - https://p2p.lienad.ru/demo/lastcall-foreground-phone-call.mp4
- Internal tester list `LastCall internal` contains
  `populizator@googlemail.com`.
- Upload key fingerprint matches Play App Signing (`AD:52:…:47:81`).

## Current Play Console state (2026-11-04)

- Alpha closed-testing track `4699437850249993377` is active in 178
  countries/regions with `LastCall 1.0.8 closed`. The dashboard shows 2 testers.
- `LastCall 1.0.9 closed` (versionCode 23, rollout 100%) has been sent for review
  and is **in review**. Its install share is 0%; 1.0.8 stays live until approval.
- The internal testing track still has 1.0.8.
- Managed publishing is off, so an approved change goes live without a further step.

## Remaining blockers

- Google approval of `LastCall 1.0.9 closed`.
- Personal accounts need 12 testers opted in for 14 continuous days before
  production access; the dashboard shows 2. The user will add the remaining testers.
- Russian (`ru-RU`) store listing translation and confirmation that the icon /
  feature graphic are not AI-generated (AI-assets declaration).
- Review submission is disabled until the active-services declaration and
  testers are handled; the internal build remains unreviewed.
- Legal review of privacy policy, terms, community guidelines and Data safety.
- Physical-device acceptance of the Play-installed build.
- Account identity verification with Google must complete.
