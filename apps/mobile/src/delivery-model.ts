import { t } from './i18n';

type Delivery = { status?: string; deliveryStatus?: string; recipientIds?: string[]; deliveredTo?: string[]; readBy?: string[]; notifiedTo?: string[] };
export type DeliveryStage = 'sending' | 'notified' | 'delivered' | 'read' | 'expired';

/** Only authenticated recipient receipts count as delivery; a handed-over push request is only the single tick. */
export function deliveryLabel(item: Delivery, group: boolean): string {
  const status = item.deliveryStatus ?? item.status;
  if (status === 'expired') return t('Not delivered within 7 days');
  if (status === 'received') return t('Received');
  const recipients = [...new Set(item.recipientIds ?? [])];
  const delivered = recipients.filter(id => item.deliveredTo?.includes(id)).length;
  const read = recipients.filter(id => item.readBy?.includes(id)).length;
  if (group && recipients.length) return t('Delivered {delivered} of {total} · Read {read} of {total}', { delivered, total: recipients.length, read });
  const stage = deliveryStage(item);
  if (stage === 'read') return t('Read');
  if (stage === 'delivered') return t('Delivered');
  if (stage === 'notified') return t('Sent · the recipient was notified');
  return t('Awaiting delivery · up to 7 days');
}

export function waitingForDelivery(item: Delivery): boolean {
  const status = item.deliveryStatus ?? item.status;
  return status === 'pending' || status === 'sent';
}

/**
 * WhatsApp/Telegram ticks: clock while still on this phone, one tick once every recipient was
 * reached or notified by push, two ticks when every recipient's phone confirmed it, two blue
 * ticks when everyone read it. Full group completion means every intended recipient.
 */
export function deliveryStage(item: Delivery): DeliveryStage {
  const status = item.deliveryStatus ?? item.status;
  if (status === 'expired') return 'expired';
  const recipients = [...new Set(item.recipientIds ?? [])];
  if (recipients.length && recipients.every(id => item.readBy?.includes(id))) return 'read';
  if (status === 'delivered') return 'delivered';
  const reached = (id: string) => !!item.deliveredTo?.includes(id) || !!item.notifiedTo?.includes(id);
  if (recipients.length ? recipients.every(reached) : !!item.notifiedTo?.length) return 'notified';
  return 'sending';
}
export function deliveryIcon(item: Delivery): 'time-outline' | 'checkmark' | 'checkmark-done' | 'alert-circle-outline' {
  return ({ sending: 'time-outline', notified: 'checkmark', delivered: 'checkmark-done', read: 'checkmark-done', expired: 'alert-circle-outline' } as const)[deliveryStage(item)];
}
/** Blue only for read, red for expired, the muted meta color otherwise. */
export function deliveryColor(item: Delivery): string {
  const stage = deliveryStage(item);
  return stage === 'read' ? '#2F8FE0' : stage === 'expired' ? '#A33535' : '#70877D';
}
/** An open route behind the lock screen/notification drawer is not a read. */
export function canMarkRead(focused: boolean, appState: string, interacting = true): boolean {
  return focused && appState === 'active' && interacting;
}

/** A completed incoming blob and rolling-history replacements each need a new read pass.
 * Receipt/unread updates themselves must leave this key stable. */
export function readContentVersion(
  messages: readonly { id: string; from: string; status: string }[],
  files: readonly { id: string; senderId: string; status: string; deliveryStatus?: string; blobKey?: string }[],
): string {
  return JSON.stringify([
    messages.filter(item => item.status === 'received').map(item => [item.from, item.id]),
    files.filter(item => item.deliveryStatus === 'received' && item.status === 'complete' && item.blobKey)
      .map(item => [item.senderId, item.id, item.blobKey]),
  ]);
}
