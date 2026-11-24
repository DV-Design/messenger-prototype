#!/usr/bin/env node
// Checks translations against the English source: every key, the same {placeholders}, Android
// strings with the same names and printf arguments, and Google Play limits.
// Usage: node apps/mobile/scripts/check-locales.mjs [code ...]   (no codes: every language)
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const mobile = join(dirname(fileURLToPath(import.meta.url)), '..');
const repo = join(mobile, '../..');
const { LANGUAGES } = JSON.parse(readFileSync(join(mobile, 'i18n/languages.json'), 'utf8'));
const source = JSON.parse(readFileSync(join(mobile, 'i18n/source.json'), 'utf8'));
const keys = source.map(entry => entry.key);
const nativeSource = readFileSync(join(mobile, 'plugins/strings/values/lastcall_strings.xml'), 'utf8');
const placeholders = text => [...text.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort().join(',');
const printf = text => [...text.matchAll(/%\d+\$[sd]/g)].map(match => match[0]).sort().join(',');
const nativeEntries = xml => Object.fromEntries([...xml.matchAll(/<string name="([^"]+)">([\s\S]*?)<\/string>/g)].map(match => [match[1], match[2]]));
const nativeNames = Object.keys(nativeEntries(nativeSource));

const wanted = process.argv.slice(2);
const languages = LANGUAGES.filter(language => language.code !== 'en' && (!wanted.length || wanted.includes(language.code)));
if (wanted.length && languages.length !== wanted.length) { console.error('Unknown language code in', wanted.join(' ')); process.exit(2); }
let failed = false;
for (const language of languages) {
  const errors = []; const warnings = [];
  // App strings
  const file = join(mobile, 'src/locales', `${language.code}.json`);
  if (!existsSync(file)) errors.push('missing src/locales/' + language.code + '.json');
  else {
    let dictionary;
    try { dictionary = JSON.parse(readFileSync(file, 'utf8')); } catch (error) { errors.push('invalid JSON: ' + error.message); }
    if (dictionary) {
      const extra = Object.keys(dictionary).filter(key => !keys.includes(key));
      if (extra.length) errors.push(`${extra.length} keys not in the source, e.g. ${JSON.stringify(extra[0])}`);
      let same = 0;
      for (const key of keys) {
        const value = dictionary[key];
        if (typeof value !== 'string' || !value.trim()) { errors.push('missing or empty: ' + JSON.stringify(key)); continue; }
        if (placeholders(value) !== placeholders(key)) errors.push(`placeholders differ for ${JSON.stringify(key)}: ${JSON.stringify(value)}`);
        if ((key.match(/\n/g) ?? []).length !== (value.match(/\n/g) ?? []).length) warnings.push('line breaks differ: ' + JSON.stringify(key));
        if (value === key && /[a-z]{4}/i.test(key)) same++;
      }
      if (same > keys.length * 0.15) errors.push(`${same} strings are left in English`);
    }
  }
  // Android strings
  const xmlFile = join(mobile, 'plugins/strings', language.android, 'lastcall_strings.xml');
  if (!existsSync(xmlFile)) errors.push(`missing plugins/strings/${language.android}/lastcall_strings.xml`);
  else {
    const xml = readFileSync(xmlFile, 'utf8');
    if (!xml.startsWith('<?xml')) errors.push('Android XML must start with <?xml');
    const entries = nativeEntries(xml);
    for (const name of nativeNames) {
      const value = entries[name];
      if (value === undefined) { errors.push('Android string missing: ' + name); continue; }
      if (printf(value) !== printf(nativeEntries(nativeSource)[name])) errors.push('Android printf arguments differ: ' + name);
      if (/(^|[^\\])'/.test(value) || /(^|[^\\])"/.test(value)) errors.push(`Android string ${name} has an unescaped quote (use \\' or \\")`);
      if (/&(?!amp;|lt;|gt;|quot;|apos;|#)/.test(value) || /</.test(value)) errors.push(`Android string ${name} has an unescaped & or <`);
    }
    if (Object.keys(entries).length !== nativeNames.length) errors.push('Android XML has extra or duplicate strings');
  }
  // Google Play listing
  const listingFile = join(repo, 'store/listings', `${language.code}.json`);
  if (!existsSync(listingFile)) errors.push(`missing store/listings/${language.code}.json`);
  else {
    let listing;
    try { listing = JSON.parse(readFileSync(listingFile, 'utf8')); } catch (error) { errors.push('invalid listing JSON: ' + error.message); }
    const limits = { name: 30, short: 80, full: 4000, whatsNew: 500 };
    if (listing) for (const [field, limit] of Object.entries(limits)) {
      const value = listing[field];
      if (typeof value !== 'string' || !value.trim()) errors.push('listing field missing: ' + field);
      else if ([...value].length > limit) errors.push(`listing ${field} is ${[...value].length} characters, limit ${limit}`);
    }
    if (listing && !/LastCall/.test(listing.name ?? '')) errors.push('listing name must contain LastCall');
  }
  if (errors.length) { failed = true; console.log(`✖ ${language.code}: ${errors.length} problem(s)`); for (const error of errors.slice(0, 40)) console.log('   ' + error); }
  else console.log(`✔ ${language.code}${warnings.length ? ` (${warnings.length} warning(s): ${warnings.slice(0, 3).join('; ')})` : ''}`);
}
process.exit(failed ? 1 : 0);
