import assert from 'node:assert/strict';
import test from 'node:test';
import { sanitizeDiagnostic } from '../src/diagnostics';
test('diagnostics redact known names/usernames/messages/keys case-insensitively including regex characters', () => {
  const privateKey = 'abcdef1234567890'.repeat(4);
  const privateValues = ['Иван Петров', 'ivan_test', 'Alice (QA)+', 'личное сообщение', privateKey];
  const input = `ИВАН ПЕТРОВ / ivan_TEST: ICE failure; Alice (QA)+: личное сообщение; @someone; +7 (999) 123-45-67; ${privateKey}\nnext`;
  const output = sanitizeDiagnostic(input, privateValues);
  for (const value of ['иван', 'ivan_test', 'Alice', 'личное сообщение', '999', privateKey, '@someone']) assert.equal(output.toLowerCase().includes(value.toLowerCase()), false, value);
  assert.match(output, /ICE failure/); assert.equal(output.includes('\n'), false);
});
