import { useSyncExternalStore } from 'react';
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { File, Paths } from 'expo-file-system';
import * as IntentLauncher from 'expo-intent-launcher';
import { verifyUpdateSignature } from '@messenger/core';
import {
  parseUpdateManifest,
  updateAvailable,
  updateDownloadUrls,
  UPDATE_MANIFEST_URLS,
  UPDATE_SIGNING_PUBLIC_KEY,
  type AndroidUpdate,
  type UpdateManifest,
} from './update-model';

const CHECK_INTERVAL = 6 * 60 * 60 * 1000;
const FETCH_TIMEOUT = 8_000;
const MAX_MANIFEST_LENGTH = 16 * 1024;

export interface UpdateState {
  status: 'idle' | 'checking' | 'current' | 'available' | 'error';
  currentVersion: string;
  currentVersionCode: number;
  update?: AndroidUpdate;
  error?: string;
  dismissedVersionCode?: number;
}

const currentVersionCode = (() => {
  const value = Number(Constants.expoConfig?.android?.versionCode);
  return Number.isInteger(value) && value > 0 ? value : 0;
})();
const currentVersion = Constants.expoConfig?.version ?? '';

let state: UpdateState = { status: 'idle', currentVersion, currentVersionCode };
const listeners = new Set<() => void>();
let pending: Promise<void> | undefined;
let lastCheckAt = 0;

function publish(next: UpdateState) {
  state = next;
  listeners.forEach(listener => listener());
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};
const getState = () => state;

export const useUpdateState = () => useSyncExternalStore(subscribe, getState);

async function fetchManifest(url: string): Promise<UpdateManifest> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
  try {
    const response = await fetch(url, { signal: controller.signal, cache: 'no-store', headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error('Update manifest request failed.');
    const text = await response.text();
    if (text.length > MAX_MANIFEST_LENGTH) throw new Error('Update manifest is too large.');
    const manifest = parseUpdateManifest(JSON.parse(text));
    if (!manifest) throw new Error('Update manifest is invalid.');
    if (!manifest.signature || !verifyUpdateSignature(UPDATE_SIGNING_PUBLIC_KEY, { ...manifest.android, publishedAt: manifest.publishedAt }, manifest.signature)) throw new Error('Update manifest signature is invalid.');
    return manifest;
  } finally {
    clearTimeout(timer);
  }
}

async function loadManifest(): Promise<UpdateManifest> {
  let failure: unknown;
  for (const url of UPDATE_MANIFEST_URLS) {
    try { return await fetchManifest(url); } catch (cause) { failure = cause; }
  }
  throw failure instanceof Error ? failure : new Error('Update manifest is unavailable.');
}

export function checkForUpdate(manual = false): Promise<void> {
  if (pending) return pending;
  if (Platform.OS !== 'android') return Promise.resolve();
  if (currentVersionCode < 1) {
    if (manual) publish({ ...state, status: 'error', error: 'Не удалось определить версию установленного приложения.' });
    return Promise.resolve();
  }
  const previousStatus = state.status;
  publish({ ...state, status: 'checking', error: undefined });
  pending = (async () => {
    try {
      const manifest = await loadManifest();
      const update = updateAvailable(currentVersionCode, manifest);
      lastCheckAt = Date.now();
      publish(update
        ? { ...state, status: 'available', update, error: undefined }
        : { ...state, status: 'current', update: undefined, error: undefined });
    } catch {
      lastCheckAt = Date.now();
      const fallback = state.update ? 'available' : previousStatus === 'current' ? 'current' : 'idle';
      publish(manual
        ? { ...state, status: 'error', error: 'Не удалось проверить обновления. Проверьте соединение.' }
        : { ...state, status: fallback, error: undefined });
    } finally {
      pending = undefined;
    }
  })();
  return pending;
}

/** One lightweight static-manifest request per launch, then at most every 6 hours. */
export function maybeAutoCheck(): Promise<void> {
  if (Platform.OS !== 'android' || currentVersionCode < 1) return Promise.resolve();
  if (Date.now() - lastCheckAt < CHECK_INTERVAL) return Promise.resolve();
  if (state.status === 'checking' || state.status === 'available') return Promise.resolve();
  return checkForUpdate(false);
}

export function dismissUpdate(): void {
  if (!state.update) return;
  publish({ ...state, dismissedVersionCode: state.update.versionCode });
}

/**
 * Downloads the official APK, verifies the manifest SHA-256 and hands the
 * verified file to Android's package installer. Installation still requires
 * the user's confirmation; nothing is silent.
 */
export async function downloadAndInstallUpdate(update: AndroidUpdate): Promise<void> {
  if (Platform.OS !== 'android') throw new Error('Установка обновлений доступна только на Android.');
  const file = new File(Paths.cache, `LastCall-${update.version}.apk`);
  let verified = false;
  let failure: unknown;
  for (const url of updateDownloadUrls(update)) {
    try {
      const downloaded = await File.downloadFileAsync(url, file, { idempotent: true });
      const digest = (await downloaded.digest('SHA-256')).toLowerCase();
      if (digest !== update.sha256) throw new Error('SHA-256 обновления не совпадает.');
      verified = true;
      break;
    } catch (cause) {
      failure = cause;
      try { if (file.exists) file.delete(); } catch { /* A stale cache file is not an install source. */ }
    }
  }
  if (!verified) throw failure instanceof Error ? failure : new Error('Не удалось скачать обновление.');
  if (!file.contentUri) throw new Error('Не удалось открыть установщик Android.');
  try {
    await IntentLauncher.startActivityAsync('android.intent.action.INSTALL_PACKAGE', {
      data: file.contentUri,
      type: 'application/vnd.android.package-archive',
      flags: 1,
    });
  } catch {
    await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
      data: file.contentUri,
      type: 'application/vnd.android.package-archive',
      flags: 1,
    });
  }
}
