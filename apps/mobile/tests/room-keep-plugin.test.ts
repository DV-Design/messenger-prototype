import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { rules } = require('../plugins/withRoomKeep.cjs') as { rules: string };

test('release builds keep Room database constructors so WorkManager can start', () => {
  // Without this, R8 drops WorkDatabase_Impl's no-arg constructor and the store build crashes on launch.
  assert.match(rules, /^-keep class \* extends androidx\.room\.RoomDatabase \{ <init>\(\); \}$/m);
  assert.match(readFileSync(new URL('../app.config.ts', import.meta.url), 'utf8'), /'\.\/plugins\/withRoomKeep\.cjs'/);
});
