import assert from 'node:assert/strict';
import test from 'node:test';
import { emailLocale, intlLocale, isRTL, locale, resolveLocale, setLocale, SUPPORTED_LOCALES, t } from '../src/i18n';

test('the UI follows the first of the phone languages LastCall has, otherwise English', () => {
  setLocale(null);
  assert.equal(locale, 'en'); assert.equal(intlLocale, 'en-US'); assert.equal(t('Settings'), 'Settings');
  setLocale('ru-RU');
  assert.equal(locale, 'ru'); assert.equal(intlLocale, 'ru-RU'); assert.equal(t('Settings'), 'Настройки');
  setLocale(['sw-KE', 'de-AT', 'ru-RU']);
  assert.equal(locale, 'de'); assert.notEqual(t('Settings'), 'Settings');
  setLocale(['sw-KE']);
  assert.equal(locale, 'en');
  setLocale('en');
});

test('regional and legacy tags map to the right language', () => {
  assert.equal(resolveLocale('pt-PT'), 'pt');
  assert.equal(resolveLocale('zh-Hant-HK'), 'zh-Hant');
  assert.equal(resolveLocale('zh-TW'), 'zh-Hant');
  assert.equal(resolveLocale('zh-Hans-CN'), 'zh-Hans');
  assert.equal(resolveLocale('zh'), 'zh-Hans');
  assert.equal(resolveLocale('iw-IL'), 'he');
  assert.equal(resolveLocale('in_ID'), 'id');
  assert.equal(resolveLocale('sw'), undefined);
  assert.equal(SUPPORTED_LOCALES.length, 30);
});

test('right-to-left languages mirror the layout; emails stay English or Russian', () => {
  for (const code of ['ar', 'fa', 'he', 'ur']) { setLocale(code); assert.equal(isRTL, true, code); assert.equal(emailLocale(), 'en'); }
  setLocale('ja'); assert.equal(isRTL, false);
  setLocale('ru'); assert.equal(emailLocale(), 'ru');
  setLocale('en');
});

test('every language keeps placeholders when it fills them', () => {
  for (const code of SUPPORTED_LOCALES) {
    setLocale(code);
    assert.match(t('Members: {count}', { count: 3 }), /3/, code);
    assert.doesNotMatch(t('Members: {count}', { count: 3 }), /\{count\}/, code);
  }
  setLocale('en');
});
