import assert from 'node:assert/strict';
import test from 'node:test';
import { isReplySwipe, swipeReplyOffset, swipeReplyTriggered, SWIPE_REPLY_MAX, SWIPE_REPLY_TRIGGER } from '../src/swipe-reply-model';

test('only a leftward, mostly horizontal drag starts a reply swipe', () => {
  assert.equal(isReplySwipe(-30, 4), true);
  assert.equal(isReplySwipe(30, 4), false); // rightward
  assert.equal(isReplySwipe(-30, 25), false); // diagonal: the list is scrolling
  assert.equal(isReplySwipe(-6, 0), false); // a tap's jitter
});

test('the bubble follows the finger, resists past the trigger and stops at the max', () => {
  assert.equal(swipeReplyOffset(20), 0);
  assert.equal(swipeReplyOffset(-30), -30);
  assert.ok(swipeReplyOffset(-80) > -80 && swipeReplyOffset(-80) < -SWIPE_REPLY_TRIGGER);
  assert.equal(swipeReplyOffset(-500), -SWIPE_REPLY_MAX);
});

test('release replies only past the trigger', () => {
  assert.equal(swipeReplyTriggered(-(SWIPE_REPLY_TRIGGER - 1)), false);
  assert.equal(swipeReplyTriggered(-SWIPE_REPLY_TRIGGER), true);
  assert.equal(swipeReplyTriggered(-400), true);
});
