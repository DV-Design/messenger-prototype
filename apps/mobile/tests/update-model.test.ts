import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { officialUpdateUrl, parseUpdateManifest, updateAvailable, updateDownloadUrls } from '../src/update-model';

const sha = 'a'.repeat(64);
const primary = 'https://p2p.lienad.ru/download/LastCall-1.0.2.apk';
const alternate = 'https://lienad.ru/messenger/download/LastCall-1.0.2.apk';

function manifest(overrides: Record<string, unknown> = {}) {
  return {
    android: {
      version: '1.0.2',
      versionCode: 16,
      url: primary,
      alternateUrl: alternate,
      sha256: sha,
      notes: '  Исправления звонков.  ',
      ...overrides,
    },
    publishedAt: '2026-11-02T12:00:00.000Z',
  };
}

test('accepts a strict official manifest and trims notes', () => {
  const result = parseUpdateManifest(manifest());
  assert.deepEqual(result, {
    android: { version: '1.0.2', versionCode: 16, url: primary, alternateUrl: alternate, sha256: sha, notes: 'Исправления звонков.' },
    publishedAt: '2026-11-02T12:00:00.000Z',
  });
});

test('accepts a manifest without optional fields', () => {
  const result = parseUpdateManifest({ android: { version: '1.0.2', versionCode: 16, url: primary, sha256: sha } });
  assert.deepEqual(result, { android: { version: '1.0.2', versionCode: 16, url: primary, sha256: sha } });
});

test('rejects malformed versions, version codes and hashes', () => {
  for (const bad of [
    manifest({ version: '1.0' }),
    manifest({ version: 'v1.0.2' }),
    manifest({ version: 102 }),
    manifest({ versionCode: 0 }),
    manifest({ versionCode: -1 }),
    manifest({ versionCode: 1.5 }),
    manifest({ versionCode: '16' }),
    manifest({ versionCode: 2_100_000_001 }),
    manifest({ sha256: 'a'.repeat(63) }),
    manifest({ sha256: 'g'.repeat(64) }),
  ]) assert.equal(parseUpdateManifest(bad), undefined);
  for (const bad of [null, {}, [], { android: null }, { android: [] }, { android: { version: '1.0.2', versionCode: 16, url: primary } }]) assert.equal(parseUpdateManifest(bad), undefined);
});

test('allows downloads only from the official HTTPS versioned APK paths', () => {
  assert.equal(officialUpdateUrl(primary), primary);
  assert.equal(officialUpdateUrl(alternate), alternate);
  for (const bad of [
    'http://p2p.lienad.ru/download/LastCall-1.0.2.apk',
    'https://evil.test/download/LastCall-1.0.2.apk',
    'https://p2p.lienad.ru.evil.test/download/LastCall-1.0.2.apk',
    'https://user:pass@p2p.lienad.ru/download/LastCall-1.0.2.apk',
    'https://p2p.lienad.ru:8443/download/LastCall-1.0.2.apk',
    'https://p2p.lienad.ru/download/LastCall-1.0.2.apk?x=1',
    'https://p2p.lienad.ru/download/LastCall-1.0.2.apk#fragment',
    'https://p2p.lienad.ru/other/LastCall-1.0.2.apk',
    'https://lienad.ru/download/LastCall-1.0.2.apk',
    'https://p2p.lienad.ru/download/latest.json',
  ]) assert.equal(officialUpdateUrl(bad), undefined);
});

test('rejects an invalid alternate URL and published date but keeps unicode notes bounded', () => {
  assert.equal(parseUpdateManifest(manifest({ alternateUrl: 'https://evil.test/LastCall.apk' })), undefined);
  assert.equal(parseUpdateManifest({ ...manifest(), publishedAt: 'not-a-date' }), undefined);
  const notes = 'я'.repeat(500);
  assert.equal(parseUpdateManifest(manifest({ notes }))?.android.notes?.length, 400);
  assert.equal(parseUpdateManifest(manifest({ notes: ' \u0001 ' }))?.android.notes, undefined);
});

test('offers only a strictly newer versionCode', () => {
  const parsed = parseUpdateManifest(manifest());
  assert.ok(parsed);
  assert.equal(updateAvailable(15, parsed)?.versionCode, 16);
  assert.equal(updateAvailable(16, parsed), undefined);
  assert.equal(updateAvailable(17, parsed), undefined);
  assert.equal(updateAvailable(0, parsed), undefined);
});

test('checked-in latest.json is a valid manifest for a newer build', () => {
  const parsed = parseUpdateManifest(JSON.parse(readFileSync(new URL('../../../infra/public/latest.json', import.meta.url), 'utf8')));
  assert.ok(parsed);
  assert.equal(updateAvailable(parsed.android.versionCode, parsed), undefined);
  assert.equal(updateAvailable(parsed.android.versionCode - 1, parsed)?.version, parsed.android.version);
});

test('download URL list prefers the primary and deduplicates it', () => {
  const parsed = parseUpdateManifest(manifest());
  assert.ok(parsed);
  assert.deepEqual(updateDownloadUrls(parsed.android), [primary, alternate]);
  assert.deepEqual(updateDownloadUrls({ ...parsed.android, alternateUrl: primary }), [primary]);
});
