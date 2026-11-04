import { locale, t } from './i18n';
import { useEffect, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import * as Network from 'expo-network';
import { EmailAuthError, MessengerClient, resolveDeviceProfile, startEmailChallenge, verifyEmailChallenge, type DeviceIdentity, type DirectoryUser, type EmailPurpose, type MessengerSnapshot } from '@messenger/core';
import { isAccountMoved, type BoundEmail } from './email-flow-model';
import { nativeRtc, validateServerUrl } from './native';
import { CanonicalProfileStore, profileSignature, registrationCandidate } from './registration-model';
import { DEFAULT_SERVER, deleteLocalAccount, loadBoundEmail, loadEmailReminderDismissed, loadIdentity, loadExistingIdentity, loadProfile, saveBoundEmail, saveEmailReminderDismissed, saveProfile, sealedStateAdapter, type LocalProfile } from './storage';
import { monitorNetworkRecovery, shouldForceNetworkResume } from './network-recovery';
import { SharedWakeRuntime, type WakeLease } from './wake-model';

const empty: MessengerSnapshot = { status: 'idle', contacts: [], conversations: [], verifiedContacts: [], blockedContacts: [], movedContacts: {} };
type Runtime = { ready: boolean; busy: boolean; registration: 'checking' | 'unregistered' | 'unavailable' | 'bound'; profile: LocalProfile | null; identity?: DeviceIdentity; snapshot: MessengerSnapshot; error?: string; boundEmail?: BoundEmail | null; emailReminderDismissed?: boolean; retired: boolean };
let state: Runtime = { ready: false, busy: false, registration: 'checking', profile: null, snapshot: empty, retired: false };
const listeners = new Set<() => void>();
const previewScopes = new WeakMap<MessengerClient, string>();
const observers = new Set<(snapshot: MessengerSnapshot, manager: MessengerClient) => void>();
const managers = new SharedWakeRuntime<MessengerClient>();
let bootPromise: Promise<void> | null = null;
let generation = 0;
/** Spent by the one manager built for a registration attempt; never persisted. */
let pendingEmailProof: string | undefined;
let profiles = new CanonicalProfileStore(saveProfile);
let networkRecovery: ReturnType<typeof monitorNetworkRecovery> | undefined;
let resumeSubscription: ReturnType<typeof AppState.addEventListener> | undefined;
const publish = (update: Partial<Runtime>) => { state = { ...state, ...update }; listeners.forEach(listener => listener()); };
export const errorText = (error: unknown) => error instanceof Error ? error.message : t('Could not complete the action. Try again.');
function canonicalProfile(serverUrl: string, user: DirectoryUser): LocalProfile {
  if (user.userId !== state.identity?.userId) throw new Error(t('The server returned a different device key.'));
  return { serverUrl, username: user.username, displayName: user.displayName };
}
function acceptCanonical(serverUrl: string, user: DirectoryUser) {
  const profile = canonicalProfile(serverUrl, user);
  if (!state.profile || profileSignature(state.profile) !== profileSignature(profile)) {
    publish({ profile, registration: 'bound' });
    void profiles.remember(profile).catch(() => publish({ error: t('The server confirmed the profile but it was not saved on this device. Reconnect. The key and history are preserved.') }));
  }
  return profile;
}
async function buildManager(profile: LocalProfile, signal?: AbortSignal): Promise<MessengerClient> {
  if (!state.identity) throw new Error(t('The device key is not loaded yet.'));
  const persistence = await sealedStateAdapter(state.identity, profile.serverUrl);
  if (signal?.aborted) throw new Error('Wake expired');
  const current = ++generation;
  const emailProof = pendingEmailProof; pendingEmailProof = undefined;
  const next = new MessengerClient({ ...profile, ...(emailProof ? { emailProof } : {}), identity: state.identity, ...nativeRtc, ...persistence,
    onChange: snapshot => {
      if (current !== generation) return;
      publish({ snapshot, ...(isAccountMoved(snapshot.error) ? { retired: true } : {}) });
      for (const observer of observers) { try { observer(snapshot, next); } catch { /* An optional native presenter cannot break delivery. */ } }
      if (snapshot.status === 'online' && snapshot.self) acceptCanonical(profile.serverUrl, snapshot.self);
    },
  });
  previewScopes.set(next, `${profile.serverUrl}:${state.identity.userId}`);
  publish({ snapshot: next.getSnapshot() });
  return next;
}
function installManager(profile: LocalProfile): Promise<MessengerClient> {
  return managers.replace(() => buildManager(profile));
}
export const messagePreviewScope = (manager: MessengerClient): string | null => previewScopes.get(manager) ?? null;
export function registerMessengerObserver(observer: (snapshot: MessengerSnapshot, manager: MessengerClient) => void): () => void {
  observers.add(observer); const current = managers.peek(); if (current) observer(current.getSnapshot(), current);
  return () => { observers.delete(observer); };
}
export const retainMessenger = (manager: MessengerClient) => managers.retain(manager);
export async function withMessagePreviewClient(operation: (manager: MessengerClient) => Promise<void>): Promise<void> {
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 15_000);
  let lease: WakeLease | null = null;
  try { lease = await acquireBackgroundManager(controller.signal); const current = managers.peek(); if (lease && current && !controller.signal.aborted) await operation(current); }
  finally { clearTimeout(timer); controller.abort(); await lease?.release(); }
}
export function acquireBackgroundManager(signal: AbortSignal): Promise<WakeLease | null> {
  return managers.acquire(async () => {
    const [identity, saved] = await Promise.all([loadExistingIdentity(), loadProfile()]);
    if (signal.aborted || !identity || !saved) return null;
    const profile = { ...saved, serverUrl: validateServerUrl(saved.serverUrl) };
    profiles = new CanonicalProfileStore(saveProfile, profile);
    publish({ identity, profile, registration: 'bound' });
    return buildManager(profile, signal);
  }, signal);
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
  managers.claimForeground();
  if (bootPromise) return bootPromise;
  // A cold background task may already own the manager, so this cannot live in its factory.
  void Promise.all([loadBoundEmail(), loadEmailReminderDismissed()])
    .then(([boundEmail, emailReminderDismissed]) => publish({ boundEmail, emailReminderDismissed }))
    .catch(() => publish({ boundEmail: null, emailReminderDismissed: true }));
  bootPromise = (async () => {
    try {
      // Foreground and headless initialization serialize through the same owner.
      // If a cold task already owns a manager, UI adopts it without a second adapter.
      const existing = await managers.ensure(async () => {
        const identity = await loadIdentity();
        publish({ identity });
        const cached = await loadProfile();
        profiles = new CanonicalProfileStore(saveProfile, cached ?? undefined);
        publish({ identity, profile: cached, registration: cached ? 'bound' : 'checking', ready: !cached });
        return cached ? buildManager({ ...cached, serverUrl: validateServerUrl(cached.serverUrl) }) : null;
      });
      if (existing) {
        publish({ ready: true });
        try { await existing.connect(); }
        catch (error) {
          if (!/device-already-registered/.test(errorText(error)) || !state.identity || !state.profile) throw error;
          const bound = await resolveDeviceProfile(state.profile.serverUrl, state.identity);
          if (!bound) throw error;
          await connectResolved(state.profile.serverUrl, bound);
        }
      } else await checkRegistration();
    } catch (error) { publish({ ready: true, registration: state.profile ? 'bound' : 'unavailable', error: errorText(error), ...(isAccountMoved(errorText(error)) ? { retired: true } : {}) }); }
  })();
  // One app-scoped subscription survives navigation; never tear down peers merely
  // because Wi-Fi disappears while Android switches its default route to mobile.
  networkRecovery?.stop();
  resumeSubscription?.remove();
  networkRecovery = monitorNetworkRecovery({
    read: Network.getNetworkStateAsync,
    listen: Network.addNetworkStateListener,
    onReachable: async () => {
      const current = managers.peek();
      if (current) await current.networkChanged();
    },
  });
  resumeSubscription = AppState.addEventListener('change', value => {
    if (value !== 'active') return;
    // Read reachability on every foreground, but do not force a synthetic
    // network change over an already-connected live call; changed signatures
    // and the core recovery watchdog still recover real route changes.
    void networkRecovery?.resume(shouldForceNetworkResume(managers.peek()?.getSnapshot()));
  });
  return bootPromise;
}
export function useMessenger() {
  const current = useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => state);
  useEffect(() => { void boot(); }, []);
  return current;
}
export function client(): MessengerClient {
  const manager = managers.peek();
  if (!manager) throw new Error(t('Confirm registration on the server first.'));
  return manager;
}
export async function deleteAccount(): Promise<void> {
  if (state.busy || !state.profile) return;
  publish({ busy: true, error: undefined });
  try {
    await managers.peek()?.deleteAccount();
    await managers.clear();
    await deleteLocalAccount();
    generation++;
    const identity = await loadIdentity();
    profiles = new CanonicalProfileStore(saveProfile);
    publish({ busy: false, ready: true, profile: null, identity, registration: 'unregistered', snapshot: empty, error: undefined, boundEmail: null, emailReminderDismissed: false, retired: false });
  } catch (error) {
    publish({ busy: false, error: errorText(error) });
    throw error;
  }
}
/** The server no longer accepts this key, so there is nothing to delete there. */
export async function removeRetiredDeviceData(): Promise<void> {
  if (state.busy || !state.retired) return;
  publish({ busy: true, error: undefined });
  try {
    await managers.clear();
    await deleteLocalAccount();
    generation++;
    const identity = await loadIdentity();
    profiles = new CanonicalProfileStore(saveProfile);
    publish({ busy: false, ready: true, profile: null, identity, registration: 'unregistered', snapshot: empty, error: undefined, boundEmail: null, emailReminderDismissed: false, retired: false });
  } catch (error) {
    publish({ busy: false, error: errorText(error) });
    throw error;
  }
}
async function rememberEmail(email: string, serverUrl: string) {
  const boundEmail = { email, serverUrl };
  publish({ boundEmail });
  // The binding exists on the server either way; a failed save only brings the reminder back.
  try { await saveBoundEmail(boundEmail); } catch { /* Kept for this session. */ }
}
const emailServer = () => validateServerUrl(state.profile?.serverUrl ?? DEFAULT_SERVER);
/** Null means another operation was already running. Refusals stay with the caller, which shows them in place. */
export async function requestEmailCode(purpose: EmailPurpose, email: string): Promise<string | null> {
  if (state.busy) return null;
  if (!state.identity) throw new Error(t('The device key is not loaded yet.'));
  publish({ busy: true, error: undefined });
  try { return await startEmailChallenge(emailServer(), state.identity, { purpose, email, locale }); }
  finally { publish({ busy: false }); }
}
/** Registration: returns the proof to send with the next registration attempt. */
export async function confirmRegistrationEmail(challengeId: string, code: string): Promise<string | null> {
  if (state.busy) return null;
  if (!state.identity) throw new Error(t('The device key is not loaded yet.'));
  publish({ busy: true, error: undefined });
  try {
    const { proof } = await verifyEmailChallenge(emailServer(), state.identity, challengeId, code);
    if (!proof) throw new Error(t('The server did not confirm the profile.'));
    return proof;
  } finally { publish({ busy: false }); }
}
export async function bindEmail(challengeId: string, code: string, email: string): Promise<boolean> {
  if (state.busy || !state.profile) return false;
  if (!state.identity) throw new Error(t('The device key is not loaded yet.'));
  const serverUrl = state.profile.serverUrl;
  publish({ busy: true, error: undefined });
  try {
    await verifyEmailChallenge(serverUrl, state.identity, challengeId, code);
    await rememberEmail(email, serverUrl);
    return true;
  } finally { publish({ busy: false }); }
}
export function dismissEmailReminder(): void {
  publish({ emailReminderDismissed: true });
  void saveEmailReminderDismissed().catch(() => { /* It comes back next launch. */ });
}
/** Moves the account onto this device's key. Afterwards the old key no longer works. */
export async function recoverAccount(challengeId: string, code: string, email: string): Promise<void> {
  if (state.busy || state.profile || state.registration !== 'unregistered') return;
  if (!state.identity) throw new Error(t('The device key is not loaded yet.'));
  const identity = state.identity;
  const serverUrl = validateServerUrl(DEFAULT_SERVER);
  publish({ busy: true, error: undefined });
  try {
    let user: DirectoryUser | null | undefined;
    try { ({ user } = await verifyEmailChallenge(serverUrl, identity, challengeId, code)); }
    catch (cause) {
      if (cause instanceof EmailAuthError) throw cause;
      // The move may have committed before the reply was lost. Never offer anything
      // else until the server confirms this key has no profile.
      try { user = await resolveDeviceProfile(serverUrl, identity); }
      catch { publish({ registration: 'unavailable' }); throw cause; }
      if (!user) throw cause;
    }
    if (!user) throw new Error(t('The server did not confirm the profile.'));
    await rememberEmail(email, serverUrl);
    try {
      await connectResolved(serverUrl, user);
      if (state.profile) await profiles.remember(state.profile);
    } catch (error) {
      // The account is already here; a failed connection retries like any other.
      if (!state.profile) throw error;
      publish({ error: errorText(error) });
    }
  } finally { publish({ busy: false }); }
}
export async function registerProfile(displayName: string, username: string, emailProof?: string, email?: string): Promise<void> {
  if (state.busy || state.profile || state.registration !== 'unregistered') return;
  const proposed = { displayName: displayName.trim(), username: username.trim().replace(/^@/, '').toLowerCase(), serverUrl: validateServerUrl(DEFAULT_SERVER) };
  if (!proposed.displayName || proposed.displayName.length > 48) throw new Error(t('The name must contain 1–48 characters.'));
  if (!/^[a-z0-9_]{3,24}$/.test(proposed.username)) throw new Error(t('Username: 3–24 Latin letters, digits or _.'));
  if (!state.identity) throw new Error(t('The device key is not loaded yet.'));
  const identity = state.identity;
  publish({ busy: true, error: undefined });
  try {
    const profile = await registrationCandidate(proposed, () => resolveDeviceProfile(proposed.serverUrl, identity));
    pendingEmailProof = emailProof;
    await connectCanonical(profile);
    if (!state.profile) throw new Error(t('The server did not confirm the profile.'));
    await profiles.remember(state.profile);
    if (email && emailProof) await rememberEmail(email, proposed.serverUrl);
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
  } finally { pendingEmailProof = undefined; publish({ busy: false }); }
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
  if (state.retired) return;
  publish({ error: undefined });
  try {
    const current = managers.peek() ?? (state.profile ? await installManager(state.profile) : client());
    await current.connect();
    if (state.profile) await profiles.remember(state.profile);
  } catch (error) { publish({ error: errorText(error) }); }
}
