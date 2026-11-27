import { chooseServer, saveEndpoints, savedEndpoints } from './server-endpoints';
import { shouldSwitch } from './server-endpoints-model';
import { emailLocale, t } from './i18n';
import { useEffect, useSyncExternalStore } from 'react';
import { AppState, NativeModules, Platform } from 'react-native';
import * as Network from 'expo-network';
import { EmailAuthError, MessengerClient, SignedRequestError, checkAccess, checkTelegram, fetchRegistrationPolicyInfo, requestAccess, resolveDeviceProfile, startEmailChallenge, startTelegram, verifyEmailChallenge, type AccessState, type PhoneVisibility, type TelegramCheck, type TelegramPurpose, type TelegramSession, type DeviceIdentity, type DirectoryUser, type EmailPurpose, type MessengerOptions, type MessengerSnapshot } from '@messenger/core';
import { isAccountMoved, type BoundEmail } from './email-flow-model';
import { nativeRtc, validateServerUrl } from './native';
import { CanonicalProfileStore, profileSignature, registrationCandidate } from './registration-model';
import { bulkFiles } from './bulk-files';
import { collectCountryHints } from './country-hints';
import { DEFAULT_SERVER, deleteLocalAccount, loadBoundEmail, loadEmailReminderDismissed, loadIdentity, loadExistingIdentity, loadProfile, saveBoundEmail, saveEmailReminderDismissed, saveProfile, sealedStateAdapter, type LocalProfile } from './storage';
import { monitorNetworkRecovery, shouldForceNetworkResume } from './network-recovery';
import { ConnectionSupervisor } from './connection-supervisor';
import { SharedWakeRuntime, type WakeLease } from './wake-model';
import { whenTransitionsIdle } from './transition-idle';
import { busyWith, countUpdate } from './stall-watch';

