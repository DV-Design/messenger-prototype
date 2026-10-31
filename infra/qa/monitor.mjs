import http from 'node:http';
import { open, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const HTML_FILE = new URL('./monitor.html', import.meta.url);
const STATE_FILE = path.join('docs', 'qa', 'claude-qa-state.json');
const LOG_DIR = path.join('.tmp', 'current', 'claude-qa');
const AGENT = 'lastcall-release-tester';
// Explicit operator extension for the user-approved single seventh allocation.
const MAX_CYCLES = process.env.LASTCALL_QA_MAX_CYCLES === '7' ? 7 : 6;
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const STALE_MS = 60_000;
const HOST = '127.0.0.1';
const DEFAULT_PORT = 18946;

const PIPELINE = [
  ['lint', 'Стиль кода'],
  ['typecheck', 'Проверка типов'],
  ['unit', 'Модульные тесты'],
  ['build', 'Сборка'],
  ['browser', 'Интеграционные тесты'],
];
const PIPELINE_KEYS = PIPELINE.map(([key]) => key);

const STAGE_LABELS = {
  development: 'Разработка',
  development_calls: 'Фоновые вызовы и собственный экран звонка LastCall',
  development_receipts: 'Подтверждения доставки и прочтения сообщений',
  development_video: 'Качество и задержки видео',
  allocated: 'Задача назначена',
  skills: 'Чтение инструкций',
  lint: 'Стиль кода',
  typecheck: 'Проверка типов',
  unit: 'Модульные тесты',
  build: 'Сборка',
  browser: 'Интеграционные тесты',
  review: 'Разбор результатов',
};
const STAGE_KEYS = new Set(Object.keys(STAGE_LABELS));

const RUN_STATUS = {
  developing: { status: 'developing', label: 'Идёт разработка', active: true },
  allocated: { status: 'running', label: 'Задача назначена', active: true },
  running: { status: 'running', label: 'Проверка идёт', active: true },
  idle_pass: { status: 'passed', label: 'Проверка завершена', active: false },
  completed_pass: { status: 'passed', label: 'Проверка завершена', active: false },
  passed: { status: 'passed', label: 'Цикл пройден', active: false },
  idle_fail: { status: 'failed', label: 'Проверка выявила ошибки', active: false },
  completed_fail: { status: 'failed', label: 'Проверка выявила ошибки', active: false },
  failed: { status: 'failed', label: 'Есть ошибки', active: false },
  paused_access: { status: 'blocked', label: 'Пауза: нужен доступ', active: false },
  blocked_auth: { status: 'blocked', label: 'Заблокировано: нужна авторизация', active: false },
  blocked: { status: 'blocked', label: 'Заблокировано', active: false },
  paused_no_progress: { status: 'paused', label: 'Пауза: нет новых результатов', active: false },
  paused_limit: { status: 'paused', label: 'Пауза: лимит циклов', active: false },
  paused_user: { status: 'paused', label: 'Остановлено пользователем', active: false },
  paused: { status: 'paused', label: 'На паузе', active: false },
  timeout: { status: 'blocked', label: 'Истекло время', active: false },
};

const CYCLE_STATUS = {
  developing: { status: 'current', label: 'Текущий' },
  allocated: { status: 'current', label: 'Назначен' },
  running: { status: 'current', label: 'В работе' },
  passed: { status: 'passed', label: 'Пройден' },
  idle_pass: { status: 'passed', label: 'Пройден' },
  completed_pass: { status: 'passed', label: 'Пройден' },
  blocked_auth: { status: 'blocked', label: 'Нет авторизации' },
  blocked: { status: 'blocked', label: 'Заблокирован' },
  paused_access: { status: 'blocked', label: 'Нужен доступ' },
  timeout: { status: 'blocked', label: 'Истекло время' },
  failed: { status: 'failed', label: 'Есть ошибки' },
  idle_fail: { status: 'failed', label: 'Есть ошибки' },
  completed_fail: { status: 'failed', label: 'Есть ошибки' },
  paused_no_progress: { status: 'paused', label: 'Нет прогресса' },
  paused_limit: { status: 'paused', label: 'Лимит' },
  paused_user: { status: 'paused', label: 'Остановлен' },
  paused: { status: 'paused', label: 'Пауза' },
  not_started: { status: 'not_started', label: 'Не начат' },
};

const STOP_REASONS = {
  paused_no_progress: 'Нет новых данных для следующей попытки.',
  paused_limit: 'Достигнут разрешённый предел циклов.',
  paused_access: 'Для продолжения нужен доступ.',
  blocked_auth: 'Тесты не начались: нужна авторизация.',
  paused_user: 'Остановка по запросу пользователя.',
  idle_fail: 'Найдены ошибки; следующая попытка не запущена.',
  failed: 'Найдены ошибки; следующая попытка не запущена.',
  idle_pass: 'Цикл завершён. Следующий цикл не запускался.',
  passed: 'Цикл завершён. Следующий цикл не запускался.',
};

const SKILLS = ['systematic-debugging', 'run-quality-gate', 'webapp-testing'];
const SKILL_LABELS = { PRELOADED: 'Загружено заранее', READ_FALLBACK: 'Прочитано явно' };

const EMPTY_PROBLEM = 'state_invalid';

const isCount = value => Number.isInteger(value) && value >= 0 && value <= 1_000_000;
const emptyTotals = () => ({ passed: 0, failed: 0, skipped: 0, available: false });
const sameTotals = (a, b) => a.passed === b.passed && a.failed === b.failed && a.skipped === b.skipped;
const iso = value => Number.isFinite(value) ? new Date(value).toISOString() : null;
const parseTime = value => typeof value === 'string' ? Date.parse(value) : NaN;
const stripAnsi = value => value.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');

function storedTotals(value) {
  if (!value || typeof value !== 'object' || !isCount(value.passed) || !isCount(value.failed)) return null;
  if (value.skipped !== undefined && !isCount(value.skipped)) return null;
  return { passed: value.passed, failed: value.failed, skipped: value.skipped ?? 0, available: true };
}

function totalsOrEmpty(value) {
  return storedTotals(value) ?? emptyTotals();
}

function parseCheckLog(text) {
  const stages = [];
  const totals = emptyTotals();
  let node = null;

  const finishNode = () => {
    if (node && isCount(node.pass) && isCount(node.fail)) {
      totals.passed += node.pass;
      totals.failed += node.fail;
      totals.skipped += node.skipped ?? 0;
      totals.available = true;
    }
    node = null;
  };

  for (const raw of stripAnsi(text).split(/\r?\n/)) {
    const line = raw.trim();
    const heading = /^>\s+(?:lastcall|@messenger\/[a-z0-9-]+)@\S+\s+(lint|typecheck|test|build)\s*$/.exec(line);
    if (heading) {
      finishNode();
      const key = heading[1] === 'test' ? 'unit' : heading[1];
      if (!stages.includes(key)) stages.push(key);
      continue;
    }
    const nodeLine = /^ℹ\s+(tests|pass|fail|skipped)\s+(\d+)\s*$/.exec(line);
    if (nodeLine) {
      const [, key, value] = nodeLine;
      if (key === 'tests') {
        finishNode();
        node = { tests: Number(value) };
      } else if (node) {
        node[key] = Number(value);
      }
      if (node && key === 'skipped') finishNode();
      continue;
    }
    if (/^ℹ\s+duration_ms\s+/.test(line)) {
      finishNode();
      continue;
    }
    if (/^\s*Tests\s+/.test(raw)) {
      for (const match of raw.matchAll(/(\d+)\s+(passed|failed|skipped)/g)) {
        totals[match[2]] += Number(match[1]);
        totals.available = true;
      }
    }
  }
  finishNode();
  return { stages, totals };
}

function parseBrowserLog(text) {
  const clean = stripAnsi(text);
  const totals = emptyTotals();
  for (const raw of clean.split(/\r?\n/)) {
    const match = /^\s*(\d+)\s+(passed|failed|skipped)(?:\s+\([^)]*\))?\s*$/.exec(raw);
    if (match) {
      totals[match[2]] = Number(match[1]);
      totals.available = true;
    }
  }
  return { started: /^>\s+lastcall@\S+\s+test:e2e\s*$/m.test(clean), totals };
}

