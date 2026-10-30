import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { buildStatus, createMonitorServer } from './monitor.mjs';

const STATE_PATH = path.join('docs', 'qa', 'claude-qa-state.json');
const LOG_DIR = path.join('.tmp', 'current', 'claude-qa');

function makeState(overrides = {}) {
  const now = Date.now();
  return {
    run_id: 'fixture-run',
    max_cycles: 6,
    cycles_started: 3,
    status: 'developing',
    agent: 'lastcall-release-tester',
    session_id: 'SESSION-SENTINEL-abc',
    stop_on_same_failure_without_new_evidence: 2,
    cycles: [
      {
        cycle: 1,
        status: 'blocked_auth',
        verdict: 'BLOCKED',
        commands_executed: ['SENTINEL-COMMAND-ONE'],
        estimated_cost_usd: 0,
        session_id: 'SESSION-SENTINEL-one',
      },
      {
        cycle: 2,
        status: 'passed',
        verdict: 'PASS',
        unit_tests: { passed: 264, failed: 0 },
        browser_tests: { passed: 9, skipped: 1, failed: 0 },
        estimated_cost_usd: 0.506173,
        commands_executed: ['SENTINEL-COMMAND-TWO'],
      },
      {
        cycle: 3,
        status: 'developing',
        scope: 'SENTINEL-SCOPE-ACTIVE',
        commands_executed: ['SENTINEL-COMMAND-THREE'],
      },
    ],
    requires_user_resume: false,
    last_verdict: 'PASS',
    skill_loading_verified: {
      'systematic-debugging': 'READ_FALLBACK',
      'run-quality-gate': 'READ_FALLBACK',
      'webapp-testing': 'READ_FALLBACK',
    },
    activity: {
      cycle: 3,
      stage: 'development',
      updated_at: new Date(now - 1_000).toISOString(),
    },
    ...overrides,
  };
}

async function makeRoot(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'lastcall-qa-monitor-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

async function writeState(root, state) {
  await mkdir(path.join(root, 'docs', 'qa'), { recursive: true });
  await writeFile(path.join(root, STATE_PATH), JSON.stringify(state, null, 2));
}

async function writeLog(root, cycle, kind, text) {
  await mkdir(path.join(root, LOG_DIR), { recursive: true });
  await writeFile(path.join(root, LOG_DIR, `cycle-${cycle}-${kind}.log`), text);
}

const CHECK_LOG = `
> lastcall@0.6.0 check
> npm run lint && npm run typecheck && npm test && npm run build

> lastcall@0.6.0 lint
> eslint src

> lastcall@0.6.0 typecheck
> tsc --noEmit

> @messenger/mobile@0.6.0 test
> tsx --test tests/*.test.ts

ℹ tests 5
ℹ suites 0
ℹ pass 5
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 10

> lastcall@0.6.0 build
> npm run build
`;

const E2E_LOG = `
> lastcall@0.6.0 test:e2e
> playwright test

  ✓ 1 test
  ✓ 2 test
  - 3 test

  1 skipped
  2 passed (1.2s)
`;

const PREVIOUS_CHECK_LOG = `
> lastcall@0.6.0 lint
> lastcall@0.6.0 typecheck
> lastcall@0.6.0 test

ℹ tests 999
ℹ suites 0
ℹ pass 999
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 10

> lastcall@0.6.0 build
`;

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return server.address().port;
}

async function close(server) {
  await new Promise(resolve => {
    server.close(resolve);
    server.closeAllConnections?.();
  });
}

async function withServer(root, fn) {
  const server = createMonitorServer(root);
  const port = await listen(server);
  try {
    return await fn(`http://127.0.0.1:${port}`);
  } finally {
    await close(server);
  }
}

test('missing state is reported as unavailable, never passed', async t => {
  const root = await makeRoot(t);
  const status = await buildStatus(root, Date.now());

  assert.equal(status.status, 'unknown');
  assert.equal(status.problem, 'state_unavailable');
  assert.notEqual(status.status, 'passed');
  assert.equal(status.current.unit.available, false);
  assert.equal(status.current.browser.available, false);
  assert.equal(status.stage.label, 'Нет подтверждённых данных');
});

test('malformed and unknown-status states fail closed', async t => {
  const root = await makeRoot(t);
  await mkdir(path.join(root, 'docs', 'qa'), { recursive: true });
  await writeFile(path.join(root, STATE_PATH), '{not json');

  const broken = await buildStatus(root, Date.now());
  assert.equal(broken.status, 'unknown');
  assert.equal(broken.problem, 'state_invalid');
  assert.equal(broken.pipeline.every(item => item.status === 'unknown'), true);

  const unknownStatus = makeState({ status: 'mystery-status' });
  await writeState(root, unknownStatus);
  const rejected = await buildStatus(root, Date.now());
  assert.equal(rejected.status, 'unknown');
  assert.equal(rejected.problem, 'state_invalid');
  assert.notEqual(rejected.status, 'passed');

  const badAgent = makeState({ agent: 'not-the-configured-agent' });
  await writeState(root, badAgent);
  const wrongAgent = await buildStatus(root, Date.now());
  assert.equal(wrongAgent.status, 'unknown');
  assert.equal(wrongAgent.problem, 'state_invalid');
});

