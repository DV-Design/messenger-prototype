# Local QA progress panel verification

Date: 2026-10-30. Scope: `infra/qa/monitor.mjs`, `monitor.html` and
`monitor.test.mjs`. This is a focused source and functional check of the progress
tool, not an additional independent LastCall tester allocation or evidence of
native phone behavior.

Verdict: PASS for the local, read-only progress surface. No confirmed blocking
finding in the reviewed scope. The application candidate remains in development
under allocation 3/6; the panel does not imply that candidate passed.

## Observed behavior and boundaries

- The executable binds to `127.0.0.1:18946`. Its HTTP surface accepts only GET
  `/` and GET `/api/status`; unknown paths return 404 and mutations return 405.
  It serves no arbitrary file or command endpoint.
- Status is a constructed allowlist, not a dump of the JSON state or logs.
  Session IDs, command text, scope text, paths, costs and raw log lines are
  omitted. A sentinel test confirms those fields cannot leak through the API.
- State, status names and cycle limits are validated. Missing or malformed state
  yields unknown status. Contradictory stored/log totals cannot become a pass.
  Each file read is bounded to 2 MiB; unreadable or oversized input is unavailable.
- Only the active allocation's two known log names are read. In current cycle 3,
  the historical 264 unit passes and 9 browser passes/1 skip are explicitly
  labelled “Последняя полная проверка — цикл 2”; current results remain absent
  until current-cycle evidence exists.
- The optional activity event describes a real observed transition. Read time
  and activity time are separate. Evidence older than 60 seconds is explicitly
  stale; refreshing the page does not invent a new worker event or percentage.
- The UI polls its same-origin endpoint every two seconds while visible, aborts
  requests after a deadline, and prevents overlapping requests. API text is
  inserted with `textContent`; there are no external scripts, styles or telemetry.
  Disconnection preserves prior results with an explicit stale-data warning.
- The panel is observational. There is no run/retry control, no counter edit and
  no automatic worker restart. It does not establish worker liveness or expose
  internal reasoning. Its server process must remain running to show updates.

## Checks actually executed

Commands run independently after reading the source:

```sh
node --check infra/qa/monitor.mjs
node --test infra/qa/monitor.test.mjs
```

Both exited 0. The focused suite completed with 9 tests passed, 0 failed,
0 skipped. Coverage includes malformed/missing state, active-cycle isolation,
historical totals and skips, redaction sentinel, stale activity, waiting/report
states, HTTP route/method restrictions and safe standalone HTML rendering.

The parent additionally verified a live HTTP response and opened the panel in
the in-app browser: cycle 3/6, background-call development stage, no current test
results and clearly labelled cycle-2 results were visible. No screenshot matrix,
phone UI campaign, production deployment or native call/video verification was
performed for this tool.

## Run and handoff

Run `node infra/qa/monitor.mjs` from the repository root and open
<http://127.0.0.1:18946>. Keep the process running; Ctrl+C stops it. There is no
public hosting or service auto-install. The status producer must write real
stage events/logs; the panel cannot reconstruct activity that was never recorded.

## Subsequent gate-truth regression

The parent later found that announcing a later activity gate, such as a native
APK build, could mark the last observed npm gate passed even if its log contained
only the start heading. This was a real result-presentation bug; the initial
nine-test review did not catch it. With no logs at all, prior gates were already
kept unstarted, but partial logs exposed the erroneous activity-based inference.

A new focused regression first failed with `passed` instead of `current` for
the incomplete unit gate. The fix removes activity-driven completion entirely:
activity can identify its own current stage, while only parsed QA evidence may
complete earlier gates. The regression covers both no-log and partial-unit-log
cases. After the fix, `node --test infra/qa/monitor.test.mjs` passed10/10 with
0failures/0skips; `node --check infra/qa/monitor.mjs` and scoped `git diff --check`
also exited0. This focused tool regression did not allocate another application
QA cycle or change its persistent counter. Separately, application cycle3 later
passed; see [its report](claude-qa-cycle-3.md). The initial observations above
remain timestamped historical scope, not the candidate's final state.