const empty: MessengerSnapshot = { status: 'idle', restored: false, contacts: [], conversations: [], verifiedContacts: [], blockedContacts: [], movedContacts: {} };
type Runtime = { ready: boolean; busy: boolean; registration: 'checking' | 'unregistered' | 'unavailable' | 'bound'; profile: LocalProfile | null; identity?: DeviceIdentity; snapshot: MessengerSnapshot; error?: string; boundEmail?: BoundEmail | null; /** The number linked through Telegram (masked) and who may find it; undefined until the server answered. */ phone?: { phone?: string; visibility: PhoneVisibility } | null; emailReminderDismissed?: boolean; retired: boolean };
let state: Runtime = { ready: false, busy: false, registration: 'checking', profile: null, snapshot: empty, retired: false };
const listeners = new Set<() => void>();
const previewScopes = new WeakMap<MessengerClient, string>();
const observers = new Set<(snapshot: MessengerSnapshot, manager: MessengerClient) => void>();
const managers = new SharedWakeRuntime<MessengerClient>();
let bootPromise: Promise<void> | null = null;
let generation = 0;
type RegistrationCredentials = Pick<MessengerOptions, 'emailProof' | 'phoneProof' | 'inviteCode' | 'countryHints'>;
let profiles = new CanonicalProfileStore(saveProfile);
let networkRecovery: ReturnType<typeof monitorNetworkRecovery> | undefined;
let resumeSubscription: ReturnType<typeof AppState.addEventListener> | undefined;
let latestSnapshot: MessengerSnapshot | undefined;
let snapshotFrame: ReturnType<typeof setTimeout> | undefined;
const publish = (update: Partial<Runtime>) => { state = { ...state, ...update }; listeners.forEach(listener => listener()); supervisor.poke(); };
// Core stops on some server errors and waits for a caller; the foreground app is that caller.
const supervisor = new ConnectionSupervisor({
  read: () => ({ foreground: AppState.currentState === 'active', retired: !!state.retired, hasProfile: !!state.profile, hasIdentity: !!state.identity,
    registration: state.registration, status: state.snapshot.status, error: state.snapshot.error ?? state.error }),
  reconnect: () => reconnect(),
  checkRegistration: () => checkRegistration(),
});
// Core messages are English; known ones have a Russian entry, the rest stay as written.
export const errorText = (error: unknown) => error instanceof Error ? t(error.message) : t('Could not complete the action. Try again.');
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
async function buildManager(profile: LocalProfile, signal?: AbortSignal, registration?: RegistrationCredentials, connectUrl?: string): Promise<MessengerClient> {
  const end = busyWith('connect');
  try { return await buildManagerNow(profile, signal, registration, connectUrl); } finally { end(); }
}
async function buildManagerNow(profile: LocalProfile, signal?: AbortSignal, registration?: RegistrationCredentials, connectUrl?: string): Promise<MessengerClient> {
  if (!state.identity) throw new Error(t('The device key is not loaded yet.'));
  const persistence = { ...await sealedStateAdapter(state.identity, profile.serverUrl), bulkFiles };
  // The account (and its local history) stays bound to profile.serverUrl; the connection goes to
  // the first server that answers, the Italian primary when it is reachable.
  const serverUrl = connectUrl ?? await chooseServer(profile.serverUrl);
  if (signal?.aborted) throw new Error('Wake expired');
  const current = ++generation;
  const next = new MessengerClient({ whenIdle: whenTransitionsIdle, reconcileDeliveryOnConnect: true, mailbox: true, callCaptions: Platform.OS === 'android' && Number(Platform.Version) >= 33 && !!NativeModules.LastCallCaptions, ...profile, serverUrl, onEndpoints: saveEndpoints, ...registration, identity: state.identity, ...nativeRtc, ...persistence,
    onChange: snapshot => {
      if (current !== generation) return;
      countUpdate();
      // Bursts of core changes (opening a chat marks it read, saves, sends receipts) reach React once per frame.
      // A timer, not requestAnimationFrame: frames stop in the background, where the connection
      // supervisor still has to see status changes; there it is published at once.
      latestSnapshot = snapshot;
      const flush = () => {
        clearTimeout(snapshotFrame); snapshotFrame = undefined;
        const latest = latestSnapshot; latestSnapshot = undefined;
        if (latest && current === generation) publish({ snapshot: latest, ...(isAccountMoved(latest.error) ? { retired: true } : {}) });
      };
      if (AppState.currentState !== 'active') flush();
      else if (!snapshotFrame) snapshotFrame = setTimeout(flush, 16);
      for (const observer of observers) { try { observer(snapshot, next); } catch { /* An optional native presenter cannot break delivery. */ } }
      if (snapshot.status === 'online' && snapshot.self) acceptCanonical(profile.serverUrl, snapshot.self);
    },
  });
  previewScopes.set(next, `${profile.serverUrl}:${state.identity.userId}`);
  publish({ snapshot: next.getSnapshot() });
  watchServer(next, current, profile, serverUrl);
  return next;
}
/**
 * Falls back to another server when this one stays unreachable in the foreground (never during a
 * call): from the primary to the account's own address after 20 s, and from there back to the
 * primary once it answers again, checked after a minute.
 */
