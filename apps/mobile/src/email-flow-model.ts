import { EmailAuthError, emailAddressSchema, normalizeEmail, type EmailPurpose } from '@messenger/core';
import { t } from './i18n';

export const RESEND_SECONDS = 60;
export type EmailFlowStage = 'choose' | 'email' | 'code' | 'profile';
export type EmailNotice = 'proof-lost' | 'email-taken' | 'unavailable';
export interface EmailFlowState {
  stage: EmailFlowStage;
  mode?: EmailPurpose;
  email: string;
  challengeId?: string;
  sentAt?: number;
  /** In memory only: it goes to the server once, with the registration attempt. */
  proof?: string;
  withoutEmail: boolean;
  notice?: EmailNotice;
}
export type EmailFlowEvent =
  | { type: 'choose'; mode: EmailPurpose }
  | { type: 'code-sent'; email: string; challengeId: string; at: number }
  | { type: 'verified'; proof?: string }
  | { type: 'unavailable' }
  | { type: 'registration-failed'; code: string }
  | { type: 'back' }
  | { type: 'reset' };

export const initialEmailFlow = (mode?: EmailPurpose): EmailFlowState => ({ stage: mode ? 'email' : 'choose', mode, email: '', withoutEmail: false });

export function emailFlowReducer(state: EmailFlowState, event: EmailFlowEvent): EmailFlowState {
  switch (event.type) {
    case 'choose': return { ...initialEmailFlow(event.mode) };
    case 'code-sent': return { ...state, stage: 'code', email: event.email, challengeId: event.challengeId, sentAt: event.at, notice: undefined };
    case 'verified':
      // Binding and recovery are finished by the caller; only registration still needs a name.
      if (state.mode !== 'register') return initialEmailFlow(state.mode === 'bind' ? 'bind' : undefined);
      return { ...state, stage: 'profile', proof: event.proof, challengeId: undefined, sentAt: undefined, withoutEmail: false, notice: undefined };
    case 'unavailable':
      if (state.mode === 'register') return { ...state, stage: 'profile', proof: undefined, withoutEmail: true, notice: 'unavailable' };
      return { ...state, stage: 'email', notice: 'unavailable' };
    case 'registration-failed':
      // A taken username keeps the proof, so the mailbox does not have to be confirmed again.
      if (event.code === 'email-required') return { ...state, stage: 'email', proof: undefined, withoutEmail: false, notice: 'proof-lost' };
      if (event.code === 'email-taken') return { ...state, stage: 'email', proof: undefined, withoutEmail: false, notice: 'email-taken' };
      return state;
    case 'back':
      if (state.stage === 'code') return { ...state, stage: 'email', challengeId: undefined, sentAt: undefined, notice: undefined };
      if (state.stage === 'profile') return { ...state, stage: 'email', proof: undefined, withoutEmail: false, notice: undefined };
      return initialEmailFlow(state.mode === 'bind' ? 'bind' : undefined);
    case 'reset': return initialEmailFlow(state.mode === 'bind' ? 'bind' : undefined);
  }
}

/** The normalized address, or null when the server schema would refuse it. */
export function validEmail(input: string): string | null {
  const email = normalizeEmail(input);
  return emailAddressSchema.safeParse(email).success ? email : null;
}
export const sanitizeCode = (input: string) => input.replace(/[^0-9]/g, '').slice(0, 6);
export const validCode = (input: string) => /^[0-9]{6}$/.test(input);
export function resendSecondsLeft(sentAt: number | undefined, now: number): number {
  if (sentAt === undefined) return 0;
  return Math.min(RESEND_SECONDS, Math.max(0, Math.ceil((sentAt + RESEND_SECONDS * 1000 - now) / 1000)));
}
/** An older server refuses the unknown frame, which means the same to the user as not configured. */
export const isEmailUnavailable = (error: unknown) => error instanceof EmailAuthError && (error.code === 'email-unavailable' || error.code === 'invalid-frame');
export const emailErrorCode = (error: unknown) => error instanceof EmailAuthError ? error.code : undefined;

const refusals = (code: string): string => {
  switch (code) {
    case 'email-unavailable': case 'invalid-frame': return t('Email confirmation is not available on this server.');
    case 'email-rate-limited': return t('Too many requests. Try again in an hour.');
    case 'email-code-invalid': return t('The code is wrong or has expired. Check it or request a new one.');
    case 'email-taken': return t('This address is already used by another account. Choose Restore account or use another address.');
    case 'email-required': return t('The email confirmation has expired. Confirm your address again.');
    case 'profile-required': return t('Register before adding an address.');
    case 'device-already-registered': return t('This device already has a registered username. Restore the profile from the server.');
    case 'account-moved': return t('This account was restored on another device. This phone can no longer use it.');
    case 'auth-failed': case 'auth-expired': return t('The server could not confirm this request. Try again.');
    default: return t('The server refused the request. Try again later.');
  }
};
/** Only a server refusal can say the code is wrong; a lost connection never reads that way. */
export function emailErrorMessage(error: unknown): string {
  return error instanceof EmailAuthError ? refusals(error.code) : t('Could not reach the server. Check your connection and try again.');
}
export function emailNoticeMessage(notice: EmailNotice | undefined): string {
  if (notice === 'proof-lost') return refusals('email-required');
  if (notice === 'email-taken') return refusals('email-taken');
  if (notice === 'unavailable') return refusals('email-unavailable');
  return '';
}
/** `connect()` reports terminal refusals as `<code>: <message>`. */
export function registrationErrorCode(message: string | undefined): string | undefined {
  return /^(username-taken|device-already-registered|email-required|email-taken|account-moved)\b/.exec(message ?? '')?.[1];
}
export function registrationErrorMessage(message: string): string {
  const code = registrationErrorCode(message);
  return code === 'username-taken' ? t('This username is already taken. Choose another.') : code ? refusals(code) : message;
}
export const isAccountMoved = (message: string | undefined) => registrationErrorCode(message) === 'account-moved';

export interface BoundEmail { email: string; serverUrl: string }
/** A binding belongs to the server that confirmed it, as the profile does. */
export const emailForServer = (bound: BoundEmail | null | undefined, serverUrl: string | undefined) => bound && bound.serverUrl === serverUrl ? bound.email : null;
export function shouldShowEmailReminder(input: { bound: BoundEmail | null | undefined; serverUrl?: string; dismissed: boolean | undefined; status: string; retired: boolean }): boolean {
  // Undefined means not loaded yet: no reminder rather than a flash for someone who has an address.
  if (input.bound === undefined || input.dismissed !== false || input.retired || input.status !== 'online') return false;
  return !emailForServer(input.bound, input.serverUrl);
}
