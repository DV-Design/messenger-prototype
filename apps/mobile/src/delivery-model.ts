type Delivery = { status?: string; deliveryStatus?: string; recipientIds?: string[]; deliveredTo?: string[] };

/** Only authenticated recipient receipts count; transport send success does not. */
export function deliveryLabel(item: Delivery, group: boolean): string {
  const status = item.deliveryStatus ?? item.status;
  if (status === 'expired') return 'Не доставлено за 7 дней';
  if (status === 'received') return 'Получено';
  const recipients = [...new Set(item.recipientIds ?? [])];
  const delivered = recipients.filter(id => item.deliveredTo?.includes(id)).length;
  if (group && recipients.length) return `Доставлено ${delivered} из ${recipients.length}`;
  if (status === 'delivered') return 'Доставлено';
  return status === 'sent' ? 'Ожидает подтверждения' : 'Ожидает доставки · до 7 дней';
}

export function waitingForDelivery(item: Delivery): boolean {
  const status = item.deliveryStatus ?? item.status;
  return status === 'pending' || status === 'sent';
}
