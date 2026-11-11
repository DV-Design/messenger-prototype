import { t } from './i18n';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { Directory, File, Paths } from 'expo-file-system';
import { createDeviceIdentity, validateDeviceIdentity, MAX_LOCAL_STATE_BYTES, MAX_SEALED_ATTACHMENT_BYTES, type DeviceIdentity } from '@messenger/core';
import type { BoundEmail } from './email-flow-model';
import { hasDiskRoom, packSealed, packedSize, unpackSealed } from './attachment-file-model';

export const DEFAULT_SERVER = process.env.EXPO_PUBLIC_SIGNALING_URL ?? 'https://p2p.lienad.ru';
export type LocalProfile = { username: string; displayName: string; serverUrl: string };
const IDENTITY_KEY = 'messenger.device.v2';
const PROFILE_KEY = 'messenger.profile.v2';
const EMAIL_KEY = 'messenger.email.v1';
const EMAIL_REMINDER_KEY = 'messenger.email-reminder.v1';
const secretOptions = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
const hex = /^[0-9a-f]{64}$/;
const MAX_SEALED_BYTES = MAX_LOCAL_STATE_BYTES * 2 + 1024;

export async function loadIdentity(): Promise<DeviceIdentity> {
  const saved = await loadExistingIdentity();
  if (saved) return saved;
  const identity = createDeviceIdentity(length => Crypto.getRandomBytes(length));
  await SecureStore.setItemAsync(IDENTITY_KEY, JSON.stringify(identity), secretOptions);
  return identity;
}
/** Background wake may read a bound key, but never creates/registers a new user. */
export async function loadExistingIdentity(): Promise<DeviceIdentity | null> {
  const saved = await SecureStore.getItemAsync(IDENTITY_KEY);
  if (saved) {
    const identity = JSON.parse(saved) as DeviceIdentity;
    if (!hex.test(identity.privateKey) || !hex.test(identity.publicKey) || !hex.test(identity.userId)) {
      throw new Error(t('Could not read the device key. Data was not reset.'));
    }
    // Verify the stored seed and identity agree instead of silently replacing it.
    const seed = Uint8Array.from(identity.privateKey.match(/../g)!, part => parseInt(part, 16));
    const verified = createDeviceIdentity(() => seed);
    if (verified.publicKey !== identity.publicKey || verified.userId !== identity.userId) {
      throw new Error(t('Device key verification failed. Data was not reset.'));
    }
    return verified;
  }
  return null;
}
export async function loadProfile(): Promise<LocalProfile | null> {
  const raw = await SecureStore.getItemAsync(PROFILE_KEY);
  if (!raw) return null;
  const profile = JSON.parse(raw) as LocalProfile;
  if (!/^[a-z0-9_]{3,24}$/.test(profile.username) || typeof profile.displayName !== 'string'
    || !profile.displayName.trim() || profile.displayName.length > 48 || typeof profile.serverUrl !== 'string') {
    throw new Error(t('Could not read the profile. Data was not reset.'));
  }
  return profile;
}
export async function saveProfile(profile: LocalProfile): Promise<void> {
  await SecureStore.setItemAsync(PROFILE_KEY, JSON.stringify(profile), secretOptions);
}

