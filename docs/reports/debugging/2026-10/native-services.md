# LastCall 0.3: native services smoke

Date: 2026-10-28. Scope: one upgrade on the existing isolated synthetic Android
QA profile; permission/service availability and foreground text ACK. This does
not validate real SMS delivery, FCM delivery, background delivery or iOS.

## Preparation

- Dedicated own AVD `LastCall_Delivery`, serial `emulator-5570`, remained running.
  Other AVDs were not used or changed.
- Before upgrade Android reported versionName 0.2.1 / versionCode 3. Contacts and
  microphone permissions were granted; camera was denied. WRITE_CONTACTS was
  absent from requested permissions.
- Existing loopback-only browser harness `127.0.0.1:5186` remained online with a
  connected direct session. Its four synthetic messages had statuses
  received/delivered/received/delivered. This harness uses the immutable baseline
  peer bundle described in [the earlier investigation](native-delivery.md).
- Baseline native UI hierarchy retained privately in ignored
  `.tmp/current/native-delivery/code4-before.xml`. No application data was reset.

## APK and upgrade

After main confirmed APK readiness, installed `artifacts/LastCall-0.3.0.apk`
with `adb -s emulator-5570 install -r`. SHA-256:
`7bf3d634aaa60ceb2884ecb49086a8b44137ecb6c24c61cb52f43e0ce09dd645`.
Android reported versionName 0.3.0 / versionCode 4, minSdk 24 / targetSdk 36.
No uninstall, data clear or identity regeneration was performed.

The existing synthetic profile name and username survived. The existing two
synthetic chat entries and four-message active conversation remained visible.
Contacts/microphone grants and the earlier camera denial also survived.
WRITE_CONTACTS remained absent; POST_NOTIFICATIONS was present from the merged
dependency manifest, as expected even without Firebase client configuration.

## Service availability: observed native UI

- The upgraded first launch offered permission setup. Contacts and microphone
  showed granted, camera denied, photos granted. Scrolling revealed the fifth
  notification category with `Не настроено` and the explicit explanation that
  this build lacks Firebase client configuration. No notification permission
  prompt or token-registration success was displayed. This was an availability
  check, not another permission prompt sequence or a network token trace.
- Completed setup using Continue. Settings displayed the original profile and
  connected directory state.
- Opened Settings → number/contact discovery. The actual public backend response
  produced `SMS-подтверждение пока не настроено на этом сервере. Код не
  отправляется.` No phone/code fields or successful verification were shown.
- Automatic discovery was disabled until own-number verification. The screen
  described hash sharing/enumerability, local RU-number interpretation, limits,
  and retained the manual phonebook entry. No real phone number, SMS, push token
  or address-book hash batch was submitted during this smoke.

## Foreground message/ACK and relaunch

Opened the existing active QA conversation. Its four previous synthetic messages
were restored and the native transport banner reported a connected peer.
A fresh browser-origin message appeared in native UI and changed to `delivered`
in the independent baseline browser manager, proving a native application ACK.
A fresh native-origin marker appeared as `received` in the browser manager.
Browser total increased from four to six messages; session and route remained
`connected` / `direct`.

Force-stopped and relaunched the Android package once. It returned to the chat
list without profile onboarding or the completed permission setup. Reopening
the active chat restored all six messages: three native-origin and three
browser-origin markers. The browser again observed the same native username
online with a connected direct session.

Native hierarchy evidence is retained only in ignored
`.tmp/current/native-delivery/code4-*.xml`. No screenshot matrix was produced,
no other emulator was touched, and no application source changed during QA.

## Result and limits

PASS: code3→code4 in-place upgrade, identity/profile/history retention, retained
permission decisions, honest unconfigured service states, verified-number gate,
foreground text exchange/native ACK, and process relaunch/history retention.

**Not validated:** real SMS/OTP, actual automatic number matches, FCM registration
or delivery, closed/background recipient delivery, authenticated TURN fallback,
physical phones/carrier NATs, calls, or iOS. External Firebase/SMS accounts remain
required. Push provisioning is not represented as complete by this preview, and
the successful controlled direct route does not establish arbitrary NAT support.

## Resource cleanup

After main explicitly requested cleanup, stopped only the own browser harness
through its inspected `/stop` endpoint (disconnect client, stop synthetic media,
close its browser/server), then gracefully stopped `emulator-5570` with `emu
kill` after confirming its AVD name was `LastCall_Delivery`. Subsequent checks
confirmed no listener on port 5186, no matching harness/emulator process, and no
remaining adb device. Synthetic userdata, AVD configuration and temporary QA
files were preserved. No other browser or AVD was stopped.
