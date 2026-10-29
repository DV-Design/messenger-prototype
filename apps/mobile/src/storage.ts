import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { Directory, File, Paths } from 'expo-file-system';
import { createDeviceIdentity, validateDeviceIdentity, MAX_LOCAL_STATE_BYTES, MAX_SEALED_ATTACHMENT_BYTES, type DeviceIdentity } from '@messenger/core';

export const DEFAULT_SERVER = process.env.EXPO_PUBLIC_SIGNALING_URL ?? 'https://lienad.ru/messenger';
export type LocalProfile = { username: string; displayName: string; serverUrl: string };
const IDENTITY_KEY = 'messenger.device.v2';
const PROFILE_KEY = 'messenger.profile.v2';
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
      throw new Error('Не удалось прочитать ключ устройства. Данные не сброшены.');
    }
    // Verify the stored seed and identity agree instead of silently replacing it.
    const seed = Uint8Array.from(identity.privateKey.match(/../g)!, part => parseInt(part, 16));
    const verified = createDeviceIdentity(() => seed);
    if (verified.publicKey !== identity.publicKey || verified.userId !== identity.userId) {
      throw new Error('Проверка ключа устройства не пройдена. Данные не сброшены.');
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
    throw new Error('Не удалось прочитать профиль. Данные не сброшены.');
  }
  return profile;
}
export async function saveProfile(profile: LocalProfile): Promise<void> {
  await SecureStore.setItemAsync(PROFILE_KEY, JSON.stringify(profile), secretOptions);
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
    if (typeof key !== 'string' || !hex.test(key)) throw new Error('Некорректный ключ вложения.');
    return new File(attachments, `${key}${suffix}`);
  };
  return {
    loadState: async () => {
      if (!target.exists) return null;
      if (target.size > MAX_SEALED_BYTES) throw new Error('Локальное хранилище превышает допустимый размер.');
      return target.text();
    },
    saveState: (sealed: string) => {
      if (sealed.length > MAX_SEALED_BYTES) return Promise.reject(new Error('Локальное хранилище превышает допустимый размер.'));
      // Only sealed ciphertext supplied by core reaches the file adapter.
      // SecureStore is the only storage location for the device seed.
      return serialized(async () => {
        const temporary = new File(directory, `${identity.userId}-${serverHash}.next`);
        await temporary.write(sealed);
        await temporary.move(target, { overwrite: true });
      });
    },
    saveAttachment: (key: string, sealed: string) => {
      const destination = attachment(key);
      if (typeof sealed !== 'string' || sealed.length > MAX_SEALED_ATTACHMENT_BYTES) return Promise.reject(new Error('Зашифрованное вложение превышает допустимый размер.'));
      return serialized(async () => {
        const temporary = attachment(key, '.next');
        await temporary.write(sealed);
        await temporary.move(destination, { overwrite: true });
      });
    },
    loadAttachment: async (key: string): Promise<string | null> => {
      const source = attachment(key);
      await writes.catch(() => {});
      if (!source.exists) return null;
      if (source.size > MAX_SEALED_ATTACHMENT_BYTES) throw new Error('Зашифрованное вложение превышает допустимый размер.');
      const sealed = await source.text();
      if (sealed.length > MAX_SEALED_ATTACHMENT_BYTES) throw new Error('Зашифрованное вложение превышает допустимый размер.');
      return sealed;
    },
    deleteAttachment: (key: string) => {
      const source = attachment(key);
      return serialized(async () => {
        if (source.exists) source.delete();
        const temporary = attachment(key, '.next');
        if (temporary.exists) temporary.delete();
      });
    },
  };
}
