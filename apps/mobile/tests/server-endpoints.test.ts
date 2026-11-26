import { test } from 'node:test';
import assert from 'node:assert/strict';
import { orderedCandidates, shouldSwitch, validEndpoints } from '../src/server-endpoints-model';

test('only plain https addresses are kept, in order, without duplicates', () => {
  assert.deepEqual(validEndpoints(['https://P2P-IT.lienad.ru:4443', 'https://p2p.lienad.ru', 'http://x.example', 'https://a.example/path', 'https://p2p-it.lienad.ru:4443', 42]),
    ['https://p2p-it.lienad.ru:4443', 'https://p2p.lienad.ru']);
  assert.deepEqual(validEndpoints('nope'), []);
});

test('the account address is always the last resort', () => {
  assert.deepEqual(orderedCandidates(['https://p2p-it.lienad.ru:4443', 'https://p2p.lienad.ru'], 'https://p2p.lienad.ru/'), ['https://p2p-it.lienad.ru:4443', 'https://p2p.lienad.ru']);
  assert.deepEqual(orderedCandidates([], 'https://p2p.lienad.ru'), ['https://p2p.lienad.ru']);
});

test('a lost connection switches servers only in the foreground, outside calls, after a while', () => {
  const base = { foreground: true, inCall: false, onHome: false, hasAlternatives: true };
  assert.equal(shouldSwitch({ ...base, offlineMs: 19_000 }), false);
  assert.equal(shouldSwitch({ ...base, offlineMs: 20_000 }), true);
  assert.equal(shouldSwitch({ ...base, onHome: true, offlineMs: 30_000 }), false);
  assert.equal(shouldSwitch({ ...base, onHome: true, offlineMs: 60_000 }), true);
  assert.equal(shouldSwitch({ ...base, inCall: true, offlineMs: 90_000 }), false);
  assert.equal(shouldSwitch({ ...base, foreground: false, offlineMs: 90_000 }), false);
  assert.equal(shouldSwitch({ ...base, hasAlternatives: false, offlineMs: 90_000 }), false);
});
