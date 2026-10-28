import { normalizePhone, phoneLookupHash, type PhoneMatch } from '@messenger/core';
import type { DeviceContact } from './phonebook-model';
export const DISCOVERY_BATCH_SIZE = 100;
export const MAX_DISCOVERY_CONTACTS = 2000;
export const MAX_DISCOVERY_NUMBERS = 5000;
/** Raw book data stays here. Only exact, deduplicated hashes leave the device. */
export function discoveryIndex(contacts: readonly DeviceContact[], country?: 'RU'): Map<string, DeviceContact[]> {
  if (contacts.length > MAX_DISCOVERY_CONTACTS) throw new Error('Для одного обновления доступно до 2000 контактов. Ограничьте доступ к книге в настройках телефона.');
  const index = new Map<string, DeviceContact[]>();
  for (const contact of contacts) {
    for (const number of contact.phones) {
      let hash: string;
      try { hash = phoneLookupHash(normalizePhone(number, country)); } catch { continue; }
      const records = index.get(hash) ?? [];
      if (!records.some(record => record.id === contact.id)) records.push(contact);
      index.set(hash, records);
      if (index.size > MAX_DISCOVERY_NUMBERS) throw new Error('Слишком много номеров для одного обновления: максимум 5000.');
    }
  }
  return index;
}
export async function discoverBatches(index: ReadonlyMap<string, DeviceContact[]>, verified: boolean,
  send: (hashes: string[]) => Promise<PhoneMatch[]>, active: () => boolean = () => true): Promise<PhoneMatch[]> {
  if (!verified) throw new Error('Сначала подтвердите свой номер.');
  const hashes = [...index.keys()];
  const found = new Map<string, PhoneMatch>();
  for (let offset = 0; offset < hashes.length; offset += DISCOVERY_BATCH_SIZE) {
    if (!active()) throw new Error('Поиск отменён.');
    const batch = hashes.slice(offset, offset + DISCOVERY_BATCH_SIZE);
    for (const match of await send(batch)) {
      if (batch.includes(match.hash)) found.set(match.user.userId, match);
    }
  }
  if (!active()) throw new Error('Поиск отменён.');
  return [...found.values()];
}
