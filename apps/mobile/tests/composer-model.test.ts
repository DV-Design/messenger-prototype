import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ComposerText } from '../src/composer-model';

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
