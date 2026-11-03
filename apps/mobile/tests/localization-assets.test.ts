import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const root = new URL('../../../', import.meta.url);
const values = readFileSync(new URL('apps/mobile/plugins/strings/values/lastcall_strings.xml', root), 'utf8');
const valuesRu = readFileSync(new URL('apps/mobile/plugins/strings/values-ru/lastcall_strings.xml', root), 'utf8');
const keys = (xml: string) => [...xml.matchAll(/<string name="([^"]+)"/g)].map(match => match[1]).sort();

test('native LastCall strings have matching English and Russian resource keys', () => {
  assert.ok(keys(values).length > 0);
  assert.deepEqual(keys(values), keys(valuesRu));
});

test('native call and notification sources contain no hardcoded Russian strings', () => {
  for (const file of ['LastCallPip.java', 'LastCallNotificationsModule.java', 'LastCallAudioService.java', 'LastCallCallActivity.java', 'LastCallCallSetupService.java', 'LastCallCallUiService.java']) {
    const path = file === 'LastCallPip.java' ? `apps/mobile/plugins/pip/${file}` : `apps/mobile/plugins/${file.startsWith('LastCallNotifications') ? 'notifications' : 'calls'}/${file}`;
    assert.doesNotMatch(readFileSync(new URL(path, root), 'utf8'), /[А-Яа-яЁё]/, file);
  }
});
