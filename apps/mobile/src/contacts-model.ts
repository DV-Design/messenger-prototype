/** Pure helpers for the in-app contact list; the side-effecting loader lives in contacts.ts. */
export interface PhoneContact { id: string; name: string; phones: string[] }

const digits = (value: string) => value.replace(/\D/g, '');

/** Drops blank and repeated numbers (same digits, different formatting), keeping the first spelling. */
export function uniquePhones(numbers: readonly (string | undefined)[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of numbers) {
    const value = raw?.trim();
    const key = value ? digits(value) : '';
    if (!value || !key || seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}

/** Case-insensitive match on any word of the name, or on the digits of any number. */
export function filterContacts(list: readonly PhoneContact[], query: string): PhoneContact[] {
  const text = query.trim().toLocaleLowerCase();
  if (!text) return [...list];
  const queryDigits = digits(text);
  return list.filter(contact => contact.name.toLocaleLowerCase().includes(text)
    || (queryDigits.length >= 3 && contact.phones.some(phone => digits(phone).includes(queryDigits))));
}