export async function deleteLocalAccount(): Promise<void> {
  try {
    const directory = new Directory(Paths.document, 'messenger-v2');
    if (directory.exists) directory.delete();
  } catch { /* Local files are best-effort after the server account is gone. */ }
  await SecureStore.deleteItemAsync(IDENTITY_KEY);
  await SecureStore.deleteItemAsync(PROFILE_KEY);
  await SecureStore.deleteItemAsync(EMAIL_KEY);
  await SecureStore.deleteItemAsync(EMAIL_REMINDER_KEY);
}
/** The server keeps only a keyed hash, so this is the one readable copy of the address. */
export async function loadBoundEmail(): Promise<BoundEmail | null> {
  const raw = await SecureStore.getItemAsync(EMAIL_KEY);
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as BoundEmail;
    return typeof value.email === 'string' && typeof value.serverUrl === 'string' ? { email: value.email, serverUrl: value.serverUrl } : null;
  } catch { return null; }
}
export async function saveBoundEmail(value: BoundEmail): Promise<void> {
  await SecureStore.setItemAsync(EMAIL_KEY, JSON.stringify(value), secretOptions);
}
export async function loadEmailReminderDismissed(): Promise<boolean> {
  return await SecureStore.getItemAsync(EMAIL_REMINDER_KEY) === 'dismissed';
}
export async function saveEmailReminderDismissed(): Promise<void> {
  await SecureStore.setItemAsync(EMAIL_REMINDER_KEY, 'dismissed', secretOptions);
}
export async function sealedStateAdapter(identity: DeviceIdentity, serverUrl: string) {
  validateDeviceIdentity(identity);
  const serverHash = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, serverUrl);
  const directory = new Directory(Paths.document, 'messenger-v2');
  directory.create({ intermediates: true, idempotent: true });
  const target = new File(directory, `${identity.userId}-${serverHash}.sealed`);
  const attachments = new Directory(directory, `${identity.userId}-${serverHash}-attachments`);
  attachments.create({ intermediates: true, idempotent: true });
  let writes = Promise.resolve();
  const serialized = (operation: () => Promise<void>) => {
    const next = writes.catch(() => {}).then(operation);
    writes = next;
    return next;
  };
  const attachment = (key: string, suffix = '.sealed') => {
    if (typeof key !== 'string' || !hex.test(key)) throw new Error(t('Invalid attachment key.'));
    return new File(attachments, `${key}${suffix}`);
  };
  return {
    loadState: async () => {
      if (!target.exists) return null;
      if (target.size > MAX_SEALED_BYTES) throw new Error(t('Local storage exceeds the allowed size.'));
      return target.text();
    },
    saveState: (sealed: string) => {
      if (sealed.length > MAX_SEALED_BYTES) return Promise.reject(new Error(t('Local storage exceeds the allowed size.')));
      // Only sealed ciphertext supplied by core reaches the file adapter.
      // SecureStore is the only storage location for the device seed.
      return serialized(async () => {
        const temporary = new File(directory, `${identity.userId}-${serverHash}.next`);
        await temporary.write(sealed);
        await temporary.move(target, { overwrite: true });
      });
    },
    saveAttachment: (key: string, sealed: string) => {
      if (typeof sealed !== 'string' || sealed.length > MAX_SEALED_ATTACHMENT_BYTES) return Promise.reject(new Error(t('Encrypted attachment exceeds the allowed size.')));
      if (!hasDiskRoom(Paths.availableDiskSpace, packedSize(sealed.length))) return Promise.reject(new Error(t('Not enough free space on the phone. Free some space and try again.')));
      const packed = packSealed(sealed);
      return serialized(async () => {
        const temporary = attachment(key, '.next');
        const destination = attachment(key, packed ? '.bin' : '.sealed');
        await temporary.write(packed ?? sealed);
        await temporary.move(destination, { overwrite: true });
        // One copy per key: drop the other format if an older write left it.
        const other = attachment(key, packed ? '.sealed' : '.bin');
        if (other.exists) other.delete();
      });
    },
    loadAttachment: async (key: string): Promise<string | null> => {
      await writes.catch(() => {});
      const binary = attachment(key, '.bin');
      if (binary.exists) {
        if (binary.size > MAX_SEALED_ATTACHMENT_BYTES / 2 + 64) throw new Error(t('Encrypted attachment exceeds the allowed size.'));
        return unpackSealed(await binary.bytes());
      }
      const source = attachment(key);
      if (!source.exists) return null;
      if (source.size > MAX_SEALED_ATTACHMENT_BYTES) throw new Error(t('Encrypted attachment exceeds the allowed size.'));
      const sealed = await source.text();
      if (sealed.length > MAX_SEALED_ATTACHMENT_BYTES) throw new Error(t('Encrypted attachment exceeds the allowed size.'));
      return sealed;
    },
    deleteAttachment: (key: string) => {
      const source = attachment(key);
      return serialized(async () => {
        if (source.exists) source.delete();
        const binary = attachment(key, '.bin');
        if (binary.exists) binary.delete();
        const temporary = attachment(key, '.next');
        if (temporary.exists) temporary.delete();
      });
    },
  };
}
