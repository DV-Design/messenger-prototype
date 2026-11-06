import assert from 'node:assert/strict';
import test from 'node:test';
import { callBarSnapshot, callDuration, markCallActive, setCallBar, subscribeCallBar } from '../src/call-bar-model';

test('the bar keeps the first active moment, notifies only on change and clears with the call', () => {
  let changes = 0; const stop = subscribeCallBar(() => changes++);
  setCallBar({ name: 'Maria', status: 'calling…' }); setCallBar({ name: 'Maria' });
  assert.equal(changes, 1);
  markCallActive(1000); markCallActive(5000);
  assert.equal(callBarSnapshot().activeSince, 1000);
  setCallBar({ collapsed: true }); assert.equal(callBarSnapshot().collapsed, true);
  setCallBar(null); assert.deepEqual(callBarSnapshot(), { collapsed: false, name: '', status: '' });
  stop();
});

test('duration reads like Telegram', () => {
  assert.equal(callDuration(0), '00:00'); assert.equal(callDuration(65_400), '01:05'); assert.equal(callDuration(3_725_000), '1:02:05'); assert.equal(callDuration(-5), '00:00');
});