function validState(state) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) return false;
  if (state.agent !== AGENT || state.max_cycles !== MAX_CYCLES) return false;
  if (!Number.isInteger(state.cycles_started) || state.cycles_started < 0 || state.cycles_started > MAX_CYCLES) return false;
  if (!Array.isArray(state.cycles) || !RUN_STATUS[state.status]) return false;
  const seen = new Set();
  for (const cycle of state.cycles) {
    if (!cycle || typeof cycle !== 'object' || Array.isArray(cycle)) return false;
    if (!Number.isInteger(cycle.cycle) || cycle.cycle < 1 || cycle.cycle > state.cycles_started) return false;
    if (seen.has(cycle.cycle) || !CYCLE_STATUS[cycle.status]) return false;
    seen.add(cycle.cycle);
  }
  if (seen.size !== state.cycles_started) return false;
  if (RUN_STATUS[state.status].status === 'passed') {
    const active = state.cycles.find(cycle => cycle.cycle === state.cycles_started);
    if (!active || CYCLE_STATUS[active.status]?.status !== 'passed') return false;
    if (active.exit_code !== undefined && active.exit_code !== 0) return false;
  }
  return true;
}

function cycleMarkers(state) {
  return Array.from({ length: MAX_CYCLES }, (_, index) => {
    const cycle = index + 1;
    const raw = state.cycles.find(item => item.cycle === cycle);
    if (!raw) return { cycle, status: 'not_started', label: 'Не начат', unit: emptyTotals(), browser: emptyTotals() };
    const mapped = CYCLE_STATUS[raw.status];
    return {
      cycle,
      status: mapped.status,
      label: mapped.label,
      unit: totalsOrEmpty(raw.unit_tests),
      browser: totalsOrEmpty(raw.browser_tests),
    };
  });
}