test('active cycle isolation never reuses previous cycle logs or results', async t => {
  const root = await makeRoot(t);
  await writeState(root, makeState());
  await writeLog(root, 2, 'check', PREVIOUS_CHECK_LOG);

  const before = await buildStatus(root, Date.now());
  assert.equal(before.activeCycle, 3);
  assert.equal(before.current.cycle, 3);
  assert.equal(before.current.unit.available, false);
  assert.equal(before.current.browser.available, false);
  assert.equal(JSON.stringify(before.current).includes('999'), false);

  await writeLog(root, 3, 'check', CHECK_LOG);
  await writeLog(root, 3, 'e2e', E2E_LOG);
  const after = await buildStatus(root, Date.now());
  assert.equal(after.current.unit.available, true);
  assert.equal(after.current.unit.passed, 5);
  assert.equal(after.current.unit.failed, 0);
  assert.equal(after.current.browser.available, true);
  assert.equal(after.current.browser.passed, 2);
  assert.equal(after.current.browser.skipped, 1);
  assert.equal(JSON.stringify(after.current).includes('999'), false);
});

test('previous full check is labelled with cycle 2 and skips stay separate', async t => {
  const root = await makeRoot(t);
  await writeState(root, makeState());

  const status = await buildStatus(root, Date.now());
  assert.equal(status.previousFullCheck.cycle, 2);
  assert.equal(status.previousFullCheck.label, 'Последняя полная проверка — цикл 2');
  assert.equal(status.previousFullCheck.unit.passed, 264);
  assert.equal(status.previousFullCheck.unit.skipped, 0);
  assert.equal(status.previousFullCheck.browser.passed, 9);
  assert.equal(status.previousFullCheck.browser.skipped, 1);
  assert.equal(status.previousFullCheck.browser.failed, 0);

  assert.equal(status.current.unit.available, false);
  assert.equal(JSON.stringify(status.current).includes('264'), false);
  assert.equal(JSON.stringify(status.current).includes('"passed":9'), false);

  const cycleTwo = status.history.find(item => item.cycle === 2);
  assert.equal(cycleTwo.label, 'Пройден');
  assert.equal(cycleTwo.browser.skipped, 1);
});

test('redaction sentinel cannot leak through the HTTP status projection', async t => {
  const root = await makeRoot(t);
  await writeState(root, makeState({
    session_id: 'SESSION-SENTINEL-abc',
    cycles: makeState().cycles.map((cycle, index) => index === 1
      ? { ...cycle, scope: 'SENTINEL-SCOPE-PREVIOUS', absolute_path: '/Users/sentinel/private' }
      : cycle),
  }));
  await writeLog(root, 3, 'check', `${CHECK_LOG}\nSENTINEL-LOG-LINE /Users/sentinel/private/check.log\n`);

  await withServer(root, async base => {
    const response = await fetch(`${base}/api/status`, { signal: AbortSignal.timeout(3_000) });
    assert.equal(response.status, 200);
    const body = await response.text();

    for (const secret of [
      'SESSION-SENTINEL',
      'SENTINEL-COMMAND',
      'SENTINEL-SCOPE',
      'SENTINEL-LOG-LINE',
      '/Users/sentinel',
      'estimated_cost_usd',
      'commands_executed',
      'session_id',
      'tokens',
    ]) {
      assert.equal(body.includes(secret), false, `leaked ${secret}`);
    }
    assert.equal(body.includes('"agent":"lastcall-release-tester"'), true);
  });
});

test('stale activity is explicit and sample time stays separate', async t => {
  const root = await makeRoot(t);
  const now = Date.now();
  const activityAt = new Date(now - 300_000).toISOString();
  await writeState(root, makeState({
    activity: { cycle: 3, stage: 'development', updated_at: activityAt },
  }));

  const status = await buildStatus(root, now);
  assert.equal(status.stale, true);
  assert.equal(status.staleLabel, 'Давно нет новых событий');
  assert.equal(status.activityAt, activityAt);
  assert.equal(status.readAt, new Date(now).toISOString());
  assert.notEqual(status.activityAt, status.readAt);
  assert.equal(status.stage.label, 'Разработка');
});

