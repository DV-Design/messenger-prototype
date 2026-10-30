# Claude QA: cycle2/6

Date:2026-10-30. Scope: authenticated bridge/settings verification and one local
functional baseline. Product/APK unchanged; no native phone UI requested.

## Main-agent verification

- MCP registration enabled, uses /usr/bin/python3 and claude-mcp-server.py.
  Private provider environment exists, mode0600; no credential values read.
- MCP lists dedicated lastcall-release-tester; installed prompt body matches
  the portable repository copy. No model override or permission bypass.
- Baseline helper ran once, exit0. Main independently read generated logs:
  54mobile+59server+151core=264tests, all pass; lint/types/build pass;
  browser integration9PASS/1explicit authenticated-TURNskip.
- Worker reported READ_FALLBACK for each skill: YAML did not inject full bodies.
  Its successful explicit reads were verified by its report. Both installed and
  portable agent definitions now require reading all three exact files before
  testing if not preloaded, blocking on a missing/denied skill. This makes future
  loading explicit; no third evaluation or repeated full suite was needed.
- Count preserved:2/6 allocated, cycle1 blockedauth, cycle2passed. Stop after
  this pass; no cycle3/fix/rebuild/deployment/recursive worker started.
- Physical/native UI, live FCM/APNs and Russian-carrier quality are not covered
  by these gates. Existing phone acceptance issues remain open.

## Worker response

## Cycle 2/6 verdict: **PASS** (config + gates verified; no new actionable findings)

### Identity / settings confirmed

| Item | Fact |
|---|---|
| Agent identity | `lastcall-release-tester`; bridge call succeeded, so the reported auth fix is operationally confirmed |
| Mode | Read-only product source; one QA pass; no fixes, edits, commits, pushes, deploys, or spawned agents |
| Cycle cap | 6 total. State `cycles_started=2`, cycle 2 allocated as `lastcall-060-qa-2026-10-30:2`, status running, `max_cycles=6` |
| Stop behavior | STOP_REQUIRED at cycle>6, missing allocation, paused run, or same failure twice without new evidence; at 6 finish and pause. Timeout/permission/infra = BLOCKED, never PASS. No rerun on failure |
| `systematic-debugging` | **READ_FALLBACK** — not in startup body; principle: “NO FIXES WITHOUT ROOT CAUSE INVESTIGATION FIRST” |
| `run-quality-gate` | **READ_FALLBACK** — principle: exit 0 passes regardless of output; non-zero on a blocking gate stops the gate sequence |
| `webapp-testing` | **READ_FALLBACK** — principle: reconnaissance-then-action, wait for `networkidle` before DOM inspection. Applied via the repo’s npm/TypeScript Playwright suite, **not** a new Python suite |

I did not modify `docs/qa/claude-qa-state.json` or any product/config file.

### Build identity
- HEAD `a654ba5`; product source release `4d38b90`. Diff `4d38b90..HEAD` = docs/QA config only, plus `.beads/issues.jsonl`; **no product source change**. APK 0.6.0/code9 remains the artifact under test; none rebuilt/published here.

### Commands executed (exactly once)
`/bin/sh .tmp/current/claude-qa-baseline.sh` → **exit 0**, Node **v24.22.1**, isolated ports 18879/15174.

| Gate | Result | Log |
|---|---|---|
| `npm run check` | PASS — lint 0 errors/1 warning; typecheck all 4 workspaces clean; build all workspaces incl. Expo Android+iOS exports | `.tmp/current/claude-qa/cycle-2-check.log` |
| Unit tests | **264 passed**: mobile 54, server 59, core 151; 0 failed/skipped | same |
| `npm run test:e2e` | **9 passed, 1 skipped (19.2s)**; skip = authenticated TURN (`PW_TEST_TURN!='1'`) | `.tmp/current/claude-qa/cycle-2-e2e.log` |

The TURN skip is **not** a pass. Historical evidence remains 9 PASS/1 TURN skip, consistent with this run. Non-blocking observations: pre-existing ESLint warning `VoiceNote.tsx:33` (`react-hooks/exhaustive-deps`, ref mutated in cleanup) and esbuild `dist/main.js 1.0mb` size advisory. Neither is a new regression; lint exits 0.

### Findings
**No CONFIRMED new finding.** Focused source review supports intact boundaries:
- Preview != durable ACK: `push-previews.ts:61` explicitly never adds a chat record/ACK; preview model only displays after authenticated open; observer path (`push-previews.ts:81-90`) waits for the durable record and fails closed on save error.
- Tap destination/pinned scope: `notification-navigation-model.ts:6-8` validates exact 2-key destination (DM/group ID + 64-hex scope), 60s deadline, matching local scope, and membership before navigating; foreign/invalid scopes discarded.
- Video recovery: core 151 tests include paused/stale-RTCP recovery (msg-si6 note); no browser regression observed.
- Recorder cleanup/permissions: 54 mobile tests cover cancel-before-send, playback ownership, denial and Home-cancel; no failing trace found.

Known limitations **not** rebranded: msg-vi6 (Android bundle input invalidation), msg-46e (circle finalize/playback on phones), msg-si6 (fullscreen/adaptive video, real carrier bandwidth) remain open; msg-3z9/msg-9rr physical Android/iOS/carriers.

### NOT_TESTED / ENVIRONMENT_LIMIT
Native phone UI, physical Android/iOS, APNs/FCM live delivery, Russian carriers, lockscreen presentation/intelligibility/DPI, circle finalize, and real constrained-bandwidth video were **not tested** and are not claimed. TURN relay path skipped locally (no configured TURN secret).

### Stop decision
**PASS for cycle 2; stop here.** No cycle 3 is requested or consumed. Recommend Codex record cycle 2 as passed and do **not** allocate a new cycle unless a changed product build appears; phone UI acceptance remains user-owned. Remaining blockers are acceptance coverage, not newly introduced regressions.

---
Claude session_id: 050ab6ce-b7cb-4ab7-aaf8-9146ef539efe
Estimated cost: $0.506173
Turns: 28
