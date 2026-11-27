import { SignedRequestError, type TelegramCheck, type TelegramPurpose } from '@messenger/core';
import { signedRequestMessage } from './email-flow-model';
import { t } from './i18n';

/** What the Telegram screen does with an answer: keep waiting, offer a new link, or go on. */
export function telegramNextStep(purpose: TelegramPurpose, result: TelegramCheck): 'wait' | 'expired' | 'profile' | 'done' {
  if (result.state === 'pending') return 'wait';
  if (result.state === 'expired') return 'expired';
  return purpose === 'register' ? 'profile' : 'done';
}
export const telegramErrorCode = (error: unknown) => error instanceof SignedRequestError ? error.code : undefined;
/** Only a server refusal reads as one; a lost connection never does. */
export function telegramErrorMessage(error: unknown): string {
  const code = telegramErrorCode(error);
  return code ? signedRequestMessage(code) : t('Could not reach the server. Check your connection and try again.');
}
