import { useEffect, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import { MessengerClient, type DeviceIdentity, type MessengerSnapshot } from '@messenger/core';
import { nativeRtc, validateServerUrl } from './native';
import { DEFAULT_SERVER, loadIdentity, loadProfile, saveProfile, sealedStateAdapter, type LocalProfile } from './storage';

const empty: MessengerSnapshot = { status: 'idle', contacts: [], conversations: [] };
type Runtime = { ready: boolean; busy: boolean; profile: LocalProfile | null; identity?: DeviceIdentity; snapshot: MessengerSnapshot; error?: string };
let state: Runtime = { ready: false, busy: false, profile: null, snapshot: empty };
const listeners = new Set<() => void>();
let manager: MessengerClient | null = null;
let bootPromise: Promise<void> | null = null;
let generation = 0;
const publish = (update: Partial<Runtime>) => { state = { ...state, ...update }; listeners.forEach(listener => listener()); };
export const errorText = (error: unknown) => error instanceof Error ? error.message : 'Не удалось выполнить действие. Попробуйте ещё раз.';

async function installManager(profile: LocalProfile): Promise<MessengerClient> {
  if (!state.identity) throw new Error('Ключ устройства ещё не загружен.');
  const persistence = await sealedStateAdapter(state.identity, profile.serverUrl);
  const current = ++generation;
  manager?.disconnect();
  const next = new MessengerClient({ ...profile, identity: state.identity, ...nativeRtc, ...persistence,
    onChange: snapshot => { if (current === generation) publish({ snapshot }); },
  });
  manager = next;
  publish({ snapshot: next.getSnapshot(), error: undefined });
  return next;
}
export function boot(): Promise<void> {
  if (bootPromise) return bootPromise;
  bootPromise = (async () => {
    try {
      const identity = await loadIdentity();
      const profile = await loadProfile();
      publish({ identity, profile, ready: !profile });
      if (profile) {
        const client = await installManager({ ...profile, serverUrl: validateServerUrl(profile.serverUrl) });
        publish({ ready: true });
        await client.connect();
      }
    } catch (error) { publish({ ready: true, error: errorText(error) }); }
  })();
  // Route transitions and ordinary backgrounding do not destroy the directory
  // connection or independent contact sessions. Resume asks core to reconnect.
  AppState.addEventListener('change', value => {
    if (value === 'active' && manager && ['offline', 'error', 'idle'].includes(manager.getSnapshot().status)) {
      void manager.connect().catch(error => publish({ error: errorText(error) }));
    }
  });
  return bootPromise;
}
export function useMessenger() {
  const current = useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => state);
  useEffect(() => { void boot(); }, []);
  return current;
}
export function client(): MessengerClient {
  if (!manager) throw new Error('Сначала создайте профиль.');
  return manager;
}
export async function registerProfile(displayName: string, username: string): Promise<void> {
  const profile = { displayName: displayName.trim(), username: username.trim().replace(/^@/, '').toLowerCase(), serverUrl: validateServerUrl(DEFAULT_SERVER) };
  if (!profile.displayName || profile.displayName.length > 48) throw new Error('Имя должно содержать от 1 до 48 символов.');
  if (!/^[a-z0-9_]{3,24}$/.test(profile.username)) throw new Error('Имя пользователя: 3–24 латинские буквы, цифры или _.');
  publish({ busy: true, error: undefined });
  try {
    const current = await installManager(profile);
    await current.connect();
    await saveProfile(profile);
    publish({ profile });
  } catch (error) {
    manager?.disconnect();
    publish({ error: errorText(error) });
    throw error;
  } finally { publish({ busy: false }); }
}
export async function changeServer(server: string): Promise<void> {
  if (!state.profile) throw new Error('Профиль не создан.');
  const profile = { ...state.profile, serverUrl: validateServerUrl(server) };
  publish({ busy: true, error: undefined });
  try {
    await saveProfile(profile);
    publish({ profile });
    const current = await installManager(profile);
    await current.connect();
  } catch (error) { publish({ error: errorText(error) }); throw error; }
  finally { publish({ busy: false }); }
}
export async function reconnect(): Promise<void> {
  publish({ error: undefined });
  try {
    const current = manager ?? (state.profile ? await installManager(state.profile) : client());
    await current.connect();
  } catch (error) { publish({ error: errorText(error) }); }
}
