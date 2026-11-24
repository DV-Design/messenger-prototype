import { getLocales } from 'expo-localization';
import { setLocale } from './src/i18n';

// Resolve the UI language before any screen/model module evaluates its labels.
// The first of the phone's preferred languages that LastCall has, otherwise English.
setLocale(getLocales().map(item => item.languageTag));

require('./src/system-calls');
require('./src/background-notifications');
require('expo-router/entry');
