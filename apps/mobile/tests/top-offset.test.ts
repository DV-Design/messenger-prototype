import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8');

// The call bar and the live location bar push every screen down. KeyboardAvoidingView measures itself
// from its parent, so the chat must add their height or the message field stays under the keyboard.
test('top strips report how far they push the screens down', () => {
  for (const file of ['call-bar.tsx', 'components/LiveLocationBar.tsx']) {
    assert.match(source(file), /<TopOffset\.Provider value=\{above \+ insets\.top \+ TOP_STRIP_HEIGHT\}>/, file);
    assert.match(source(file), /height: TOP_STRIP_HEIGHT/, file);
  }
});

test('the chat keyboard avoidance counts the top strips', () => {
  const chat = source('app/chat/[id].tsx');
  assert.match(chat, /<KeyboardSpace iosOffset=\{topOffset\}>/);
  assert.match(chat, /const topOffset = useTopOffset\(\);/);
  // iOS keeps KeyboardAvoidingView with the offset; Android measures the area against the keyboard
  // in window coordinates, so the strips are counted without an offset.
  const space = source('components/KeyboardSpace.tsx');
  assert.match(space, /<KeyboardAvoidingView[^>]*keyboardVerticalOffset=\{iosOffset\}/);
  assert.match(space, /measureInWindow/);
});
