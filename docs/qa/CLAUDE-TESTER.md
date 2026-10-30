# LastCall: Claude QA protocol

Configured agent: `lastcall-release-tester`, called through `claude_worker.claude_task`;
continue the same returned session with `claude_resume`. The generic
`codex-claude-worker` and MCP server/config are unchanged.
Its installed definition is `~/.claude/agents/integrations/workers/lastcall-release-tester.md`;
the portable prompt copy is [lastcall-release-tester.md](lastcall-release-tester.md).
Skills already present in `~/.claude/skills` are preloaded with YAML `skills`:
systematic-debugging, run-quality-gate, webapp-testing. Do not silently claim a
missing skill loaded. No model override: use the configured Claude CLI default.

## Limits controlled by Codex

The durable counter is [claude-qa-state.json](claude-qa-state.json).
This run is capped at SIX tester allocations TOTAL, including baseline,
timeouts and denied/failed starts. A cycle means one allocated candidate
build + one bounded QA pass + its findings + a possible development batch.
Individual test cases/tool calls are not additional cycles. Never hide an
internal build/fix/retest loop within one allocation.

Before every tester call, Codex reads the state, refuses paused/completed or
exhausted runs, increments cycles_started and appends the candidate identity and
scope BEFORE dispatch. Pass that allocation to the worker. Do not reset the
counter after restart, compaction, a new worker session or a different bug.
Only one tester invocation may be active. Tester cannot edit the counter or
fix product code; implementation is a separate, explicitly scoped worker task.

Codex independently verifies findings before assigning minimal fixes. A retest
of a changed candidate needs the NEXT allocation. Root-cause investigation comes
first; no assertion weakening, test deletion or blanket timeout increases.
At two consecutive changed-build attempts with the same failure fingerprint and
no new evidence, stop early as paused_no_progress. If cycle6 still fails or is
blocked, stop as paused_limit. Do not dispatch cycle7. Stop even earlier for
missing required access, no meaningful independent progress, or a human stop.
No automatic resume or scheduled retry.

When stopping, send the user: cycles used, failing scenario/fingerprint,
reproduction/evidence, attempted fixes, what remains unverified, saved artifacts
and the exact input needed to continue. User must explicitly resume a paused
run. A fresh quota is not inferred from a generic "continue".

## Baseline and scope

LastCall0.6.0/code9, source4d38b90, published APK SHA256
43f0f5f50bc1f09f785c10e795724e1ed45608a1cf9ada67ed9afd3aa1ed1a0f.
Prior gates264tests and Chrome9PASS/1TURNskip are historical evidence, not this
worker's execution. Read [native evidence](../reports/debugging/2026-10/native-060.md).
Prioritize no-false-ACK/outbox recovery, notification destination scope/membership,
locked-call/media ownership, adaptive video recovery, recorder cancellation and
Android bundle input invalidation (msg-vi6).

Human owns phone UI acceptance; no layout/screenshot matrix or emulator setup.
Use existing npm/TypeScript Playwright functional suites, local fake peers and
isolated ports. Do not run heavyweight Android builds concurrently with 5MiB
crypto tests. Native APK packaging remains Codex's responsibility if code changes
justify it; rebuilding alone does not establish phone behavior.
Scope can be narrowed each round to the regression and affected paths.

Per pass, return PASS/FAIL/BLOCKED/STOP_REQUIRED, actual command exit/count/logs,
findings with severity/fingerprint/file:line/repro/expected/observed/root cause,
and explicit NOT_TESTED/ENVIRONMENT_LIMIT cases. Do not report source review or
FCM acceptance as verified native delivery. A skip is not a pass.

## Sources and prompt rationale

The prompt is tailored to this repository, using explicit success criteria,
observable evidence and separation between evaluation and implementation from
[Anthropic's evaluation guidance](https://www.anthropic.com/research/demystifying-evals-for-ai-agents).
The preload mechanism follows
[Claude Code's subagent skills documentation](https://code.claude.com/docs/en/sub-agents#preload-skills-into-subagents).
No generic copied prompt can establish LastCall's native/carrier guarantees.
