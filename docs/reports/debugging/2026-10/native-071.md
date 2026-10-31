# LastCall 0.7.1/code11 — final native cold-call failure report

Date: 2026-10-31. Status: **FAIL; final candidate unpublished; overall QA paused at
6/6 (`paused_limit`, `requires_user_resume=true`)**. Public 0.7.0/code10 remains
the current release. No 0.7.1 publication, download or acceptance is claimed.

## Final candidate identity

- Local only: `artifacts/LastCall-0.7.1.apk`; no public URL.
- Size:54949881 bytes.
- SHA256:`3d36731251871053711e48e0a9464a9259ffdd0024397d041cc412a253dd2122`.
- Certificate:`fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c`.
- Package `dev.messenger.prototype`, version0.7.1, versionCode11, min24/target36.
- Actual positive build PASS: `.tmp/current/native-071/release-fixed.log`
  (`BUILD SUCCESSFUL`, 854 tasks; packaged `nativeFcmConfigured=true`,
  version0.7.1, versionCode11).

An earlier candidate `e9c201...` packaged `nativeFcmConfigured=false` because the
client-config environment was supplied to Expo prebuild but omitted from later
Expo/Gradle stages. It was never published and was moved to
`.tmp/current/native-071/rejected-no-fcm.apk`. Build guard work is `msg-c5v`
(CLOSED): the helper now exports the client-config path to every Expo/Gradle
child, forces a fresh JS bundle, and verifies packaged FCM/version/code before
accepting an APK.

## Emulator environment and upgrade

- Own AVD: Android17, own API37.2 Google APIs image, `ps16k` variant, ARM64,
  serial5572.
- Registered `qa_native_071_1031` on the published 0.7.0 build, then updated
  in place to the candidate; username and installation identity were preserved.
- Only the new full-screen access prompt appeared; the old runtime permission
  prompts were not repeated.
- Real Settings toggle and return produced actual `FullscreenCalls: Разрешено`;
  full-screen access flow PASS.

## Final native cold-call result — FAIL

1. A PIN-locked own process `PID3423` was terminated by root `SIGKILL` only after
   command-line validation. `am kill` did not kill the retained process; this was
   **not** force-stop. The process was confirmed absent and the keyguard was true.
2. A synthetic caller held `ensurePair` for20s to stall the peer RTC; one call was
   placed.
3. FCM event at08:44:09.332 started a new process `PID5528` through
   `FirebaseInstanceIdReceiver`; `package stopped=false`.
4. No `LastCallCallActivity` appeared within27s. The caller remained waiting,
   the recipient appeared offline, and no audio start occurred.

Ignored proof files: `.tmp/current/native-071/pre-call.json`,
`cold-call.json`, `sdk-wrapper-repro.json`.

## Confirmed root cause (read-only PoC)

The installed `expo-notifications` `RemoteMessageSerializer.toBundle(Map)`
unconditionally adds `dataString:null` when no body is present. The strict
`apps/mobile/src/call-push-model.ts` validation requires exactly5/7 keys and
rejects the actual SDK shapes:

- SDK invite shape has6 keys: `kind`, `intentKind`, `intentId`, `expiresAt`,
  `callInvite`, `dataString`.
- SDK terminal shape has8 keys including the same wrapper field.
- Raw hand-built invite and terminal payloads are accepted; the actual
  SDK-shaped invite and terminal payloads are both rejected.

`msg-el9` is OPEN for this actual SDK wrapper bug. No fix was applied after the
six-cycle limit.

## Required next work (needs explicit user quota extension)

- Normalize **only** the known null `dataString` SDK wrapper field before strict
  validation; keep rejecting unknown or conflicting fields.
- Add fixtures generated from the installed serializer, not hand-built payloads.
- Rebuild through the guarded `build:apk` helper and retest real cold FCM answer
  and cancel on the same Android17 environment.
- Do not start cycle7 automatically. `msg-d1e` and `msg-si6` remain in progress;
  build guard `msg-c5v` is closed.

## QA context

- Cycle4: full commands completed340 unit (80 mobile/71 server/189 core),11 Chrome
  PASS/1 authenticated-TURN skip, types/builds/Android+iOS JS exports PASS, lint0
  errors plus the existing VoiceNote warning. Its worker response exceeded280s and
  returned BLOCKED, never PASS. [Cycle4](../../testing/2026-10/claude-qa-cycle-4.md).
- Cycle5: narrow read-only source review PASS; tests NOT_RUN by allocation.
  [Cycle5](../../testing/2026-10/claude-qa-cycle-5.md).
- Cycle6: narrow build-guard/types/final-APK constants PASS; no full rerun.
  [Cycle6](../../testing/2026-10/claude-qa-cycle-6.md).
- Overall native FAIL means `paused_limit`; the six-cycle ledger remains
  `6/6`, `requires_user_resume=true`.

## Limits

Browser66s VP8 before/after evidence is valid only for the browser; it does not
establish physical Pixel/Vivo quality, native video, heard voice, carrier
behavior or iOS/APNs. Cleanup completed by Codex: the own browser was closed, the temporary PIN
was cleared, adbd was returned to non-root and the own AVD stopped. Only the
signaling image was rolled back to the verified previous image; public health
returned ok and the container became healthy. Current DB and the private Firebase
mount were preserved; no DB restore or user-registration rollback occurred.
Public0.7.0 APK files were not replaced.
