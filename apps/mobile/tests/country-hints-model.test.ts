import assert from 'node:assert/strict';
import test from 'node:test';
import { pickCountryHints } from '../src/country-hints-model';

test('the Play account and the current network are sent, upper-cased and without repeats', () => {
  assert.deepEqual(pickCountryHints({ play: 'ru', network: 'rs', sim: 'ru' }), ['RU', 'RS']);
  assert.deepEqual(pickCountryHints({ play: 'RS', network: 'RS' }), ['RS']);
});

test('the SIM counts only when there is no mobile network', () => {
  assert.deepEqual(pickCountryHints({ play: 'DE', network: 'de', sim: 'ru' }), ['DE']);
  assert.deepEqual(pickCountryHints({ play: null, network: '', sim: 'ru' }), ['RU']);
});

test('unknown or placeholder values are dropped, leaving nothing rather than a guess', () => {
  assert.deepEqual(pickCountryHints({ play: 'ZZ', network: 'xx', sim: '1' }), []);
  assert.deepEqual(pickCountryHints({}), []);
});
