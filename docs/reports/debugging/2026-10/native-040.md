# LastCall 0.4: lean native upgrade smoke

Date: 2026-10-28. Scope: the own isolated Android QA environment, in-place
code4→code5 upgrade, retained synthetic identity/history, icon/catalog/search,
foreground text/ACK, and first-launch OS permission sequencing if the emulator
supports a separate disposable user. No real user/device data or other AVDs.

## Preparation

Started only the preserved `LastCall_Delivery` AVD on serial `emulator-5570`,
without wiping data or loading snapshots. Restarted the existing loopback-only
browser harness on port 5186 with a new synthetic browser profile. The harness
uses the immutable baseline core bundle and controlled reachable-host Chrome
configuration documented in [the initial investigation](native-delivery.md).
The native code4 profile/data will be inspected before any upgrade installation.

No code5 APK was installed before main's APK-ready signal. Application sources
remain frozen during this QA task.

## Exact APK and upgrade

Installed `artifacts/LastCall-0.4.0.apk` only after main confirmed readiness.
SHA-256: `b6dbc5e508e908774772a65252e0de4cda675e7bc514b7e1be6a84d8d8f94394`.
`adb install -r` succeeded. Android reported versionName 0.4.0 / versionCode 5,
minSdk 24 / targetSdk 36. READ_CONTACTS and WRITE_CONTACTS were absent;
microphone/camera/notification permissions remained declared.

Owner user 0 was never uninstalled, cleared, or replaced. Its active historical
chat contained three native-origin and three browser-origin markers before
upgrade and the same six messages afterwards. Its existing synthetic username
was independently observed unchanged by the fresh browser peer. Existing saved
chat entries survived; no registration or permission setup was forced on this
already configured profile.

## Catalog, login/name search and foreground ACK

The actual public backend populated the native server catalog with online and
offline profiles. The page clearly distinguished the server catalog from saved
contacts. Searching the fresh browser's exact login returned its single profile.
Replacing that query with `Browser` returned profiles by display name, including
the fresh peer whose login does not contain `Browser`. This exercised native
input, debounce, actual authenticated server queries and rendered results.
Unicode case folding/pagination completeness are covered by independent server
and core tests; no long native search or pagination matrix was performed.

Selecting the fresh peer opened one new chat and established a direct session.
The browser received a fresh native marker. A fresh browser reply appeared on
Android and reached `delivered` in the independent browser manager, proving a
native application ACK. Browser counts became two, statuses received/delivered.
This remained the controlled reachable-host laboratory route, not arbitrary NAT
or carrier-network coverage.

## Actual first-launch permission sequence

The same isolated AVD supports four Android users. Only after proving Owner's
upgrade/history, created synthetic secondary user 10 (`LastCall_FirstLaunch_QA`),
enabled the already installed package for that user, and switched to it. No
Owner files or app data were cleared. Only this new test user's setup-complete
flag was set to bypass Android's unrelated initial system wizard.

On its first LastCall launch, without entering a profile or pressing an app
permission button, the actual Android microphone prompt appeared automatically.
Deliberately selected Don't allow. The actual camera prompt followed
automatically; selected While using the app. The actual notification prompt then
followed; selected Allow. This worked without Firebase client configuration.
The SDK reported photo/media access granted, so a separate photo prompt was
**not** shown or claimed. Three actual OS prompts were verified, not four.

The permission page showed camera/photos/notifications granted and separately
explained that push remained unconfigured because Firebase was absent. Continue
opened the unregistered onboarding form; no phone/SMS/contact-book step appeared.
After force-stop and opening the app again from its launcher entry, onboarding
returned without repeating the automatic permission sequence. No new synthetic
account was registered for user 10.

## Logo and cancellable offline call

Two targeted visual captures confirmed the supplied purple satellite logo in
onboarding and the Android launcher app drawer. The full dish/base remained
visible inside the purple circle. Native hierarchy and these two captures are
retained in ignored `.tmp/current/native-delivery/code5-*`; no screenshot matrix.

Returned to Owner user 0. Its old offline QA peer had enabled call buttons.
Starting an audio attempt immediately displayed the global outgoing `Вызов…`
overlay. Canceled within about four seconds, before the bounded wait deadline;
the overlay closed and the six-message historical chat remained intact. This
checks the newly enabled offline attempt/cancel path only, not a completed call,
background incoming-call delivery, codec behavior or microphone capture timing.

## Minor observation

After the deliberate first microphone denial, foreground status refresh labelled
it `Ещё не запрошено` instead of `Не разрешено`: the WebRTC permission query
returns a requestable/prompt state after this Android denial. The actual access
remains denied, the retry button remains available, and the next OS categories
were not blocked. This is a permission-status wording issue; no source changes
were made during QA. Main was notified for a narrow follow-up decision.

## Cleanup and limits

Switched back to Owner user 0 and stopped only synthetic secondary user 10,
preserving both users' data. Inspected/used the own harness `/stop` endpoint to
disconnect its client and close its browser/server. Confirmed AVD name
`LastCall_Delivery`, then requested graceful `emulator-5570 emu kill`. No other
AVD, browser, or user device was accessed. Final checks confirmed no listener on
5186, no matching own harness/emulator process, and no remaining adb device.
The preserved userdata image and all QA evidence/configuration remain on disk.

PASS: in-place upgrade with identity/history retention, absence of contact-book
permissions, real catalog/login/display-name search, foreground text/native ACK,
first-launch automatic OS requests with denial continuation, repeat suppression,
provided logo, and cancellable offline call attempt.

Not validated: real FCM registration/delivery, closed-app/background message or
incoming-call delivery, TURN/carrier NAT behavior, actual audio/video quality,
or iOS. Firebase remains unconfigured; OS notification permission is independent
from provider readiness and does not prove push delivery.
