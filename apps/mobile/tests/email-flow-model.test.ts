import assert from 'node:assert/strict';
import test from 'node:test';
import { EmailAuthError } from '@messenger/core';
import { emailErrorMessage, emailFlowReducer, emailForServer, emailNoticeMessage, initialEmailFlow, isAccountMoved, isEmailUnavailable, registrationErrorCode, registrationErrorMessage, resendSecondsLeft, sanitizeCode, shouldShowEmailReminder, validCode, validEmail, type EmailFlowState } from '../src/email-flow-model';
import { setLocale, t } from '../src/i18n';

const sent = (state: EmailFlowState) => emailFlowReducer(state, { type: 'code-sent', email: 'a@example.com', challengeId: 'c'.repeat(32), at: 1000 });
const choose = (mode: 'register' | 'recover') => emailFlowReducer(initialEmailFlow(), { type: 'choose', mode });

test('addresses are normalized and refused the way the server refuses them', () => {
  assert.equal(validEmail('  Ivan@Example.COM '), 'ivan@example.com');
  for (const bad of ['', 'ivan', 'a@b', 'a@example.com,b@example.com', 'Ivan <a@example.com>', 'иван@почта.рф']) assert.equal(validEmail(bad), null, bad);
});

test('codes are six digits and pasted text is cleaned', () => {
  assert.equal(sanitizeCode(' 12-34 56 78'), '123456');
  assert.equal(validCode('123456'), true);
  for (const bad of ['12345', '1234567', '12345a', '']) assert.equal(validCode(bad), false, bad);
});

test('resend waits sixty seconds and never goes negative', () => {
  assert.equal(resendSecondsLeft(undefined, 5), 0);
  assert.equal(resendSecondsLeft(1000, 1000), 60);
  assert.equal(resendSecondsLeft(1000, 1001), 60);
  assert.equal(resendSecondsLeft(1000, 60_999), 1);
  assert.equal(resendSecondsLeft(1000, 61_000), 0);
  assert.equal(resendSecondsLeft(1000, 999_999), 0);
  assert.equal(resendSecondsLeft(10_000, 0), 60);
});

test('a network failure never reads as a wrong code', () => {
  setLocale('en');
  const wrong = emailErrorMessage(new EmailAuthError('email-code-invalid', 'x'));
  assert.match(wrong, /wrong/);
  for (const cause of [new Error('Email request timed out'), new TypeError('Network request failed'), undefined]) {
    const message = emailErrorMessage(cause);
    assert.notEqual(message, wrong);
    assert.doesNotMatch(message, /wrong|expired/);
    assert.match(message, /connection/);
  }
});

test('server messages are not shown raw and unknown refusals stay generic', () => {
  setLocale('en');
  assert.doesNotMatch(emailErrorMessage(new EmailAuthError('something-new', 'internal detail')), /internal/);
  for (const code of ['email-unavailable', 'email-rate-limited', 'email-taken', 'email-required', 'profile-required', 'device-already-registered', 'account-moved', 'auth-failed', 'auth-expired']) {
    assert.ok(emailErrorMessage(new EmailAuthError(code, 'internal detail')).length > 10, code);
    assert.doesNotMatch(emailErrorMessage(new EmailAuthError(code, 'internal detail')), /internal/);
  }
});

test('every message is translated', () => {
  setLocale('ru');
  try {
    const hasCyrillic = /[а-яё]/i;
    for (const code of ['email-unavailable', 'email-rate-limited', 'email-code-invalid', 'email-taken', 'email-required', 'profile-required', 'device-already-registered', 'account-moved', 'auth-failed', 'other']) assert.match(emailErrorMessage(new EmailAuthError(code, 'x')), hasCyrillic, code);
    assert.match(emailErrorMessage(new Error('offline')), hasCyrillic);
    for (const text of ['Create account', 'Restore account', 'Send code', 'Resend code', 'Resend code in {seconds} s', 'Open new chat', 'Add email', 'Change email', 'Email', 'Confirmation code', 'Remove data from this phone', 'Remove data from this phone?', 'Remove', 'Not now', 'Change address']) assert.match(t(text), hasCyrillic, text);
  } finally { setLocale('en'); }
});

test('only an unavailable server unlocks registering without email', () => {
  assert.equal(isEmailUnavailable(new EmailAuthError('email-unavailable', 'x')), true);
  assert.equal(isEmailUnavailable(new EmailAuthError('invalid-frame', 'x')), true);
  assert.equal(isEmailUnavailable(new EmailAuthError('email-rate-limited', 'x')), false);
  assert.equal(isEmailUnavailable(new Error('email-unavailable')), false);
});

test('register goes from email through code to profile with the proof', () => {
  const email = choose('register');
  assert.equal(email.stage, 'email');
  const code = sent(email);
  assert.equal(code.stage, 'code');
  assert.equal(code.email, 'a@example.com');
  const profile = emailFlowReducer(code, { type: 'verified', proof: 'p'.repeat(64) });
  assert.deepEqual([profile.stage, profile.proof, profile.withoutEmail, profile.challengeId], ['profile', 'p'.repeat(64), false, undefined]);
  assert.equal(profile.email, 'a@example.com');
});

