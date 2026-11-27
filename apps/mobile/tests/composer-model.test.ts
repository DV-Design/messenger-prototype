import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ComposerText, MAX_STALLS, addStall, formatStall } from '../src/composer-model';

test('taps queued during a freeze send the typed text once', () => {
  const field = new ComposerText();
  field.set('Напиши как пойдёте,');
  // Eight taps run before the screen redraws: only the first one gets the text.
  const sent = Array.from({ length: 8 }, () => field.take()).filter(text => text !== undefined);
  assert.deepEqual(sent, ['Напиши как пойдёте,']);
  assert.equal(field.current, '');
  field.set('   ');
  assert.equal(field.take(), undefined);
  field.set('again');
  assert.equal(field.take(), 'again');
});

test('the freeze list keeps the latest entries and shows no content', () => {
  let list = [] as ReturnType<typeof addStall>;
  for (let i = 0; i < MAX_STALLS + 3; i++) list = addStall(list, { at: Date.UTC(2026, 10, 27, 21, 14, i), ms: 2400, busy: ['send'], updates: 5, state: 'active' });
  assert.equal(list.length, MAX_STALLS);
  assert.equal(list[0]!.at, Date.UTC(2026, 10, 27, 21, 14, 3));
  assert.equal(formatStall(list[0]!, -60), '11-27 22:14:03 · 2.4 s · active · send · updates 5');
});
