#!/usr/bin/env node
// Lists t('…') strings used in the app that are not in i18n/source.json yet (to translate), and source keys no longer used.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const mobile = join(dirname(fileURLToPath(import.meta.url)), '..');
const files = []; const walk = dir => { for (const name of readdirSync(dir)) { const path = join(dir, name); if (statSync(path).isDirectory()) { if (name !== 'locales') walk(path); } else if (/\.tsx?$/.test(name)) files.push(path); } };
walk(join(mobile, 'src'));
const used = new Set();
for (const file of files) for (const match of readFileSync(file, 'utf8').matchAll(/\bt\(\s*'((?:[^'\\]|\\.)*)'/g)) used.add(new Function(`return '${match[1]}'`)());
const source = new Set(JSON.parse(readFileSync(join(mobile, 'i18n/source.json'), 'utf8')).map(entry => entry.key));
const missing = [...used].filter(key => !source.has(key)); const unused = [...source].filter(key => !used.has(key));
console.log(JSON.stringify({ missing, unused }, null, 1));