function cycleHistory(state) {
  return [...state.cycles]
    .sort((a, b) => a.cycle - b.cycle)
    .map(raw => {
      const mapped = CYCLE_STATUS[raw.status];
      return {
        cycle: raw.cycle,
        status: mapped.status,
        label: mapped.label,
        unit: totalsOrEmpty(raw.unit_tests),
        browser: totalsOrEmpty(raw.browser_tests),
      };
    });
}

function previousFullCheck(state, activeCycle) {
  let latest = null;
  for (const cycle of state.cycles) {
    if (activeCycle !== null && cycle.cycle >= activeCycle) continue;
    if (CYCLE_STATUS[cycle.status]?.status !== 'passed') continue;
    const unit = storedTotals(cycle.unit_tests);
    const browser = storedTotals(cycle.browser_tests);
    if (!unit || !browser) continue;
    if (!latest || cycle.cycle > latest.cycle) latest = { cycle: cycle.cycle, unit, browser };
  }
  if (!latest) return null;
  return {
    cycle: latest.cycle,
    label: `Последняя полная проверка — цикл ${latest.cycle}`,
    unit: latest.unit,
    browser: latest.browser,
  };
}

function skillRows(state) {
  const source = state.skill_loading_verified && typeof state.skill_loading_verified === 'object'
    ? state.skill_loading_verified
    : {};
  return SKILLS.map(name => {
    const raw = source[name];
    return {
      name,
      status: SKILL_LABELS[raw] ? raw : 'unknown',
      label: SKILL_LABELS[raw] ?? 'Не подтверждено',
    };
  });
}

function unknownStatus(now, problem = EMPTY_PROBLEM) {
  return {
    agent: AGENT,
    status: 'unknown',
    statusLabel: 'Состояние неизвестно',
    activeCycle: null,
    cyclesStarted: null,
    maxCycles: MAX_CYCLES,
    cycles: Array.from({ length: MAX_CYCLES }, (_, index) => ({
      cycle: index + 1,
      status: 'unknown',
      label: 'Нет данных',
      unit: emptyTotals(),
      browser: emptyTotals(),
    })),
    pipeline: PIPELINE.map(([key, label]) => ({ key, label, status: 'unknown' })),
    stage: { key: null, label: 'Нет подтверждённых данных', source: 'unknown' },
    current: { cycle: null, unit: emptyTotals(), browser: emptyTotals() },
    previousFullCheck: null,
    history: [],
    limits: { maxCycles: MAX_CYCLES, readOnly: true, label: 'Только просмотр' },
    skills: SKILLS.map(name => ({ name, status: 'unknown', label: 'Не подтверждено' })),
    activityAt: null,
    readAt: iso(now),
    stale: false,
    staleLabel: null,
    problem,
    stopReason: null,
  };
}

