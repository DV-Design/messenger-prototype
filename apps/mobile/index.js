import { getLocales } from 'expo-localization';
import { setLocale } from './src/i18n';

// Resolve the UI language before any screen/model module evaluates its labels.
setLocale(getLocales()[0]?.languageCode);

require('./src/system-calls');
require('./src/background-notifications');
require('expo-router/entry');
