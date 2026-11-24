import { t } from './i18n';
import type { MessengerSnapshot, SessionSnapshot } from '@messenger/core';
export function transportNotice(input: { directory: MessengerSnapshot['status']; group: boolean; peerOnline?: boolean; session?: SessionSnapshot; pending: number; waitingFiles?: number }): { text: string; warning: boolean } {
  // Files go only phone to phone: say so plainly when the only path the phones found runs through a relay.
  if (!input.group && input.session?.status === 'connected' && input.session.route === 'relay' && (input.waitingFiles ?? 0) > 0) return { text: t('Both phones are online, but a direct connection is not available. Files wait for one; messages still arrive.'), warning: true };
  if (!input.group && input.session?.status === 'connected') return { text: input.pending ? t('Connection with the contact is established. Waiting for delivery confirmation.') : t('Connected to the contact.'), warning: false };
  if (input.directory !== 'online') return { text: t('No connection to the server. Messages and files wait on this device for up to 7 days.'), warning: true };
  if (input.group) return { text: input.pending ? t('Not all participants have confirmed delivery yet. Phones sync when they connect; waiting up to 7 days.') : t('Group messages go through the server end-to-end encrypted; files go directly between phones.'), warning: input.pending > 0 };
  if (!input.peerOnline) return { text: t('The contact is offline. Messages will arrive when they come online; files once both phones are online. Waiting up to 7 days.'), warning: input.pending > 0 };
  // Texts reach the server either way; only files and calls need the direct connection that failed.
  if (input.session?.status === 'error' || input.session?.error) return { text: t('No direct connection to the contact yet. Messages go through the server; files and calls wait for a direct connection. Retrying automatically.'), warning: true };
  return { text: input.pending || input.session ? t('The server is connected. Connecting to the contact; messages will be sent automatically.') : t('The contact is online. Messages are end-to-end encrypted; calls and files go directly.'), warning: false };
}
