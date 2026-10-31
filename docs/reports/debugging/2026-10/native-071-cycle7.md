# LastCall 0.7.1/code11 — cycle7 native acceptance PASS

Date: 2026-10-31. Status: **published and native-accepted**. Published APK
`artifacts/LastCall-0.7.1.apk`:54 949 929 bytes, SHA256
`a47c676b25b59ede87ca7cd3ad0fe067f52c2fe58957e342388166c622b1d53a`,
certificate `fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c`,
version0.7.1/code11, min24/target36/compile37, ARM64. Primary, alternate and
preview HTTPS downloads all matched the exact bytes/hash. This supersedes the
[historical pre-extension FAIL](native-071.md).

## Explicit authorization and QA7

The user explicitly approved exactly one additional cycle after the6/6 pause,
replying `«Делай»`. The ledger preserves cycles1–6 and adds7: base6/effective7,
with the approval recorded, and **no cycle8**. Protocol, portable and installed
tester profiles were updated separately. The monitor defaults to6, accepts the
explicit `LASTCALL_QA_MAX_CYCLES=7` opt-in, and the running own environment showed
valid7/7.

Independent tester cycle7 PASS was **non-native** and scoped:
81 mobile PASS/0 fail,10 monitor PASS, mobile tsc clean, lint0 errors plus the
existing VoiceNote warning, all three required skill bodies explicitly read.
No full core/server/e2e rerun: the historical full340 unit and11 Chrome PASS/1
authenticated-TURN skip remain attributed to cycle4. Core/server/video source was
unchanged in this extension. [Cycle7 report](../../testing/2026-10/claude-qa-cycle-7.md).

## `msg-el9` fix

`call-push-model` normalizes **only** the known null SDK `dataString` wrapper before
strict5/7 key counting. It does not mutate the input, checks the raw record size
first, and still rejects unknown, non-null or conflicting fields. Faithful
fixtures matching the installed `expo-notifications` SDK
`RemoteMessageSerializer` fail before the fix and pass after it. `msg-el9` and
`msg-d1e` are closed; build guard `msg-c5v` remains closed. Physical quality and
carrier work (`msg-3z9`, `msg-9rr`, `msg-si6`) remains open.

## Build

Positive guarded build: ignored `.tmp/current/native-071-cycle7/release.log`,
`BUILD SUCCESSFUL` in2m30s, 854 tasks. It forced the JS bundle and packaged gate:
`nativeFcmConfigured=true`, version0.7.1, versionCode11. Main separately verified
the certificate. Nothing was copied or published by the build helper.

## Environment and upgrade

- Own AVD: Android17, API37.2 Google APIs, `ps16k`, ARM64.
- Same `qa_native_071_1031` installation upgraded in place to the final build with
  the same certificate.
- Full-screen access upgrade flow passed as in cycle6; the old four permission
  prompts did not repeat.

## Cold call under PIN — PASS

1. Old PIN-locked PID2836 was verified by cmdline, then root `SIGKILL`ed (not
   force-stop), and confirmed absent before the call.
2. A synthetic caller held RTC `ensurePair` for15 000ms.
3. True FCM started new PID4884. The owned `LastCallCallActivity` was top at
   **7.984s**, keyguard true, caller still `outgoing`/`transport:connecting`, no
   RTC.
4. Before answer only `LastCallCallUiService` and `VoiceConnectionService` ran;
   **no** `LastCallAudioService`.
5. Native «Принять» tap exited0 and the call became active at **16.527s** (after
   the deliberate15s RTC gate). Only `LastCallAudioService` +
   `VoiceConnectionService` remained; setup/UI services were removed.
6. Actual direct bidirectional RTP: first sample1429in/1489out,20s later
   2443in/2502out. Final sample at **66.16s** after call start — past the original
   30s deadline/wake window — was still active.
7. Hangup removed `LastCallAudioService`.

Audio output was disabled (`fake Chrome audio` + AVD `-no-audio`). RTP proves
transport, not heard intelligibility; no voice-quality claim follows.

## Second call and cancel — PASS

A second call held RTC for20 000ms. The owned UI rang at7.077s while the caller
remained connecting. Cancel without answer removed the UI in **1.637s**; native
UI and AudioService were absent, and no microphone was acquired.

## Cleanup and infrastructure

Own PIN cleared, adbd returned to non-root, own AVD stopped, browser closed. The
new coordination signaling was deployed as the only service change; current DB
and private Firebase were preserved, no DB restore was performed, coturn/router
were untouched. Health returned ok and the container was healthy.

## Limits

- Cold ring at about8s is a measured sample, not universal instant delivery.
- Physical Pixel/Vivo, carrier handover, OEM battery policy, heard voice/video
  quality, DPI and iOS/APNs/CallKit remain unverified.
- No cosmetic UI tests were run as part of this documentation task.

Ignored success proofs: `.tmp/current/native-071-cycle7/pre-call.json`,
`cold-answer.json`, `sustained-audio.json`, `cancel.json`, `downloads.json`.