function projectStatus({ state, activeCycle, logs, now }) {
  const run = RUN_STATUS[state.status];
  const active = activeCycle === null ? null : state.cycles.find(cycle => cycle.cycle === activeCycle) ?? null;
  const rawActivity = state.activity && typeof state.activity === 'object' && !Array.isArray(state.activity)
    ? state.activity
    : null;
  const activityCycleMatches = Boolean(rawActivity) && rawActivity.cycle === activeCycle;
  const activityTime = activityCycleMatches ? parseTime(rawActivity.updated_at) : NaN;
  const activityTimeOk = Number.isFinite(activityTime) && activityTime <= now + 5_000;
  const activityStageOk = activityTimeOk && STAGE_KEYS.has(rawActivity.stage);

  const check = parseCheckLog(logs?.check?.text ?? '');
  const browserLog = parseBrowserLog(logs?.e2e?.text ?? '');
  const storedUnit = storedTotals(active?.unit_tests);
  const storedBrowser = storedTotals(active?.browser_tests);

  if (storedUnit && check.totals.available && !sameTotals(storedUnit, check.totals)) {
    return unknownStatus(now, 'results_inconsistent');
  }
  if (storedBrowser && browserLog.totals.available && !sameTotals(storedBrowser, browserLog.totals)) {
    return unknownStatus(now, 'results_inconsistent');
  }

  const unit = check.totals.available ? check.totals : storedUnit ?? emptyTotals();
  const browser = browserLog.totals.available ? browserLog.totals : storedBrowser ?? emptyTotals();

  if (run.status === 'passed') {
    if (!unit.available || (!browser.available && active?.browser_tests_status !== 'not_run')) return unknownStatus(now, 'results_unavailable');
    if (unit.failed > 0 || browser.failed > 0) return unknownStatus(now, 'results_inconsistent');
  }

  const seen = new Set([...check.stages, ...(browserLog.started ? ['browser'] : [])]);
  const seenOrder = PIPELINE_KEYS.filter(key => seen.has(key));
  const lastSeen = seenOrder.at(-1) ?? null;
  const gatesComplete = PIPELINE_KEYS.every(key => seen.has(key)) && unit.available && browser.available;
  const lastLogTime = Math.max(logs?.check?.mtime ?? 0, logs?.e2e?.mtime ?? 0) || null;
  const activityWins = activityStageOk && (lastLogTime === null || activityTime >= lastLogTime);
  const activityStage = activityWins ? rawActivity.stage : null;
  const activityGate = activityStage && PIPELINE_KEYS.includes(activityStage) ? activityStage : null;

  let stage;
  if (activityWins) {
    stage = { key: activityStage, label: STAGE_LABELS[activityStage], source: 'activity' };
  } else if (run.status === 'passed') {
    stage = { key: null, label: 'Проверка завершена', source: 'status' };
  } else if (gatesComplete && run.active) {
    stage = { key: 'report', label: 'Проверки завершены · ожидается отчёт', source: 'log' };
  } else if (lastSeen) {
    stage = { key: lastSeen, label: STAGE_LABELS[lastSeen], source: 'log' };
  } else if (run.active && run.status === 'developing') {
    stage = { key: 'development', label: 'Разработка', source: 'status' };
  } else if (run.active) {
    stage = { key: null, label: 'Задача назначена · ждём событие', source: 'none' };
  } else {
    stage = { key: null, label: 'Нет подтверждённых данных', source: 'status' };
  }

  const pipeline = PIPELINE.map(([key, label]) => {
    let status;
    if (seen.has(key)) {
      // Activity can describe separate work (for example a native APK build).
      // Only parsed gate evidence, never that activity, may complete a QA gate.
      if (gatesComplete) status = 'passed';
      else if (key === lastSeen && run.active) status = 'current';
      else status = 'passed';
    } else {
      status = 'not_started';
    }
    if (activityGate === key && run.active) status = 'current';
    if ((key === 'unit' && unit.available && unit.failed > 0)
      || (key === 'browser' && browser.available && browser.failed > 0)) status = 'failed';
    return { key, label, status };
  });

  const sourceTimes = [activityTimeOk ? activityTime : null, logs?.check?.mtime, logs?.e2e?.mtime]
    .filter(value => Number.isFinite(value) && value <= now + 5_000);
  const lastSourceActivityAt = sourceTimes.length ? Math.max(...sourceTimes) : null;
  const stale = run.active && (lastSourceActivityAt === null || now - lastSourceActivityAt > STALE_MS);

  return {
    agent: AGENT,
    status: run.status,
    statusLabel: run.label,
    activeCycle,
    cyclesStarted: state.cycles_started,
    maxCycles: MAX_CYCLES,
    cycles: cycleMarkers(state),
    pipeline,
    stage,
    current: { cycle: activeCycle, unit, browser },
    previousFullCheck: previousFullCheck(state, activeCycle),
    history: cycleHistory(state),
    limits: { maxCycles: MAX_CYCLES, readOnly: true, label: 'Только просмотр' },
    skills: skillRows(state),
    activityAt: activityTimeOk ? iso(activityTime) : null,
    readAt: iso(now),
    stale,
    staleLabel: stale ? 'Давно нет новых событий' : null,
    problem: null,
    stopReason: STOP_REASONS[state.status] ?? null,
  };
}

