import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { patchEntryPoints, NAMESPACE } = require('../plugins/withLastCallNamespace.cjs') as {
  patchEntryPoints: (directory: string) => void;
  NAMESPACE: string;
};

test('store entry points are moved into the fixed native namespace', () => {
  const root = mkdtempSync(join(tmpdir(), 'lastcall-namespace-'));
  try {
    const directory = join(root, 'ru', 'lastcall', 'app');
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, 'MainActivity.kt'), 'package ru.lastcall.app\n\nimport ru.lastcall.app.BuildConfig\nclass MainActivity\n');
    writeFileSync(join(directory, 'MainApplication.kt'), 'package ru.lastcall.app\nclass MainApplication\n');
    writeFileSync(join(directory, 'Helper.kt'), 'package ru.lastcall.app\nclass Helper\n');
    patchEntryPoints(root);
    assert.match(readFileSync(join(directory, 'MainActivity.kt'), 'utf8'), new RegExp(`^package ${NAMESPACE.replace(/\./g, '\\.')}\\n`));
    assert.match(readFileSync(join(directory, 'MainActivity.kt'), 'utf8'), new RegExp(`import ${NAMESPACE.replace(/\./g, '\\.')}\\.BuildConfig`));
    assert.match(readFileSync(join(directory, 'MainApplication.kt'), 'utf8'), new RegExp(`^package ${NAMESPACE.replace(/\./g, '\\.')}\\n`));
    assert.match(readFileSync(join(directory, 'Helper.kt'), 'utf8'), /^package ru\.lastcall\.app/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
