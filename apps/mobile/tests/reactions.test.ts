import assert from 'node:assert/strict';
import test from 'node:test';
import { myReaction, nextReaction, reactionCounts } from '../src/reaction-model';

test('pills follow the picker order, count members and mark mine', () => {
  const reactions = [{ userId: 'b', emoji: '❤️' as const }, { userId: 'me', emoji: '👍' as const }, { userId: 'c', emoji: '👍' as const }];
  assert.deepEqual(reactionCounts(reactions, 'me'), [
    { emoji: '👍', count: 2, mine: true, userIds: ['me', 'c'] },
    { emoji: '❤️', count: 1, mine: false, userIds: ['b'] },
  ]);
  assert.deepEqual(reactionCounts(undefined, 'me'), []);
});
test('blocked people are neither shown nor counted', () => {
  const reactions = [{ userId: 'b', emoji: '😂' as const }, { userId: 'c', emoji: '😂' as const }];
  assert.deepEqual(reactionCounts(reactions, 'me', new Set(['b'])), [{ emoji: '😂', count: 1, mine: false, userIds: ['c'] }]);
  assert.deepEqual(reactionCounts([{ userId: 'b', emoji: '😂' }], 'me', new Set(['b'])), []);
});
test('choosing your reaction again takes it back, another one replaces it', () => {
  assert.equal(nextReaction(undefined, '👍'), '👍');
  assert.equal(nextReaction('👍', '👍'), undefined);
  assert.equal(nextReaction('👍', '🙏'), '🙏');
  assert.equal(myReaction([{ userId: 'b', emoji: '❤️' }, { userId: 'me', emoji: '😮' }], 'me'), '😮');
  assert.equal(myReaction([{ userId: 'b', emoji: '❤️' }], 'me'), undefined);
  assert.equal(myReaction([{ userId: 'b', emoji: '❤️' }], undefined), undefined);
});
