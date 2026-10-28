import { useSyncExternalStore } from 'react';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import type { DirectoryUser, MessengerClient, PhoneMatch } from '@messenger/core';
import { discoverBatches, discoveryIndex, MAX_DISCOVERY_CONTACTS } from './discovery-model';
import { readDeviceContacts, saveContactLink } from './phonebook';
import { hasAccess } from './permission-model';
import { readPermission } from './permissions';
export type DiscoveredContact = { user: DirectoryUser; localName: string };
type State = { ready: boolean; enabled: boolean; busy: boolean; consentSaveFailed?: boolean; matches: DiscoveredContact[]; error?: string; updatedAt?: number };
let state: State = { ready: false, enabled: false, busy: false, matches: [] };
let context: { server: string; userId: string; client: MessengerClient; key: string } | undefined;
let generation = 0;
let cachedLookup: { digest: string; time: number; matches: PhoneMatch[] } | undefined;
const listeners = new Set<() => void>();
const publish = (update: Partial<State>) => { state = { ...state, ...update }; listeners.forEach(listener => listener()); };
export const useDiscovery = () => useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => state);
export async function configureDiscovery(server: string, userId: string, client: MessengerClient) {
  const current = ++generation;
  context = undefined; cachedLookup = undefined;
  publish({ ready: false, enabled: false, busy: false, matches: [], error: undefined, consentSaveFailed: false, updatedAt: undefined });
  const hash = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, JSON.stringify(['lastcall/discovery-consent/v1', server, userId]));
  const key = `lastcall.discovery.${hash}`;
  let enabled = false;
  try { enabled = await SecureStore.getItemAsync(key) === 'enabled'; }
  catch { if (current === generation) publish({ ready: true, error: 'Не удалось прочитать согласие на автопоиск. Номера не отправлены.' }); return; }
  if (current !== generation) return;
  context = { server, userId, client, key };
  publish({ ready: true, enabled });
  if (enabled) await syncDiscovery();
}
export function clearDiscovery() { generation += 1; context = undefined; cachedLookup = undefined; publish({ ready: false, enabled: false, busy: false, matches: [], error: undefined }); }
export async function setDiscoveryEnabled(enabled: boolean) {
  const current = context;
  if (!current) throw new Error('Дождитесь загрузки настроек.');
  const epoch = ++generation;
  if (!enabled) { cachedLookup = undefined; publish({ enabled: false, busy: false, matches: [], updatedAt: undefined, error: undefined }); }
  try { await SecureStore.setItemAsync(current.key, enabled ? 'enabled' : 'disabled', { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }); }
  catch (error) {
    if (current === context && epoch === generation && !enabled) publish({ enabled: true, consentSaveFailed: true, error: 'Отключение не сохранено. Поиск остановлен до перезапуска, но после перезапуска может включиться снова. Повторите отключение или отзовите доступ к контактам в настройках телефона.' });
    throw error;
  }
  if (current !== context || epoch !== generation) return;
  publish({ enabled, busy: false, consentSaveFailed: false, error: undefined });
  if (enabled) await syncDiscovery();
}
export async function syncDiscovery(automatic = false) {
  const current = context;
  if (!current || !state.enabled || state.busy || state.consentSaveFailed) return;
  if (automatic && state.updatedAt && Date.now() - state.updatedAt < 60_000) return;
  if (current.client.getSnapshot().status !== 'online') return;
  const epoch = generation;
  const active = () => current === context && generation === epoch && state.enabled;
  publish({ busy: true, error: undefined });
  try {
    const capabilities = await current.client.getServices();
    if (!active()) return;
    if (!capabilities.phoneVerified) throw new Error('Для автопоиска подтвердите свой номер.');
    if (!hasAccess(await readPermission('contacts'))) { if (active()) { cachedLookup = undefined; publish({ matches: [], updatedAt: undefined }); } throw new Error('Для автопоиска разрешите чтение контактов.'); }
    const records = [];
    for (let offset = 0; ; ) {
      if (!active()) return;
      const page = await readDeviceContacts(offset);
      records.push(...page.contacts); offset += page.contacts.length;
      if (records.length > MAX_DISCOVERY_CONTACTS) throw new Error('Максимум 2000 контактов за обновление. Ограничьте доступ к книге в настройках телефона.');
      if (!page.hasMore) break;
    }
    // RU is an explicit UI-labelled default for local numbers; international + numbers stay international.
    const index = discoveryIndex(records, 'RU');
    const digest = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, [...index.keys()].sort().join(''));
    // Unchanged books reuse in-memory results for 30 minutes, including manual refresh.
    // No phonebook, hashes or names are persisted. This avoids exhausting server quotas.
    const cached = cachedLookup?.digest === digest && Date.now() - cachedLookup.time < 30 * 60_000 ? cachedLookup : undefined;
    const matches = cached?.matches ?? await discoverBatches(index, capabilities.phoneVerified, batch => current.client.discoverPhones(batch), active);
    if (active() && !cached) cachedLookup = { digest, time: Date.now(), matches };
    if (!active()) return;
    const result: DiscoveredContact[] = [];
    for (const match of matches) {
      if (match.user.userId === current.userId) continue;
      const contacts = index.get(match.hash) ?? [];
      for (const contact of contacts) {
        if (!active()) return;
        await saveContactLink(current.server, current.userId, contact.id, match.user.userId);
      }
      result.push({ user: match.user, localName: contacts[0]?.name ?? match.user.displayName });
    }
    if (active()) publish({ matches: result, updatedAt: cachedLookup?.time ?? Date.now() });
  } catch { if (active()) publish({ error: 'Автопоиск не выполнен. Проверьте подтверждение номера, доступ к контактам и соединение; сервер также ограничивает частоту запросов.' }); }
  finally { if (active()) publish({ busy: false }); }
}
