export type DeviceContact = { id: string; name: string; phones: string[]; usernames: string[] };
type ContactFields = { id: string; fullName?: string | null; phones?: { number?: string }[]; urlAddresses?: { label?: string; url?: string }[]; imAddresses?: { service?: string; label?: string; username?: string }[] };
const username = (value: string | undefined) => {
  const normalized = value?.trim().replace(/^@/, '').toLowerCase();
  return normalized && /^[a-z0-9_]{3,24}$/.test(normalized) ? normalized : undefined;
};
export function exactLastCallUsernames(record: ContactFields): string[] {
  const names = new Set<string>();
  for (const item of record.imAddresses ?? []) {
    if ((item.service ?? item.label)?.trim().toLowerCase() !== 'lastcall') continue;
    const found = username(item.username); if (found) names.add(found);
  }
  for (const item of record.urlAddresses ?? []) {
    if (item.label?.trim().toLowerCase() === 'lastcall') {
      const found = username(item.url); if (found) names.add(found);
    }
    try {
      const url = new URL(item.url ?? '');
      if (url.protocol !== 'https:' || url.hostname !== 'lienad.ru' || url.port || url.username || url.password || url.search || url.hash) continue;
      const match = /^\/messenger\/@([a-z0-9_]{3,24})\/?$/.exec(url.pathname);
      if (match?.[1]) names.add(match[1]);
    } catch { /* Arbitrary websites and unrelated services do not identify LastCall users. */ }
  }
  return [...names];
}
export function toDeviceContact(record: ContactFields): DeviceContact {
  const phones = [...new Set((record.phones ?? []).map(item => item.number?.trim()).filter((value): value is string => !!value))];
  return { id: record.id, name: record.fullName?.trim() || phones[0] || 'Без имени', phones, usernames: exactLastCallUsernames(record) };
}
