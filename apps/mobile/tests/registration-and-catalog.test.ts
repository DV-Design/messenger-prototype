import assert from 'node:assert/strict';
import test from 'node:test';
import type { DirectoryPage, DirectoryUser } from '@messenger/core';
import { CatalogController, catalogQuery } from '../src/catalog-model';
import { CanonicalProfileStore, registrationCandidate } from '../src/registration-model';
const proposed = { serverUrl: 'https://example.test/messenger', username: 'new_login', displayName: 'Новое имя' };
const user = (name: string): DirectoryUser => ({ userId: name.padEnd(64, '0'), publicKey: 'a'.repeat(64), username: name, displayName: name, online: false, lastSeen: 0 });
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (cause: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
test('server binding replaces proposed login; only signed absence permits a new candidate', async () => {
  const bound = await registrationCandidate(proposed, async () => ({ username: 'immutable', displayName: 'Серверное имя' }));
  assert.equal(bound.username, 'immutable'); assert.equal(bound.displayName, 'Серверное имя');
  assert.deepEqual(await registrationCandidate(proposed, async () => null), proposed);
  await assert.rejects(registrationCandidate(proposed, async () => { throw new Error('offline'); }), /offline/);
});
test('canonical writes deduplicate and can recover after save failure without changing server identity', async () => {
  let attempts = 0;
  const store = new CanonicalProfileStore(async () => { attempts++; if (attempts === 1) throw new Error('SecureStore failed'); });
  await assert.rejects(store.remember(proposed), /SecureStore/);
  await Promise.all([store.remember(proposed), store.remember(proposed)]);
  await store.remember({ ...proposed });
  assert.equal(attempts, 2); assert.equal(proposed.username, 'new_login');
});
test('old name search cannot replace latest Unicode query, and pagination deduplicates', async () => {
  const first = deferred<DirectoryUser[]>(); const second = deferred<DirectoryUser[]>();
  const controller = new CatalogController({ search: query => query === 'иван' ? first.promise : second.promise, listUsers: async cursor => cursor ? { users: [user('alice'), user('bob')] } : { users: [user('alice')], nextCursor: 'alice' } }, 'self');
  assert.equal(catalogQuery('  @ИВАН  '), 'иван');
  controller.setQuery('Иван'); const old = controller.load();
  controller.setQuery('@ПЁТР'); const latest = controller.load();
  second.resolve([user('petr')]); await latest;
  first.resolve([user('ivan')]); await old;
  assert.deepEqual(controller.snapshot().users.map(item => item.username), ['petr']);
  controller.setQuery(''); await controller.load(); await controller.load(true);
  assert.deepEqual(controller.snapshot().users.map(item => item.username), ['alice', 'bob']);
});
test('old page response cannot append to a new search, and canceled requests stay discarded', async () => {
  const page = deferred<DirectoryPage>();
  const controller = new CatalogController({ listUsers: async cursor => cursor ? page.promise : { users: [user('alice')], nextCursor: 'alice' }, search: async () => [user('ivan')] }, 'self');
  await controller.load(); const more = controller.load(true);
  controller.setQuery('Иван'); await controller.load(); page.resolve({ users: [user('bob')] }); await more;
  assert.deepEqual(controller.snapshot().users.map(item => item.username), ['ivan']);
  const pending = deferred<DirectoryUser[]>();
  const canceled = new CatalogController({ listUsers: async () => ({ users: [] }), search: () => pending.promise }, 'self');
  canceled.setQuery('name'); const request = canceled.load(); canceled.cancel(); pending.resolve([user('late')]); await request;
  assert.equal(canceled.snapshot().users.length, 0);
});
