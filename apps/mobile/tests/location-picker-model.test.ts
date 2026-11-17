import assert from 'node:assert/strict';
import test from 'node:test';
import { accuracyMeters, addressSubtitle, addressTitle, sameSpot } from '../src/location-picker-model';

test('the title is street and house, then the most specific name, never a bare house number', () => {
  assert.equal(addressTitle({ street: 'Тверская улица', streetNumber: '7', city: 'Москва' }), 'Тверская улица, 7');
  assert.equal(addressTitle({ street: 'Arbat' }), 'Arbat');
  assert.equal(addressTitle({ name: '7', district: 'Тверской', city: 'Москва' }), 'Тверской');
  assert.equal(addressTitle({ name: 'ГУМ', city: 'Москва' }), 'ГУМ');
  assert.equal(addressTitle(undefined), undefined);
  assert.equal(addressTitle({}), undefined);
});

test('the subtitle is the wider area without repeating the title', () => {
  assert.equal(addressSubtitle({ district: 'Тверской', city: 'Москва', country: 'Россия' }, 'Тверская улица, 7'), 'Тверской, Москва, Россия');
  assert.equal(addressSubtitle({ district: 'Тверской', city: 'Москва' }, 'Тверской'), 'Москва');
});

test('a selection counts as the same spot within a few metres', () => {
  const a = { latitude: 55.7558, longitude: 37.6176 };
  assert.equal(sameSpot(a, { latitude: 55.75583, longitude: 37.61763 }), true); // ~4 m
  assert.equal(sameSpot(a, { latitude: 55.7560, longitude: 37.6176 }), false); // ~22 m
});

test('accuracy is rounded and only shown when known', () => {
  assert.equal(accuracyMeters(12.6), 13);
  assert.equal(accuracyMeters(0), undefined);
  assert.equal(accuracyMeters(null), undefined);
});
