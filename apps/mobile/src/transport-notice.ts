import { t } from './i18n';
import type { MessengerSnapshot, SessionSnapshot } from '@messenger/core';
export function transportNotice(input: { directory: MessengerSnapshot['status']; group: boolean; peerOnline?: boolean; session?: SessionSnapshot; pending: number }): { text: string; warning: boolean } {
  if (!input.group && input.session?.status === 'connected') return { text: input.pending ? t('Connection with the contact is established. Waiting for delivery confirmation.') : t('Connected to the contact.'), warning: false };
  if (input.directory !== 'online') return { text: t('No connection to the server. Messages and files wait on this device for up to 7 days.'), warning: true };
  if (input.group) return { text: input.pending ? t('Not all participants have confirmed delivery yet. Phones sync when they connect; waiting up to 7 days.') : t('Group data syncs directly between participants’ phones.'), warning: input.pending > 0 };
  if (input.session?.status === 'error' || input.session?.error) return { text: t('The server is connected, but the contact is unreachable. Retrying automatically; messages wait on this device.'), warning: true };
  if (!input.peerOnline) return { text: t('The contact is offline. Messages and files wait on this device for up to 7 days until both participants are available.'), warning: input.pending > 0 };
  return { text: input.pending || input.session ? t('The server is connected. Connecting to the contact; messages will be sent automatically.') : t('The contact is online. A secure connection will be established when you send a message or call.'), warning: false };
}
