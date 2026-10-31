# LastCall: Claude QA protocol

Configured agent: `lastcall-release-tester`, called through `claude_worker.claude_task`;
continue the same returned session with `claude_resume`. The generic
`codex-claude-worker` and MCP server/config are unchanged.
Its installed definition is `~/.claude/agents/integrations/workers/lastcall-release-tester.md`;
the portable prompt copy is [lastcall-release-tester.md](lastcall-release-tester.md).
Skills present in `~/.claude/skills` are attached with YAML `skills`:
systematic-debugging, run-quality-gate, webapp-testing. Cycle2 showed this CLI
main-agent path did not inject the full skill bodies automatically. The worker
successfully read all three files instead. Its instructions now require these
explicit reads BEFORE testing whenever bodies are absent; a missing/denied skill
blocks testing. Report PRELOADED vs READ_FALLBACK truthfully. No model override:
use the configured Claude CLI default.

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

## Explicit one-cycle extension (2026-10-31)

After the recorded pause at6/6, Codex explicitly asked for one further cycle to
fix the confirmed SDK wrapper failure, rebuild and verify real locked-screen
incoming calls. The user replied «Делай». This authorizes only allocation7;
cycle8 is not authorized. The existing run/history is preserved, base cap6 and
effective cap7 recorded in cycle_extensions. All earlier no-progress and
read-only tester rules remain. This explicit authorization overrides only the
six-cycle stop in the preceding default protocol. The local monitor runs with
LASTCALL_QA_MAX_CYCLES=7 for this approved extension; its default remains6.
A scoped pass explicitly records browser_tests_status=not_run when browser tests
were not allocated. The panel leaves their totals unavailable and never labels
that allocation as a full browser pass.

## Authentication checkpoint

Cycle1 was blocked before tests because provider authentication was absent from
the MCP process. The bridge maintainer added private provider-environment loading;
a subsequent `/tmp` hello probe and authenticated cycle2 succeeded. That standalone
hello check was connectivity-only, not a LastCall build/test cycle. Verify
registration/enabled status and auth-file mode without reading credential values.
Do not infer that an interactive /login is always needed from that generic error;
use the maintainer's bridge runbook for provider-environment setup.

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

## Local progress panel

From the repository root, run `node infra/qa/monitor.mjs`, then open
<http://127.0.0.1:18946>. The process must remain running while the panel is in
use; stop it with Ctrl+C. It binds only to the local computer and does not publish
the panel or its API. No additional packages or credentials are required.

The page refreshes every two seconds while visible. It reads the durable counter
and only `.tmp/current/claude-qa/cycle-N-check.log` and `cycle-N-e2e.log` for the
current allocation. A previous full pass is labelled with its own cycle number;
its totals are never presented as current results. Skips remain separate from
passes. The panel cannot launch work, retry checks or change the six-cycle limit.

Codex may record a real task transition in the optional state field
`activity: { cycle, stage, updated_at }`. Use the current allocation number and an
actual ISO timestamp. Allowed stages are `development`, `development_calls`,
`development_receipts`, `development_video`, `allocated`, `skills`, `lint`,
`typecheck`, `unit`, `build`, `browser` and `review`. Update this field only when
that action actually starts or new evidence establishes the transition. Never
write periodic timestamps merely to animate the panel. Test log headings may
also establish the current gate; logged test totals remain provisional until
the pass and its report are complete.

“Давно нет новых событий” means the activity/log evidence is over 60 seconds old,
not that the worker has necessarily stopped. “Данные получены”/the sample time means
the monitor read the local files, not that an agent emitted a heartbeat. The
panel does not inspect a worker's internal reasoning or prove that its process
is alive. Missing, malformed or inconsistent state is shown as unknown; loss of
the local server is shown as disconnected with an explicit stale-data warning.

The API exposes a fixed allowlist of stage/status labels and aggregate results.
It does not expose raw logs, command text, session IDs, file paths or credential
values. See [the focused review and checks](../reports/testing/2026-10/live-monitor.md).
