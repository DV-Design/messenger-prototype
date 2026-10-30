# Claude QA cycle 3/6 — PASS

Date: 2026-10-30. Allocation `lastcall-060-qa-2026-10-30:3` was recorded before dispatch. Candidate LastCall0.7.0/code10, base a654ba5 plus current changes. Independent read-only tester `lastcall-release-tester` ran through the configured Claude Code MCP bridge; session `8a88f550-7eb0-4a32-b9b7-a8b0e956a554`, estimated cost $1.152863, 42 turns. No counter reset, product edits, hidden full-gate retry or native UI campaign.

All three required skills were explicitly read before testing: systematic-debugging, run-quality-gate, webapp-testing (`READ_FALLBACK`, not YAML preload).

## Executed once

`/bin/sh .tmp/current/claude-qa-baseline.sh`, Node24.22.1, isolated Playwright ports18879/15174, exited0.

- `npm run check`: lint0errors/one existing VoiceNote ref-cleanup warning; all workspace source/test typechecks and builds passed, including Android/iOS JS exports.
- Mobile63 + server59 + core170 = **292 tests passed**, zero failed/skipped.
- Existing functional browser suite: **10 passed, 1 skipped, zero failed**,21.3s. Authenticated external TURN case was skipped, not passed.
- New real WebRTC text/file case passed: durable delivery remained unread, recipient read while author offline, both managers restarted, signed read receipts replayed for original IDs and exact2049-byte attachment.
- Ignored logs: `.tmp/current/claude-qa/cycle-3-check.log` and `cycle-3-e2e.log`. Parent independently inspected their totals and successful build/browser output.

## Review and boundaries

Tester reviewed receipt signature/content/member binding, durable rollback/replay, foreground/focus read guard, call-specific bounded wake, current-call cancellation guards and video loss/budget recovery. No confirmed regression was reported. Low-confidence observations about three pending native UUID slots and unavailable sender file bytes were explicitly hypotheses, not reproduced defects. High-latency zero-loss links without estimates rely on native WebRTC congestion control and need real-network observation.

APK build/hash/install and lockscreen/carrier behavior were **not tested by this worker**. Main separately compiled the native APK with a forced current JS bundle and verified its signature/metadata; native evidence belongs in the separate release report. Physical phones, Russian carriers, APNs/iOS, DPI and perceived video/audio quality are not established by these gates.

Decision: PASS for this allocated automated scope. Three of six allocations used; no further tester pass dispatched.
