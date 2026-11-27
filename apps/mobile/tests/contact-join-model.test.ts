import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CONTACT_JOIN_INTERVAL_MS, dueForJoinCheck, joinedSince } from '../src/contact-join-model';

const user = (userId: string) => ({ userId });
test('the first check only remembers, later ones announce newcomers who are not contacts yet', () => {
  const first = joinedSince(undefined, [user('a'), user('b')], new Set(), 'me', 1);
  assert.deepEqual(first.fresh, []);
  assert.deepEqual(first.state.known.sort(), ['a', 'b']);
  const second = joinedSince(first.state, [user('a'), user('b'), user('c'), user('d'), user('me')], new Set(['d']), 'me', 2);
  assert.deepEqual(second.fresh, [user('c')]);
  assert.deepEqual(joinedSince(second.state, [user('c')], new Set(), 'me', 3).fresh, []);
});

test('checks run every four hours, at once when forced or when the clock went back', () => {
  assert.equal(dueForJoinCheck(undefined, 0), true);
  assert.equal(dueForJoinCheck({ known: [], checkedAt: 1000 }, 1000 + CONTACT_JOIN_INTERVAL_MS - 1), false);
  assert.equal(dueForJoinCheck({ known: [], checkedAt: 1000 }, 1000 + CONTACT_JOIN_INTERVAL_MS), true);
  assert.equal(dueForJoinCheck({ known: [], checkedAt: 1000 }, 500), true);
  assert.equal(dueForJoinCheck({ known: [], checkedAt: 1000 }, 1001, true), true);
});
