type Delivery = { status?: string; deliveryStatus?: string; recipientIds?: string[]; deliveredTo?: string[]; readBy?: string[] };

/** Only authenticated recipient receipts count; transport send success does not. */
export function deliveryLabel(item: Delivery, group: boolean): string {
  const status = item.deliveryStatus ?? item.status;
  if (status === 'expired') return 'Не доставлено за 7 дней';
  if (status === 'received') return 'Получено';
  const recipients = [...new Set(item.recipientIds ?? [])];
  const delivered = recipients.filter(id => item.deliveredTo?.includes(id)).length;
  const read = recipients.filter(id => item.readBy?.includes(id)).length;
  if (group && recipients.length) return `Доставлено ${delivered} из ${recipients.length} · Прочитано ${read} из ${recipients.length}`;
  if (deliveryStage(item) === 'read') return 'Прочитано';
  if (status === 'delivered') return 'Доставлено';
  return status === 'sent' ? 'Ожидает подтверждения' : 'Ожидает доставки · до 7 дней';
}

export function waitingForDelivery(item: Delivery): boolean {
  const status = item.deliveryStatus ?? item.status;
  return status === 'pending' || status === 'sent';
}

/** Full group completion means every intended recipient, never an intermediary. */
export function deliveryStage(item: Delivery): 'sending' | 'delivered' | 'read' | 'expired' {
  const status = item.deliveryStatus ?? item.status;
  if (status === 'expired') return 'expired';
  const recipients = [...new Set(item.recipientIds ?? [])];
  if (recipients.length && recipients.every(id => item.readBy?.includes(id))) return 'read';
  return status === 'delivered' ? 'delivered' : 'sending';
}
export function deliveryIcon(item: Delivery): 'time-outline' | 'checkmark' | 'checkmark-done' | 'alert-circle-outline' {
  return { sending: 'time-outline', delivered: 'checkmark', read: 'checkmark-done', expired: 'alert-circle-outline' }[deliveryStage(item)] as ReturnType<typeof deliveryIcon>;
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
