# LastCall 0.7.1/code11 — authenticated call invite and stable video candidate

Date: 2026-10-31. Status: **built but unpublished and not accepted; QA paused at
6/6 (`paused_limit`)**. Public 0.7.0/code10 remains the only download. The final
candidate is54949881 bytes, SHA256
`3d36731251871053711e48e0a9464a9259ffdd0024397d041cc412a253dd2122`, certificate
`fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c`, packaged
FCM=true/version0.7.1/code11/min24/target36. Cycle4 executed the complete commands
but its worker response timed out at280s and was BLOCKED, not PASS; cycle5 was a
narrow read-only source-review PASS and cycle6 a narrow build/types/final-APK PASS.
Actual Android17 cold FCM created a new process but no owned incoming UI appeared
within27s. Confirmed read-only PoC: the installed SDK serializer appends
`dataString:null` and the strict parser rejects the actual6/8-key SDK shape
(`msg-el9`); no fix was applied after the limit. See
[cycle4](../../testing/2026-10/claude-qa-cycle-4.md),
[cycle5](../../testing/2026-10/claude-qa-cycle-5.md),
[cycle6](../../testing/2026-10/claude-qa-cycle-6.md) and
[native-071](native-071.md). This report records implemented source behavior and
controlled browser evidence, not phone or store acceptance.

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
  PASS without a full rerun.
- The final APK is local/unpublished at `artifacts/LastCall-0.7.1.apk` with the
  exact size/SHA256/certificate above. Packaged FCM/version/code passed, but this
  is not publication or acceptance.
- Native Android17 cold FCM FAILED: no owned incoming UI within27s; the confirmed
  cause is the SDK `dataString:null` wrapper versus the strict6/8-key parser
  (`msg-el9`). No fix was applied after the6/6 limit.
- Physical Android/OEM battery policy, Russian carriers/handover, API24–25,
  denied full-screen access, heard voice quality, native video under constrained
  links and iOS/APNs/CallKit remain unverified. Force-stop blocks Android push
  until manual launch; iOS is not guaranteed.
- The 0.7.0 [native report](native-070.md) remains historical evidence for
  0.7.0/code10 only.
