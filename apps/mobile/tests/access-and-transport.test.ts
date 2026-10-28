import assert from 'node:assert/strict';
import test from 'node:test';
import { PERMISSION_ORDER, hasAccess, inSequence, normalizeAccess } from '../src/permission-model';
import { transportNotice } from '../src/transport-notice';
import type { SessionSnapshot } from '@messenger/core';
test('limited photo access and blocked denial retain their OS semantics', () => {
  assert.equal(hasAccess(normalizeAccess({ granted: true, accessPrivileges: 'limited' })), true);
  assert.equal(normalizeAccess({ status: 'denied', canAskAgain: false }).canAskAgain, false);
  assert.equal(hasAccess({ status: 'unavailable', canAskAgain: false }), false);
});
test('only active features request permissions sequentially and survive one denial', async () => {
  let active = 0; let maximum = 0;
  const visited: string[] = [];
  const results = await inSequence(PERMISSION_ORDER, async kind => {
    active++; maximum = Math.max(maximum, active); visited.push(kind);
    await Promise.resolve(); active--;
    if (kind === 'camera') throw new Error('Denied');
    return 'granted';
  });
  assert.deepEqual(visited, ['microphone', 'camera', 'photos', 'notifications']);
  assert.equal(maximum, 1); assert.equal(results.length, 4);
  assert.ok(results[1]?.error); assert.equal(results[3]?.result, 'granted');
});
const session = (status: SessionSnapshot['status'], error?: string): SessionSnapshot => ({ status, error, messages: [], files: [], callState: 'idle', muted: false, route: 'unknown', stats: {} });
test('directory presence is never presented as successful peer delivery', () => {
  const failed = transportNotice({ directory: 'online', group: false, peerOnline: true, session: session('error', 'ICE timeout'), pending: 1 });
  assert.match(failed.text, /Сервер подключён, но связь с собеседником не установлена/);
  assert.equal(failed.warning, true);
  const offline = transportNotice({ directory: 'online', group: false, peerOnline: false, pending: 1 });
  assert.match(offline.text, /Собеседник не в сети/);
  const peerUp = transportNotice({ directory: 'offline', group: false, peerOnline: false, session: session('connected'), pending: 0 });
  assert.equal(peerUp.warning, false);
  assert.match(peerUp.text, /Соединение с собеседником установлено/);
});