test('running with no evidence waits; finished gates await the report', async t => {
  const emptyRoot = await makeRoot(t);
  const waitingState = makeState({
    status: 'running',
    cycles: makeState().cycles.map((cycle, index) => index === 2 ? { ...cycle, status: 'running' } : cycle),
    activity: undefined,
  });
  await writeState(emptyRoot, waitingState);
  const waiting = await buildStatus(emptyRoot, Date.now());
  assert.equal(waiting.status, 'running');
  assert.equal(waiting.stage.label, 'Задача назначена · ждём событие');
  assert.equal(waiting.stage.source, 'none');
  assert.equal(waiting.stale, true);

  const finishedRoot = await makeRoot(t);
  await writeState(finishedRoot, waitingState);
  await writeLog(finishedRoot, 3, 'check', CHECK_LOG);
  await writeLog(finishedRoot, 3, 'e2e', E2E_LOG);
  const finished = await buildStatus(finishedRoot, Date.now());
  assert.equal(finished.status, 'running');
  assert.equal(finished.stage.label, 'Проверки завершены · ожидается отчёт');
  assert.equal(finished.stage.source, 'log');
  assert.equal(finished.pipeline.every(item => item.status === 'passed'), true);
});

test('activity marks only its own gate current and never proves an earlier gate passed', async t => {
  const root = await makeRoot(t);
  // Native APK work can be announced independently of the full npm QA pipeline.
  // A later activity timestamp is not proof that any earlier npm gate finished.
  const now = Date.now() + 1_000;
  await writeState(root, makeState({
    activity: { cycle: 3, stage: 'build', updated_at: new Date(now).toISOString() },
  }));
  const noLogs = await buildStatus(root, now);
  assert.equal(noLogs.stage.key, 'build');
  assert.equal(noLogs.stage.source, 'activity');
  assert.deepEqual(noLogs.pipeline.map(item => [item.key, item.status]), [
    ['lint', 'not_started'], ['typecheck', 'not_started'], ['unit', 'not_started'],
    ['build', 'current'], ['browser', 'not_started'],
  ]);

  await writeLog(root, 3, 'check', '> @messenger/mobile@0.7.0 test\n> tsx --test tests/*.test.ts\n');
  const partial = await buildStatus(root, now);
  assert.equal(partial.stage.key, 'build');
  assert.equal(partial.stage.source, 'activity');
  assert.equal(partial.pipeline.find(item => item.key === 'unit').status, 'current');
  assert.equal(partial.pipeline.find(item => item.key === 'build').status, 'current');
  assert.equal(partial.pipeline.some(item => item.status === 'passed'), false);
  assert.equal(partial.current.unit.available, false);
});

test('local HTTP surface exposes only GET / and GET /api/status', async t => {
  const root = await makeRoot(t);
  await writeState(root, makeState());
  await writeLog(root, 3, 'check', CHECK_LOG);
  await writeLog(root, 3, 'e2e', E2E_LOG);

  await withServer(root, async base => {
    const page = await fetch(`${base}/`, { signal: AbortSignal.timeout(3_000) });
    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-type'), /text\/html/);
    assert.match(await page.text(), /<!doctype html>/i);

    const api = await fetch(`${base}/api/status`, { signal: AbortSignal.timeout(3_000) });
    assert.equal(api.status, 200);
    assert.match(api.headers.get('content-type'), /application\/json/);
    assert.match(api.headers.get('cache-control'), /no-store/);
    const payload = await api.json();
    assert.equal(payload.status, 'developing');
    assert.equal(payload.current.unit.passed, 5);

    for (const pathname of ['/monitor.html', '/docs/qa/claude-qa-state.json', '/api/status/extra', '/etc/passwd', '/not-found']) {
      const response = await fetch(`${base}${pathname}`, { signal: AbortSignal.timeout(3_000) });
      assert.equal(response.status, 404, pathname);
    }

    const post = await fetch(`${base}/api/status`, {
      method: 'POST',
      signal: AbortSignal.timeout(3_000),
    });
    assert.equal(post.status, 405);
    assert.equal(post.headers.get('allow'), 'GET');
  });
});

test('standalone HTML has responsive, safe rendering and truthful labels', async () => {
  const html = await readFile(new URL('./monitor.html', import.meta.url), 'utf8');

  for (const required of [
    'prefers-color-scheme',
    'AbortController',
    'setInterval',
    'textContent',
    "cache: 'no-store'",
    'aria-current',
    '<details',
    'Автообновление',
    'data.staleLabel',
    'data.stage.label',
    'Результатов текущего цикла пока нет.',
    'Пропуск не засчитывается как успех.',
    'Запуск, повтор и обход лимита шести циклов здесь недоступны.',
  ]) {
    assert.equal(html.includes(required), true, `missing ${required}`);
  }

  assert.equal(html.includes('innerHTML'), false);
  assert.equal(html.includes('insertAdjacentHTML'), false);
  assert.equal(html.includes('<script src'), false);
  assert.equal(html.includes('<link rel="stylesheet"'), false);
  assert.equal(html.includes('https://'), false);
  assert.equal(html.includes('http://'), false);
});