async function readBounded(file) {
  let handle;
  try {
    handle = await open(file, 'r');
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > MAX_FILE_BYTES) return { ok: false };
    const buffer = Buffer.alloc(stat.size + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead > MAX_FILE_BYTES) return { ok: false };
    return { ok: true, text: buffer.subarray(0, bytesRead).toString('utf8'), mtime: stat.mtimeMs };
  } catch {
    return { ok: false };
  } finally {
    await handle?.close();
  }
}

/**
 * Reads the local QA state and only the active cycle's logs, then returns a
 * strict allowlist projection. Missing or malformed input fails closed.
 */
export async function buildStatus(root = ROOT, now = Date.now()) {
  const parsedNow = typeof now === 'number' ? now : Date.parse(now);
  const at = Number.isFinite(parsedNow) ? parsedNow : Date.now();
  const stateFile = await readBounded(path.join(root, STATE_FILE));
  if (!stateFile.ok) return unknownStatus(at, 'state_unavailable');

  let state;
  try {
    state = JSON.parse(stateFile.text);
  } catch {
    return unknownStatus(at, 'state_invalid');
  }
  if (!validState(state)) return unknownStatus(at, 'state_invalid');

  const activeCycle = state.cycles_started > 0 ? state.cycles_started : null;
  const logs = {};
  if (activeCycle !== null) {
    const base = path.join(root, LOG_DIR, `cycle-${activeCycle}`);
    const [check, e2e] = await Promise.all([readBounded(`${base}-check.log`), readBounded(`${base}-e2e.log`)]);
    logs.check = check.ok ? check : null;
    logs.e2e = e2e.ok ? e2e : null;
  }
  return projectStatus({ state, activeCycle, logs, now: at });
}

const SECURITY_HEADERS = {
  'Cache-Control': 'no-store, no-cache, must-revalidate',
  Pragma: 'no-cache',
  Expires: '0',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Content-Security-Policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
};

function send(response, statusCode, body, extraHeaders = {}) {
  if (response.headersSent) return;
  const payload = Buffer.isBuffer(body) ? body : Buffer.from(String(body));
  response.writeHead(statusCode, { ...SECURITY_HEADERS, ...extraHeaders, 'Content-Length': payload.length });
  response.end(payload);
}

function sendJson(response, statusCode, value, extraHeaders = {}) {
  send(response, statusCode, JSON.stringify(value), { 'Content-Type': 'application/json; charset=utf-8', ...extraHeaders });
}

/**
 * Local-only HTTP surface: GET / and GET /api/status. No file paths, mutations
 * or external resources are accepted.
 */
export function createMonitorServer(root = ROOT) {
  const server = http.createServer(async (request, response) => {
    try {
      if (request.method !== 'GET') {
        sendJson(response, 405, { error: 'method_not_allowed' }, { Allow: 'GET' });
        return;
      }
      let pathname;
      try {
        pathname = new URL(request.url ?? '/', `http://${HOST}`).pathname;
      } catch {
        sendJson(response, 400, { error: 'bad_request' });
        return;
      }
      if (pathname === '/') {
        const html = await readFile(HTML_FILE);
        send(response, 200, html, { 'Content-Type': 'text/html; charset=utf-8' });
        return;
      }
      if (pathname === '/api/status') {
        sendJson(response, 200, await buildStatus(root, Date.now()));
        return;
      }
      sendJson(response, 404, { error: 'not_found' });
    } catch {
      if (!response.headersSent) sendJson(response, 500, { error: 'internal' });
      else response.destroy();
    }
  });
  server.headersTimeout = 5_000;
  server.requestTimeout = 5_000;
  server.keepAliveTimeout = 5_000;
  server.on('clientError', (_error, socket) => {
    if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
  });
  return server;
}

const isMain = process.argv[1] !== undefined
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const server = createMonitorServer();
  server.on('error', () => {
    process.stderr.write('Локальный QA-монитор не смог запуститься.\n');
    process.exitCode = 1;
  });
  server.listen(DEFAULT_PORT, HOST, () => {
    process.stdout.write(`QA-монитор: http://${HOST}:${DEFAULT_PORT}\n`);
  });
  const shutdown = () => server.close(() => process.exit(0));
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}
