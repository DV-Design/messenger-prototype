import { useEffect, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import * as Network from 'expo-network';
import { MessengerClient, resolveDeviceProfile, type DeviceIdentity, type DirectoryUser, type MessengerSnapshot } from '@messenger/core';
import { nativeRtc, validateServerUrl } from './native';
import { CanonicalProfileStore, profileSignature, registrationCandidate } from './registration-model';
import { DEFAULT_SERVER, loadIdentity, loadProfile, saveProfile, sealedStateAdapter, type LocalProfile } from './storage';
import { monitorNetworkRecovery } from './network-recovery';

const empty: MessengerSnapshot = { status: 'idle', contacts: [], conversations: [] };
type Runtime = { ready: boolean; busy: boolean; registration: 'checking' | 'unregistered' | 'unavailable' | 'bound'; profile: LocalProfile | null; identity?: DeviceIdentity; snapshot: MessengerSnapshot; error?: string };
let state: Runtime = { ready: false, busy: false, registration: 'checking', profile: null, snapshot: empty };
const listeners = new Set<() => void>();
let manager: MessengerClient | null = null;
let bootPromise: Promise<void> | null = null;
let generation = 0;
let profiles = new CanonicalProfileStore(saveProfile);
let networkRecovery: ReturnType<typeof monitorNetworkRecovery> | undefined;
let resumeSubscription: ReturnType<typeof AppState.addEventListener> | undefined;
const publish = (update: Partial<Runtime>) => { state = { ...state, ...update }; listeners.forEach(listener => listener()); };
export const errorText = (error: unknown) => error instanceof Error ? error.message : 'Не удалось выполнить действие. Попробуйте ещё раз.';
function canonicalProfile(serverUrl: string, user: DirectoryUser): LocalProfile {
  if (user.userId !== state.identity?.userId) throw new Error('Сервер вернул другой ключ устройства.');
  return { serverUrl, username: user.username, displayName: user.displayName };
}
function acceptCanonical(serverUrl: string, user: DirectoryUser) {
  const profile = canonicalProfile(serverUrl, user);
  if (!state.profile || profileSignature(state.profile) !== profileSignature(profile)) {
    publish({ profile, registration: 'bound' });
    void profiles.remember(profile).catch(() => publish({ error: 'Профиль подтверждён сервером, но не сохранён на устройстве. Повторите подключение. Ключ и история сохранены.' }));
  }
  return profile;
}
async function installManager(profile: LocalProfile): Promise<MessengerClient> {
  if (!state.identity) throw new Error('Ключ устройства ещё не загружен.');
  const persistence = await sealedStateAdapter(state.identity, profile.serverUrl);
  const current = ++generation;
  manager?.disconnect();
  const next = new MessengerClient({ ...profile, identity: state.identity, ...nativeRtc, ...persistence,
    onChange: snapshot => {
      if (current !== generation) return;
      publish({ snapshot });
      if (snapshot.status === 'online' && snapshot.self) acceptCanonical(profile.serverUrl, snapshot.self);
    },
  });
  manager = next;
  publish({ snapshot: next.getSnapshot() });
  return next;
}
async function connectResolved(serverUrl: string, user: DirectoryUser) {
  const profile = canonicalProfile(serverUrl, user);
  const current = await installManager(profile);
  // Expose a recovered profile only after its client exists for routed screens.
  acceptCanonical(serverUrl, user);
  publish({ ready: true });
  await current.connect();
}
async function connectCanonical(profile: LocalProfile) {
  const current = await installManager(profile);
  publish({ ready: true });
  try { await current.connect(); }
  catch (error) {
    if (!/device-already-registered/.test(errorText(error)) || !state.identity) throw error;
    const bound = await resolveDeviceProfile(profile.serverUrl, state.identity);
    if (!bound) throw error;
    await connectResolved(profile.serverUrl, bound);
  }
}
export async function checkRegistration(): Promise<void> {
  if (state.busy || state.profile || !state.identity) return;
  publish({ busy: true, registration: 'checking', error: undefined });
  try {
    const server = validateServerUrl(DEFAULT_SERVER);
    const user = await resolveDeviceProfile(server, state.identity);
    if (!user) { publish({ registration: 'unregistered' }); return; }
    await connectResolved(server, user);
  } catch (error) { publish({ registration: state.profile ? 'bound' : 'unavailable', error: errorText(error) }); }
  finally { publish({ ready: true, busy: false }); }
}
export function boot(): Promise<void> {
  if (bootPromise) return bootPromise;
  bootPromise = (async () => {
    try {
      const identity = await loadIdentity();
      publish({ identity });
      const cached = await loadProfile();
      profiles = new CanonicalProfileStore(saveProfile, cached ?? undefined);
      publish({ identity, profile: cached, registration: cached ? 'bound' : 'checking', ready: !cached });
      if (cached) await connectCanonical({ ...cached, serverUrl: validateServerUrl(cached.serverUrl) });
      else await checkRegistration();
    } catch (error) { publish({ ready: true, registration: state.profile ? 'bound' : 'unavailable', error: errorText(error) }); }
  })();
  // One app-scoped subscription survives navigation; never tear down peers merely
  // because Wi-Fi disappears while Android switches its default route to mobile.
  networkRecovery?.stop();
  resumeSubscription?.remove();
  networkRecovery = monitorNetworkRecovery({
    read: Network.getNetworkStateAsync,
    listen: Network.addNetworkStateListener,
    onReachable: async () => {
      const current = manager;
      if (current) await current.networkChanged();
    },
  });
  resumeSubscription = AppState.addEventListener('change', value => {
    if (value === 'active') void networkRecovery?.resume();
  });
  return bootPromise;
}
export function useMessenger() {
  const current = useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => state);
  useEffect(() => { void boot(); }, []);
  return current;
}
export function client(): MessengerClient {
  if (!manager) throw new Error('Сначала подтвердите регистрацию на сервере.');
  return manager;
}
export async function registerProfile(displayName: string, username: string): Promise<void> {
  if (state.busy || state.profile || state.registration !== 'unregistered') return;
  const proposed = { displayName: displayName.trim(), username: username.trim().replace(/^@/, '').toLowerCase(), serverUrl: validateServerUrl(DEFAULT_SERVER) };
  if (!proposed.displayName || proposed.displayName.length > 48) throw new Error('Имя должно содержать от 1 до 48 символов.');
  if (!/^[a-z0-9_]{3,24}$/.test(proposed.username)) throw new Error('Логин: 3–24 латинские буквы, цифры или _.');
  if (!state.identity) throw new Error('Ключ устройства ещё не загружен.');
  const identity = state.identity;
  publish({ busy: true, error: undefined });
  try {
    const profile = await registrationCandidate(proposed, () => resolveDeviceProfile(proposed.serverUrl, identity));
    await connectCanonical(profile);
    if (!state.profile) throw new Error('Сервер не подтвердил профиль.');
    await profiles.remember(state.profile);
  } catch (error) {
    // A connection may have registered the key before its ACK/save was lost.
    // Resolve again; never offer another login until the server confirms null.
    if (!state.profile) {
      try {
        const bound = await resolveDeviceProfile(proposed.serverUrl, identity);
        if (bound) await connectResolved(proposed.serverUrl, bound);
        else publish({ registration: 'unregistered' });
      } catch { publish({ registration: 'unavailable' }); }
    }
    publish({ error: errorText(error) });
    throw error;
  } finally { publish({ busy: false }); }
}
export async function changeServer(server: string): Promise<void> {
  if (state.busy || !state.profile || !state.identity) return;
  const previous = state.profile;
  const serverUrl = validateServerUrl(server);
  publish({ busy: true, error: undefined });
  try {
    const profile = await registrationCandidate({ ...previous, serverUrl }, () => resolveDeviceProfile(serverUrl, state.identity!));
    await connectCanonical(profile);
    if (state.profile) await profiles.remember(state.profile);
  } catch (error) {
    if (state.profile?.serverUrl === previous.serverUrl) await connectCanonical(previous).catch(() => {});
    publish({ error: errorText(error) }); throw error;
  } finally { publish({ busy: false }); }
}
export async function reconnect(): Promise<void> {
  publish({ error: undefined });
  try {
    const current = manager ?? (state.profile ? await installManager(state.profile) : client());
    await current.connect();
    if (state.profile) await profiles.remember(state.profile);
  } catch (error) { publish({ error: errorText(error) }); }
}