function watchServer(manager: MessengerClient, current: number, profile: LocalProfile, serverUrl: string) {
  let offlineSince: number | undefined;
  let switching = false;
  const timer = setInterval(() => {
    if (current !== generation) { clearInterval(timer); return; }
    const snapshot = manager.getSnapshot();
    if (snapshot.status === 'online') { offlineSince = undefined; return; }
    offlineSince ??= Date.now();
    const onHome = serverUrl.toLowerCase() === profile.serverUrl.replace(/\/+$/, '').toLowerCase();
    if (switching || !shouldSwitch({ offlineMs: Date.now() - offlineSince, foreground: AppState.currentState === 'active', inCall: !!snapshot.activeCall, onHome, hasAlternatives: savedEndpoints().length > 0 })) return;
    switching = true;
    void chooseServer(profile.serverUrl, onHome ? undefined : serverUrl).then(async target => {
      if (current !== generation || target === serverUrl) { switching = false; offlineSince = Date.now(); return; }
      clearInterval(timer);
      const replacement = await managers.replace(() => buildManager(profile, undefined, undefined, target));
      await replacement.connect();
    }).catch(() => { switching = false; offlineSince = Date.now(); });
  }, 5000);
}
function installManager(profile: LocalProfile, registration?: RegistrationCredentials): Promise<MessengerClient> {
  return managers.replace(() => buildManager(profile, undefined, registration));
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
async function connectCanonical(profile: LocalProfile, registration?: RegistrationCredentials) {
  const current = await installManager(profile, registration);
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
    if (value !== 'active') { supervisor.stop(); return; }
    supervisor.resume();
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
/** Countries the phone reports, kept only while signing up and only if the server weighs them. */
let signupCountryHints: string[] | undefined;
/** What the server offers a new account: the email policy, Telegram sign-in and access requests. */
export async function checkSignupOptions() {
  const hints = await collectCountryHints().catch(() => []);
  const info = await fetchRegistrationPolicyInfo(emailServer(), hints);
  signupCountryHints = info.countryHints && hints.length ? hints : undefined;
  return { mode: info.mode, telegram: info.telegram === true, accessRequests: info.accessRequests === true };
}
export async function checkNewAccountPolicy() { return (await checkSignupOptions()).mode; }
/** A one-time link to our Telegram bot. register/recover before sign-in, bind for the signed-in account. */
export async function openTelegramSession(purpose: TelegramPurpose): Promise<TelegramSession> {
  if (!state.identity) throw new Error(t('The device key is not loaded yet.'));
  return startTelegram(purpose === 'bind' ? emailServer() : validateServerUrl(DEFAULT_SERVER), state.identity, purpose);
}
/**
 * Asks whether the bot has the number yet. A recovery moves the account here and connects; a
 * registration returns the proof for registerProfile; a link refreshes the phone state.
 */
export async function checkTelegramSession(purpose: TelegramPurpose, sessionId: string): Promise<TelegramCheck> {
  if (!state.identity) throw new Error(t('The device key is not loaded yet.'));
  const identity = state.identity;
  const serverUrl = purpose === 'bind' ? emailServer() : validateServerUrl(DEFAULT_SERVER);
  let result: TelegramCheck;
  try { result = await checkTelegram(serverUrl, identity, sessionId); }
  catch (cause) {
    if (purpose !== 'recover' || cause instanceof SignedRequestError) throw cause;
    // The move may have committed before the reply was lost.
    const user = await resolveDeviceProfile(serverUrl, identity).catch(() => null);
    if (!user) throw cause;
    result = { state: 'verified', user };
  }
  if (result.state !== 'verified') return result;
  if (purpose === 'recover') {
    if (!result.user) throw new Error(t('The server did not confirm the profile.'));
    publish({ busy: true, error: undefined });
    try {
      await connectResolved(serverUrl, result.user);
      if (state.profile) await profiles.remember(state.profile);
    } catch (error) { if (!state.profile) throw error; publish({ error: errorText(error) }); }
    finally { publish({ busy: false }); }
  }
  if (purpose === 'bind') void refreshPhoneState();
  return result;
}
export async function refreshPhoneState(): Promise<void> {
  try { publish({ phone: await client().phoneState() }); } catch { /* Shown again when the server answers. */ }
}
export async function setPhoneVisibility(visibility: PhoneVisibility): Promise<void> {
  publish({ phone: await client().setPhoneVisibility(visibility) });
}
/**
 * Waits for the directory connection (it reconnects after the app was in the background, e.g. behind a
 * permission dialog) instead of failing at once with "Directory is offline".
 */
async function onlineClient(ms = 15_000): Promise<MessengerClient> {
  const current = client();
  if (current.getSnapshot().status === 'online') return current;
  void reconnect();
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (manager?: MessengerClient) => {
      if (done) return; done = true; clearTimeout(timer); queueMicrotask(() => stop());
      if (manager) resolve(manager); else reject(new Error(t('Could not reach the server. Check your connection and try again.')));
    };
    const timer = setTimeout(() => finish(), ms);
    const stop = registerMessengerObserver((snapshot, manager) => { if (snapshot.status === 'online') finish(manager); });
  });
}
export async function findContactsByPhone(phones: string[]) { return (await onlineClient()).findByPhones(phones); }
export function listAccessRequests() { return client().accessRequests(); }
export function decideAccessRequest(id: string, approve: boolean) { return client().decideAccess(id, approve); }
/** People who cannot use Telegram ask the administrator; the answer comes back to this device. */
export async function sendAccessRequest(input: { name: string; contact?: string; message: string }): Promise<string> {
  if (!state.identity) throw new Error(t('The device key is not loaded yet.'));
  return requestAccess(validateServerUrl(DEFAULT_SERVER), state.identity, input);
}
export async function accessRequestState(): Promise<AccessState> {
  if (!state.identity) throw new Error(t('The device key is not loaded yet.'));
  return checkAccess(validateServerUrl(DEFAULT_SERVER), state.identity);
}
/** Null means another operation was already running. Refusals stay with the caller, which shows them in place. */
export async function requestEmailCode(purpose: EmailPurpose, email: string, inviteCode?: string): Promise<string | null> {
  if (state.busy) return null;
  if (!state.identity) throw new Error(t('The device key is not loaded yet.'));
  publish({ busy: true, error: undefined });
  try { return await startEmailChallenge(emailServer(), state.identity, { purpose, email, locale: emailLocale(), ...(purpose === 'register' && inviteCode ? { inviteCode } : {}), ...(purpose === 'register' && signupCountryHints ? { countryHints: signupCountryHints } : {}) }); }
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
export async function registerProfile(displayName: string, username: string, emailProof?: string, email?: string, inviteCode?: string, phoneProof?: string): Promise<void> {
  if (state.busy || state.profile || state.registration !== 'unregistered') return;
  const proposed = { displayName: displayName.trim(), username: username.trim().replace(/^@/, '').toLowerCase(), serverUrl: validateServerUrl(DEFAULT_SERVER) };
  if (!proposed.displayName || proposed.displayName.length > 48) throw new Error(t('The name must contain 1–48 characters.'));
  if (!/^[a-z0-9_]{3,24}$/.test(proposed.username)) throw new Error(t('Username: 3–24 Latin letters, digits or _.'));
  if (!state.identity) throw new Error(t('The device key is not loaded yet.'));
  const identity = state.identity;
  publish({ busy: true, error: undefined });
  try {
    const candidate = await registrationCandidate(proposed, () => resolveDeviceProfile(proposed.serverUrl, identity));
    await connectCanonical(candidate.profile, candidate.isNew ? { ...(phoneProof ? { phoneProof } : { emailProof, inviteCode }), ...(signupCountryHints ? { countryHints: signupCountryHints } : {}) } : undefined);
    if (!state.profile) throw new Error(t('The server did not confirm the profile.'));
    await profiles.remember(state.profile);
    if (candidate.isNew && email && emailProof) await rememberEmail(email, proposed.serverUrl);
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
export async function reconnect(): Promise<void> {
  if (state.retired) return;
  publish({ error: undefined });
  try {
    const current = managers.peek() ?? (state.profile ? await installManager(state.profile) : client());
    try { await current.connect(); }
    catch (error) {
      if (!/device-already-registered/.test(errorText(error)) || !state.identity || !state.profile) throw error;
      const bound = await resolveDeviceProfile(state.profile.serverUrl, state.identity);
      if (!bound) throw error;
      await connectResolved(state.profile.serverUrl, bound);
    }
    if (state.profile) await profiles.remember(state.profile);
  } catch (error) { publish({ error: errorText(error) }); }
}