test('a taken username keeps the proof; a lost proof or taken address returns to the email step', () => {
  const profile = emailFlowReducer(sent(choose('register')), { type: 'verified', proof: 'p'.repeat(64) });
  assert.equal(emailFlowReducer(profile, { type: 'registration-failed', code: 'username-taken' }), profile);
  for (const [code, notice] of [['email-required', 'proof-lost'], ['email-taken', 'email-taken']] as const) {
    const next = emailFlowReducer(profile, { type: 'registration-failed', code });
    assert.deepEqual([next.stage, next.proof, next.notice], ['email', undefined, notice]);
    assert.ok(emailNoticeMessage(next.notice).length > 10);
  }
});

test('an unavailable server lets register continue with an explicit note, restore cannot', () => {
  const register = emailFlowReducer(choose('register'), { type: 'unavailable' });
  assert.deepEqual([register.stage, register.withoutEmail, register.proof, register.notice], ['profile', true, undefined, 'unavailable']);
  const recover = emailFlowReducer(choose('recover'), { type: 'unavailable' });
  assert.deepEqual([recover.stage, recover.withoutEmail, recover.notice], ['email', false, 'unavailable']);
});

test('a server that starts requiring email ends the no-email path', () => {
  const profile = emailFlowReducer(choose('register'), { type: 'unavailable' });
  const next = emailFlowReducer(profile, { type: 'registration-failed', code: 'email-required' });
  assert.deepEqual([next.stage, next.withoutEmail, next.notice], ['email', false, 'proof-lost']);
});

test('recovery and binding finish without a proof or a profile step', () => {
  assert.equal(emailFlowReducer(sent(choose('recover')), { type: 'verified' }).stage, 'choose');
  const bind = emailFlowReducer(sent(initialEmailFlow('bind')), { type: 'verified' });
  assert.deepEqual([bind.stage, bind.mode, bind.email], ['email', 'bind', '']);
});

test('back steps through the flow and forgets the code and proof', () => {
  const code = sent(choose('recover'));
  const email = emailFlowReducer(code, { type: 'back' });
  assert.deepEqual([email.stage, email.challengeId, email.sentAt, email.email], ['email', undefined, undefined, 'a@example.com']);
  assert.equal(emailFlowReducer(email, { type: 'back' }).stage, 'choose');
  const profile = emailFlowReducer(sent(choose('register')), { type: 'verified', proof: 'p'.repeat(64) });
  const back = emailFlowReducer(profile, { type: 'back' });
  assert.deepEqual([back.stage, back.proof], ['email', undefined]);
  assert.equal(emailFlowReducer(initialEmailFlow('bind'), { type: 'back' }).mode, 'bind');
});

test('terminal connect errors map to readable text', () => {
  setLocale('en');
  assert.equal(registrationErrorCode('username-taken: This username is already registered'), 'username-taken');
  assert.equal(registrationErrorCode('email-required: Confirm an email address to register'), 'email-required');
  assert.equal(registrationErrorCode('Directory connection failed'), undefined);
  assert.equal(registrationErrorCode(undefined), undefined);
  assert.match(registrationErrorMessage('username-taken: raw'), /already taken/);
  assert.doesNotMatch(registrationErrorMessage('email-taken: raw'), /raw/);
  assert.equal(registrationErrorMessage('Some other failure'), 'Some other failure');
  assert.equal(isAccountMoved('account-moved: raw'), true);
  assert.equal(isAccountMoved('auth-failed: raw'), false);
});

test('a binding counts only for the server that confirmed it', () => {
  const bound = { email: 'a@example.com', serverUrl: 'https://one.test' };
  assert.equal(emailForServer(bound, 'https://one.test'), 'a@example.com');
  assert.equal(emailForServer(bound, 'https://two.test'), null);
  assert.equal(emailForServer(null, 'https://one.test'), null);
  assert.equal(emailForServer(undefined, undefined), null);
});

test('the reminder needs a loaded missing address, an online client and no dismissal', () => {
  const base = { bound: null, serverUrl: 'https://one.test', dismissed: false, status: 'online', retired: false };
  assert.equal(shouldShowEmailReminder(base), true);
  assert.equal(shouldShowEmailReminder({ ...base, status: 'offline' }), false);
  assert.equal(shouldShowEmailReminder({ ...base, dismissed: true }), false);
  assert.equal(shouldShowEmailReminder({ ...base, dismissed: undefined }), false);
  assert.equal(shouldShowEmailReminder({ ...base, bound: undefined }), false);
  assert.equal(shouldShowEmailReminder({ ...base, retired: true }), false);
  assert.equal(shouldShowEmailReminder({ ...base, bound: { email: 'a@example.com', serverUrl: 'https://one.test' } } as never), false);
  assert.equal(shouldShowEmailReminder({ ...base, bound: { email: 'a@example.com', serverUrl: 'https://two.test' } } as never), true);
});
