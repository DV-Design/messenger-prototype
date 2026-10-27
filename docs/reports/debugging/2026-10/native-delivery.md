# LastCall 0.2: native delivery investigation

Date: 2026-10-27. Scope: one foreground Android profile/search/chat flow, a
controlled browser candidate-privacy comparison, and process restart/history.
No application or shared-core changes were made by this investigation.

## Exact build and environment

- APK: `artifacts/LastCall-0.2.0.apk`, SHA-256
  `132238b8bce0c80e0f2b4b85cf3f193c7be351839c2584d0851acc2d5260836b`.
- Browser peer bundled **baseline commit f602794** core source, matching the
  supplied APK baseline; current in-progress fixes were not used for this peer.
- Dedicated new AVD `LastCall_Delivery`, serial `emulator-5570`, Android 36 Google
  APIs / 16 KiB / arm64-v8a, headless, 2048 MiB, no snapshots. Existing
  `MicControl_API36_16K` was not used or modified. No SDK/image downloads.
- Own AVD/config/harness: `.tmp/current/native-delivery/`. Homebrew avdmanager
  initially could not resolve the Android Studio SDK. An isolated SDK directory
  with links to existing image/emulator packages resolved creation; the emulator
  then booted in under one minute.
- Actual API and signaling: `https://lienad.ru/messenger`, normal browser DNS/TLS.
  Playwright intercepted only two temporary QA HTML/JS URLs on that origin;
  `/messenger/ice`, directory, signaling and WebRTC were real network operations.
  No TLS-ignore option, proxy bypass or public-server modification was used.

## Observations

1. Native profile registration succeeded. Native contact search found the
   authenticated browser user online. The browser independently observed the
   native profile online. Central directory transport worked.
2. With default headless Chrome permission/IP policy, opening the chat and
   sending a native test message left the browser peer `waiting`, route
   `unknown`, with zero received messages for more than one minute. Native
   filtered WebRTC stage logs showed repeated peer construction, successful
   remote/local SDP application, answer creation and ICE-candidate addition;
   no JavaScript exception was found. SDP content was not logged.
3. A controlled Chrome peer launched with synthetic-media / automatic-permission
   UI flags exposed reachable private host candidates. **The unchanged 0.2 APK
   then exchanged messages in both directions over a selected direct route.**
   The native-origin message appeared as received in browser manager state.
   The browser-origin reply appeared in the native UI and its browser status
   changed to `delivered`, proving receipt of the native application ACK.
4. Browser ICE diagnostics confirmed `connection=connected`, `ice=connected`,
   `channel=open`, stable signaling, and a nominated successful candidate pair
   with received ICE-check responses. Only candidate types, address categories
   and counters were inspected; raw addresses and SDP were not retained.
5. Force-stopping and relaunching the native app restored its profile without
   onboarding, restored the incoming/outgoing messages in the chat, and
   re-established the direct session while the browser peer remained online.

## Controlled privacy comparison

A small standalone gather on the same machine, same Chrome channel and public
ICE endpoint produced:

| Browser mode | Host candidate categories | Other candidates |
| --- | --- | --- |
| Default headless Chrome | mDNS hostname | UDP server-reflexive |
| Synthetic media / automatic permission UI | Private IP, UDP and TCP | UDP server-reflexive |

The initial emulator failure is therefore consistent with mDNS isolation / NAT
hairpin reachability. This comparison and the successful reachable-host case
**do not establish the cause on the user's physical phones or carrier networks**.
The permission flags are a laboratory control, not a recommendation to request
microphone access for text chat. No production browser privacy policy was changed.

The unchanged 0.2 build has demonstrated native end-to-end text and ACK handling
when ICE finds a route. It has not demonstrated reliable text delivery through
arbitrary mobile NATs or useful timeout feedback when a direct route cannot form.
Those are separate transport/error-handling concerns. No TURN deployment or
implicit relay fallback was added by this investigation.

## Reuse for 0.2.1 smoke

At handoff, the own AVD and QA browser remain running deliberately, preserving
this synthetic profile for upgrade testing. Browser control is loopback-only
`http://127.0.0.1:5186`: `/status` returns sanitized state/counts/statuses,
`/received` returns whether the expected native test marker was received,
`/send` sends a synthetic browser reply, `/ice` returns candidate categories and
check counters, and `/stop` shuts down only the QA browser. Never use it for
production/private conversations. Main will authorize final cleanup.

Temporary artifacts: `browser.mjs`, immutable baseline core bundle,
`candidate-privacy.mjs`, and `candidate-privacy.jsonl` under the own harness folder.
No real chat contents, private identity seeds, authentication signatures or SDP
were printed. This was a foreground emulator test, not an iOS/native-phone,
background-delivery, audio-permission or broad UI matrix validation.

## 0.2.1 / versionCode 3 upgrade smoke

Upgraded the same own AVD with `adb install -r` from
`apps/mobile/android/app/build/outputs/apk/release/app-release.apk`, SHA-256
`dc1b3dff9e8f03f07267c914594fc9646857c86ee6a0871896e05efece8923b5`.
Android confirmed versionName 0.2.1 / versionCode 3. The previous profile and
conversation history survived the upgrade.

- Permission setup appeared automatically on the first upgraded launch.
- “Разрешить нужное” produced actual sequential Android prompts for contacts,
  camera and microphone. Contacts were allowed, camera deliberately denied,
  microphone allowed. The photo category was already reported granted by the
  native SDK and did not produce a fourth OS prompt. Therefore four OS prompts
  were **not** verified or claimed.
- Android package state confirmed READ_CONTACTS granted, RECORD_AUDIO granted,
  CAMERA denied, and WRITE_CONTACTS absent from requested permissions.
- Inserted exactly one synthetic local contact into this new emulator's Android
  contacts provider. The app's phonebook page displayed its synthetic name and
  phone and reported one row. The current `Contact.getAllDetails` code path
  therefore ran successfully through the installed native module; this was not
  a mocked contact API. No existing device or real phonebook was accessed.
- After completing setup, force-stop/relaunch did not present setup again and
  preserved profile/history. Contacts permission remained available.
- A fresh native-origin message increased the baseline browser peer's received
  count from one to two. A fresh browser reply appeared in the native chat and
  reached `delivered` through an actual native ACK. Browser totals increased from
  two to four messages with statuses received/delivered/received/delivered;
  selected route remained direct and the data channel connected.

This smoke validates foreground upgrade, permission sequencing/denial handling,
native phonebook reads, local state retention, and direct text/ACK exchange only.
**It does not fix or validate closed-app/background delivery, automatic matching
by verified phone number, push provisioning, or relay fallback.** FCM/SMS provider
configuration and the subsequent background-delivery implementation are separate
work. The user's newly clarified closed/background-recipient failure must not be
represented as resolved by this code 3 build.
