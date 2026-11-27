import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SignedRequestError } from '@messenger/core';
import { telegramErrorCode, telegramNextStep } from '../src/telegram-signup-model';

test('the Telegram screen waits, offers a new link, or goes on by purpose', () => {
  assert.equal(telegramNextStep('register', { state: 'pending' }), 'wait');
  assert.equal(telegramNextStep('recover', { state: 'expired' }), 'expired');
  assert.equal(telegramNextStep('register', { state: 'verified', proof: 'a'.repeat(64) }), 'profile');
  assert.equal(telegramNextStep('recover', { state: 'verified' }), 'done');
  assert.equal(telegramNextStep('bind', { state: 'verified' }), 'done');
});

test('only a server refusal carries a code', () => {
  assert.equal(telegramErrorCode(new SignedRequestError('phone-taken', 'x')), 'phone-taken');
  assert.equal(telegramErrorCode(new Error('Connection failed')), undefined);
});
