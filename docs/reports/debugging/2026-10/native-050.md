# LastCall 0.5: focused native sender queue and upgrade smoke

Date: 2026-10-28. Scope: the preserved, isolated `LastCall_Delivery` AVD,
serial `emulator-5570`, Owner user 0. No reset/uninstall/clear of Owner data,
and no access to the separate MicControl AVD or a real user's phone.

## Preparation

Started only the own AVD with its existing userdata and without snapshots.
Before any upgrade, Android reported LastCall 0.4.0 / versionCode 5.
The synthetic existing profile opened directly without registration and the
three existing QA chat rows remained. Its server connection was online.
Opened the same historical conversation used by earlier upgrade checks: its
three outgoing and three incoming synthetic text markers were still present.
Saved the profile and historical chat hierarchies under the ignored own QA
directory for before/after comparison; no private device key was inspected.

Google Play services was installed and enabled for Owner user 0:
version 25.26.35 (260400-783060121), versionCode 252635035. This establishes
availability for a subsequent native FCM attempt; it is not token registration
or push-delivery evidence. The old build correctly showed Firebase unconfigured.

## Exact upgrade and Firebase client state

After the main agent's APK-ready signal, installed only
`artifacts/LastCall-0.5.0.apk` with `adb install -r`.
SHA-256: `47e8e8dfa6c69932969b677b54aa408b53b02c1580a5aec5db1eb56cbe770b8d`.
Android reported versionName 0.5.0 / versionCode 6, minSdk 24 / targetSdk 36.
The same synthetic username, three prior chat rows and the same historical
three outgoing plus three incoming markers survived the upgrade. No onboarding,
new identity or permission reset was required.

Settings now displayed `Уведомления не настроены на сервере`, replacing the
old build's missing-Firebase-client message. This verifies recognition of the
configured native client flag and real server capability response. Server FCM
was deliberately still disabled because its credential setup was pending. The
app therefore did not reach native token registration, and this test makes no
claim of successful FCM token issuance, push receipt or background delivery.

## Offline sender text/file queue through process restart

Bundled the **current final core source**, not the earlier unsigned-group
baseline, into the isolated browser harness on loopback port 5186. Real public
directory/signaling/ICE used ordinary DNS/TLS. Only temporary QA HTML/JS URLs
were intercepted. Browser synthetic-media permission flags exposed reachable
host candidates for this controlled emulator/host route.

The fresh browser peer and upgraded native client first established a direct
connected session. Explicitly disconnected the browser client while retaining
its synthetic identity in memory. On Android, sent one synthetic text marker
and selected a 29-byte synthetic text file using the actual Android Documents
picker's Downloads location. The file was injected only into this own AVD's
Downloads folder. No existing user document was touched.

While the recipient remained offline, Android showed the message clock and
`Ожидает доставки · до 7 дней` for the file. The picker/composer returned
immediately without waiting for the recipient. Force-stopped and reopened only
LastCall for Owner 0, without clearing its data. Both the pending text and the
file card reappeared with their waiting state before reconnecting the recipient.

Reconnected the same browser recipient. Its independent manager received the
original text and a complete 29-byte file. Decrypted file retrieval matched the
entire fixture byte-for-byte. Android then showed the message's double check and
`Доставлено` for the file. This proves actual sender ciphertext reload and
post-restart transfer, followed by application ACK, rather than merely restoring
a file name. The browser harness uses the optional in-memory test adapter;
durable receiver write failure/ACK boundaries are verified by core tests, not
by a browser-process restart in this native smoke.

## One emulator Wi-Fi → cellular → Wi-Fi cycle

Changed only this own emulator's Wi-Fi state with `adb shell svc wifi`;
no host network, proxy or other device was modified. Android initially selected
validated Wi-Fi network 101, selected validated MOBILE/CELLULAR network 100
after disabling Wi-Fi, then selected a new validated Wi-Fi network 102 after
re-enabling it. Wi-Fi was restored before cleanup.

After the cellular transition, a new native-origin text reached the browser,
and an independent browser-origin text reached native application ACK. After
the return to Wi-Fi, the peer briefly re-entered connecting and then recovered
to connected/direct automatically; a further browser text reached `delivered`.
The native UI retained the queued/delivered file and all fresh markers. No user
reconnect action or app restart was used during the network cycle.

This is one emulator-interface recovery smoke on the same host network. It
does not reproduce a real operator NAT/IP change or prove carrier reachability.
The harness did not expose a call-answer control, so this lean test covered
text/file state and connection recovery, not call audio continuity. No elapsed
handover bound was measured, and **no ten-second interruption guarantee** is
claimed.

## Cleanup and limits

Stopped the own browser through its inspected `/stop` endpoint and gracefully
requested `emu kill` only after rechecking AVD name `LastCall_Delivery` on serial
5570. Removed only the tiny synthetic Downloads fixture created by this test;
its delivered encrypted chat copy and all existing app identity/history remain.
The own AVD userdata, temporary test captures and harness sources are preserved.
Both own process sessions exited successfully, port 5186 had no listener, and
`adb devices -l` listed no remaining device after cleanup.

PASS: same-certificate in-place upgrade and six-message history retention,
configured-client versus disabled-server push wording, actual native sender
text/file persistence through force-stop, exact post-restart file bytes and
recipient ACK, and automatic text connection recovery for one emulator network
cycle.

Not validated: actual FCM token registration/delivery, background/closed-app
delivery, seven days of wall-clock waiting, native multi-peer group replication,
real cellular operators or TURN, live call/audio interruption, or iOS. Core
automated tests cover deadline boundaries, signed groups and durable ACK failure;
these were not re-labelled as native field evidence.
