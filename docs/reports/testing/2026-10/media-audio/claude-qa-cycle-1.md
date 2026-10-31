## QA report — cycle 1/6

**Run:** `lastcall-072-media-audio-2026-10-31:1` · **Candidate:** 0.7.2/code12, base `5666d31` + uncommitted working tree (confirmed `app.config.ts:10,29`, package versions) · **Verdict: PASS** (no actionable confirmed findings in allocated scope)

**Skills:** `READ_FALLBACK` — before any test I explicitly read the full bodies of `systematic-debugging`, `run-quality-gate`, and `webapp-testing` from `~/.claude/skills/.../SKILL.md`. YAML preload was not assumed. Repo-native npm/TypeScript/Playwright gates were used, not a new Python suite.

### Executed exactly once (Node v24.22.1, isolated 18879/15174)

`sh .tmp/current/claude-qa-media-audio-1.sh` → `SCRIPT_EXIT=0`

| Gate | Exit | Result | Log |
|---|---|---|---|
| `npm run check` | 0 | lint 1 warning/0 errors; typecheck all workspaces passed; mobile 95 pass / server 71 / core 197 (363 total, 0 fail); Expo export iOS+Android, probe/server builds, core `tsc` | `.tmp/current/claude-qa/cycle-1-check.log` |
| `npm run test:e2e` | 0 | 12 tests: 11 passed, 1 skipped (TURN), 1.5m | `.tmp/current/claude-qa/cycle-1-e2e.log` |

The single lint warning is pre-existing `VoiceNote.tsx:33` (`react-hooks/exhaustive-deps`), file not in this diff; non-blocking. TURN skip is an environment limitation, **not** a pass. Native APK build was not re-run by me (no Gradle/emulator); APK SHA `d5d0839a…a951` remains Codex-provided evidence.

### Scope reviewed (diff, new tests, contracts)
- **Waveform:** `waveform-model.ts:5-12`, `RecordingWaveform.tsx:10-27`, `MediaComposer.tsx:18,143-145,165`. Verified against installed expo-audio **58.0.10** source: `isMeteringEnabled` option and `metering` status exist (`Audio.types.d.ts:311-312,409-411`), Android computes dBFS (`AudioRecorder.kt:67-85`), iOS `averagePower` (`AudioRecorder.swift:250`). Missing meter stays `null`, never fabricated; no native/mic claim made from unit tests.
- **Mixed chronology:** `timeline-model.ts:8-14`, chat and tab wiring (`chat/[id].tsx:133,145-151`, `index.tsx:100-104`). Sorting is immutable/deterministic; receipt/progress/restart fields don’t reorder entries (`tests/timeline.test.ts`). Attachment-only and preview cases covered.
- **Direct-file timing:** `direct-file.ts:5-31`, `messenger.ts:306-319,421`, `tests/direct-file.test.ts`. Verified: opaque metadata accepted by strict file-start frame; legacy/undefined and foreign metadata fall back; known-invalid timing rejected; sender restart/offline preserves original timestamp+7-day deadline; replay retains previously accepted bytes; expiry during blob/state persistence yields no ACK/readable bytes. ACK gating confirmed in `session.ts:471-478` (`file-ack` only after `onFile` resolves successfully). Legacy lost-ACK replay test passes.
- **Call audio:** `call-audio-model.ts:10-74`, `call-audio.ts:9-32`, `LastCallAudioRoutes.java:31-36,38-88,112-151`, `LastCallAudioService.java:36,84,90`, `CallOverlay.tsx:24,40,53`, `tests/call-audio.test.ts`. CODE_TRACE: incoming hyphenated UUID and outgoing raw 32-hex ids both canonicalize at the native boundary (`canonical`, lines 31-36), while core call IDs are 32-hex lowercase, so the JS exact-match guard cannot reject native events; stale end actions are call-scoped; selection is acknowledged only from observed device state. No false hardware claims.

### Findings
No actionable confirmed regression in the reviewed new scope. Residual non-blocking hypothesis (unconfirmed): manifest declares legacy `BLUETOOTH` maxSdk30 only (`withLastCallCalls.cjs:8-11`), no `BLUETOOTH_CONNECT`; whether an OEM enforces it for API31+ `setCommunicationDevice` to a BT endpoint is unverified here. Treat as a physical-device acceptance question, not a demonstrated bug.

### Remaining untested / environment limits
Physical Bluetooth/earpiece/speaker/wired routing and Android 12+ BT-permission behavior; actual microphone waveform and heard audio quality; native CallKeep/CallOverlay UI; sender/recipient restart on a real device; iOS/APNs; lockscreen, Russian carrier, DPI. Browser E2E audio is functional WebRTC only, not native route evidence. Human owns phone UI acceptance.

**Stop decision:** neither STOP_REQUIRED nor BLOCKED. No fixes, retries, source/test/docs/ledger edits, emulator or deployment were performed. Root can save this report as `docs/reports/testing/2026-10/media-audio/claude-qa-cycle-1.md` without overwriting history.

---
Claude session_id: e6525745-e283-49af-acf3-153f3814413a
Estimated cost: $2.182392
Turns: 55
