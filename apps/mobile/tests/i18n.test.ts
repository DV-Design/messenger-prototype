import assert from 'node:assert/strict';
import test from 'node:test';
import { intlLocale, locale, setLocale, t } from '../src/i18n';

test('English is the primary language and Russian is selected only for ru locales', () => {
  setLocale(null);
  assert.equal(locale, 'en');
  assert.equal(intlLocale, 'en-US');
  assert.equal(t('Settings'), 'Settings');

  setLocale('ru-RU');
  assert.equal(locale, 'ru');
  assert.equal(intlLocale, 'ru-RU');
  assert.equal(t('Settings'), 'Настройки');

  setLocale('de-DE');
  assert.equal(locale, 'en');
  assert.equal(t('Settings'), 'Settings');
});

test('translation interpolation keeps both languages complete', () => {
  setLocale('en');
  assert.equal(t('Members: {count}', { count: 3 }), 'Members: 3');
  setLocale('ru');
  assert.equal(t('Members: {count}', { count: 3 }), 'Участники: 3');
  setLocale('en');
});
