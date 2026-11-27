import assert from 'node:assert/strict';
import test from 'node:test';
import { pickCountryHints } from '../src/country-hints-model';

test('only the Google Play account country is sent, upper-cased', () => {
  assert.deepEqual(pickCountryHints({ play: 'rs' }), ['RS']);
  assert.deepEqual(pickCountryHints({ play: ' RU ' }), ['RU']);
});

test('unknown or placeholder values leave nothing rather than a guess', () => {
  assert.deepEqual(pickCountryHints({ play: 'ZZ' }), []);
  assert.deepEqual(pickCountryHints({ play: null }), []);
  assert.deepEqual(pickCountryHints({}), []);
});
