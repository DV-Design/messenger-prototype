# LastCall 0.7.1/code11 — authenticated call invite and stable video release

Date: 2026-10-31. Status: **published 0.7.1/code11; native Android17 acceptance
PASSED**. Published APK: `artifacts/LastCall-0.7.1.apk`,54949929 bytes, SHA256
`a47c676b25b59ede87ca7cd3ad0fe067f52c2fe58957e342388166c622b1d53a`, certificate
`fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c`, packaged
FCM=true/version0.7.1/code11/min24/target36/compile37. Primary, alternate and
preview downloads matched exactly.

Cycles1–6 remain historical. The owner explicitly approved exactly one extra
allocation (`«Делай»`); cycle7/7 ran with base6/effective7 and no cycle8. Cycle7
PASS covered81 mobile/10 monitor tests plus mobile tsc/lint0 errors; full
core/server/e2e was not rerun. `msg-el9` was fixed and closed: only the known
null `dataString` wrapper is normalized before strict5/7 validation, input is not
mutated, raw size gates first, and unknown/non-null/conflicting fields still fail.
Real Android17 cold FCM under PIN showed the owned call UI at7.984s, native
answer/audio at16.527s after a deliberate15s RTC gate, direct bidirectional RTP
at66s from call start, and cancel without answer removing UI in1.637s with no AudioService or
microphone. Emulator audio was disabled, so heard intelligibility is not claimed.
See [cycle7](../../testing/2026-10/claude-qa-cycle-7.md),
[native-071-cycle7](native-071-cycle7.md), and the historical
[pre-extension FAIL](native-071.md). Physical Pixel/Vivo, carriers/handover, DPI
and iOS/APNs remain unverified.

## Call invitation architecture

Outgoing calls first try the direct route. After 2.5 s without an answer, metadata
may be sent through the server/FCM before any media. The invitation is encrypted
with a pair-derived HKDF key and XChaCha20-Poly1305 (same conversation-invite
material as the pinned contact); it carries the conversation ID and video flag,
not SDP, media or chat content. `callId` is stable and the original 30 s deadline
is preserved across direct attempts, server forwarding and push; retries never
extend it.

The server (`apps/server/src/call-registry.ts`) is coordination-only:

- validates caller/callee consent, invite binding, server epoch and the 30 s timing;
- keeps `pending`/`ringing`/`accepted`/`ended` metadata in RAM, bounded to 4096
  calls and 8 per user, expired at 30 s;
- forwards the envelope at most once to a connected callee and never stores it;
- keeps a cancel tombstone with the caller's original deadline so a late offer
  cannot recreate the call; restart clears the map and an epoch change invalidates
  old actions;
- sends a terminal state push only as a freshness hint. It cannot mutate core
  state, and it is skipped when expired or no longer `ended`.

The receiver parses transport metadata but only decrypts with the pinned contact
key. It checks sender, recipient, `callId`, conversation membership, issued/expiry
and the current server epoch, then core state, before ringing. A native
UUID/nonce/expiry binding rejects stale notification actions.

Answer and media are distinct. The native call-only screen appears before ICE and
shows no chat/history. Tapping answer shows "connecting" and waits for the matching
P2P call; microphone/camera/audio service start only after the explicit answer.
Cancel, decline and expiry stop the native call and cannot be resurrected by a late
push. The audio service owns a deadline until core observes the active session.

## Telegram research

Research used pinned Telegram Android commit `3de37c8`. Its
[`VoIPPreNotificationService`](https://github.com/DrKLO/Telegram/blob/3de37c8cfb039452be7398909461da6288babf15/TMessagesProj/src/main/java/org/telegram/messenger/voip/VoIPPreNotificationService.java)
acknowledges `TL_phone.receivedCall` and then starts the native ring before media.
LastCall adopts the architectural lesson (authenticate and acknowledge the invite
first; ring; establish media after answer) but contains no copied GPL code.

## Android 14+ full-screen access

A separate access step opens `ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT`. Opening
settings is not treated as a grant: the app subscribes to app-state changes and
re-reads the real native state after an actual leave/return; a 60 s timeout keeps
the prior truth. A new marker (`messenger.permissions.call-screen.1`) avoids
re-asking the old four permissions during an in-place upgrade. Without access,
Android may present only a banner/notification with answer/decline actions.

## Video feedback-loop fix

The previous JS policy fed a discounted GCC estimate (`0.8 * available - 64 kbit/s`)
into manual `setParameters` about every 2 s, including `active:false`, resolution
scaling and framerate caps. On some routes this restarted the encoder and left
long decoder gaps (reported up to ~10 s; user reports on Vivo). The candidate
removes that loop: a stable 1.8 Mbit/s / 30 fps ceiling with
`scaleResolutionDownBy:1` and `active:true`; native GCC chooses actual bitrate and
resolution and probes recovery. A `WeakMap` keyed by sender avoids repeated writes
when the native layer normalizes parameters. JS no longer periodically disables a
live stream.

Diagnostics were narrowed to a fixed allowlist: selected local/remote codec,
outbound and inbound fps/dimensions, bitrate, decoded/dropped frames, freeze count/
seconds, encode time and a bounded limitation reason. Unknown or unsafe values
render as "—"; arbitrary stats, SDP, IDs and app content are not serialized.

Controlled local browser RTP, 66 s, synthetic camera, VP8, one estimate sequence
including missing values:

| Run | Decoded frames/peer | Periodic parameter writes | Max decoded-frame gap | Reported freezes |
| --- | ---: | ---: | ---: | ---: |
| before | 619 | 14 | 10.05 s | not asserted |
| after | 1321 | 0 | 2.016 s | 0 |

Samples were taken about every 2 s. This is VP8 browser evidence and does **not**
prove quality on physical Pixel/Vivo, all codecs, native rendering or carrier
conditions.

## Evidence and limits

- Source/unit regressions cover invite binding, expiry/tombstone behavior, media
  gating, full-screen re-read, diagnostics allowlist and stable video parameters.
- Cycle4 executed340 unit tests (80 mobile/71 server/189 core),11 browser PASS/1
  authenticated-TURN skip, types/builds/Android+iOS JS exports and lint with0
  errors; its final worker response timed out and was BLOCKED. Cycle5 reviewed a
  bounded source scope PASS; cycle6 checked the build helper/types and final APK
  PASS without a full rerun. Cycle7 was the explicitly approved extra allocation:
  PASS on81 mobile/10 monitor tests and mobile tsc/lint, no full gate or native run.
- The published APK is `artifacts/LastCall-0.7.1.apk` with the exact
  size/SHA256/certificate above. Primary, alternate and preview downloads matched.
- `msg-el9` was fixed and closed: the known null `dataString` wrapper is normalized
  before strict5/7 validation, with input immutability, raw-size checking and
  rejection of unknown/non-null/conflicting fields. The pre-extension `3d...`
  candidate and its native FAIL remain historical in
  [native-071](native-071.md).
- Real Android17 native acceptance passed: cold PIN ring7.984s, answer16.527s,
  direct RTP past66s, cancel1.637s. Emulator audio was disabled, so heard voice
  quality is not claimed.
- Physical Android/OEM battery policy, Russian carriers/handover, API24–25,
  denied full-screen access, heard voice quality, native video under constrained
  links and iOS/APNs/CallKit remain unverified. Force-stop blocks Android push
  until manual launch; iOS is not guaranteed.
- The 0.7.0 [native report](native-070.md) remains historical evidence for
  0.7.0/code10 only.
