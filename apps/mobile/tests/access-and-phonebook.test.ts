import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { PERMISSION_ORDER, hasAccess, inSequence, normalizeAccess } from '../src/permission-model';
import { exactLastCallUsernames, toDeviceContact } from '../src/phonebook-model';
import { transportNotice } from '../src/transport-notice';
import type { SessionSnapshot } from '@messenger/core';

test('limited contacts/photos remain usable; blocked denial directs to settings', () => {
  const limited = normalizeAccess({ status: 'granted', granted: true, accessPrivileges: 'limited', canAskAgain: false });
  assert.equal(limited.status, 'limited');
  assert.equal(hasAccess(limited), true);
  const denied = normalizeAccess({ status: 'denied', granted: false, canAskAgain: false });
  assert.equal(hasAccess(denied), false);
  assert.equal(denied.canAskAgain, false);
  assert.equal(normalizeAccess({ status: 'undetermined', canAskAgain: true }).status, 'undetermined');
});

test('request all serializes OS prompts and continues after one permission error', async () => {
  let active = 0; let maximum = 0; const visited: string[] = [];
  const results = await inSequence(PERMISSION_ORDER, async kind => {
    active += 1; maximum = Math.max(maximum, active); visited.push(kind);
    await Promise.resolve(); active -= 1;
    if (kind === 'camera') throw new Error('native permission request failed');
    return 'granted';
  });
  assert.equal(maximum, 1);
  assert.deepEqual(visited, ['contacts', 'camera', 'microphone', 'photos']);
  assert.equal(results.length, 4);
  assert.ok(results[1]?.error);
  assert.equal(results[3]?.result, 'granted');
});

test('phonebook only suggests exact branded IM/URL usernames', () => {
  const contact = { id: 'local-only', fullName: 'Alice @wrong_name', phones: [{ number: '+79991234567' }],
    imAddresses: [{ service: 'LastCall', username: '@alice_123' }, { service: 'Telegram', username: 'not_lastcall' }],
    urlAddresses: [{ label: 'LastCall', url: '@bob_123' }, { url: 'https://lienad.ru/messenger/@carol_123' }, { url: 'https://evil.test/messenger/@dave_123' }, { url: 'https://lienad.ru.evil.test/messenger/@eve_123' }] };
  assert.deepEqual(exactLastCallUsernames(contact), ['alice_123', 'bob_123', 'carol_123']);
  assert.deepEqual(exactLastCallUsernames({ id: 'x', fullName: '@alice_123', phones: [{ number: 'alice_123' }] }), []);
});

test('malformed/unrelated URLs, credentials and query tricks cannot create matches', () => {
  const urls = ['https://u:p@lienad.ru/messenger/@alice', 'https://lienad.ru/messenger/@alice?next=evil', 'https://lienad.ru/messenger/@alice#x', 'http://lienad.ru/messenger/@alice', 'https://lienad.ru:444/messenger/@alice', 'https://t.me/alice', 'lastcall://other/alice'];
  assert.deepEqual(exactLastCallUsernames({ id: 'x', urlAddresses: urls.map(url => ({ url })) }), []);
});

test('local phonebook records preserve local display data without inferring directory identity', () => {
  const result = toDeviceContact({ id: 'private-id', fullName: '  Иван  ', phones: [{ number: ' +79990000000 ' }, { number: '+79990000000' }, {}] });
  assert.deepEqual(result, { id: 'private-id', name: 'Иван', phones: ['+79990000000'], usernames: [] });
  assert.equal('userId' in result, false);
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
