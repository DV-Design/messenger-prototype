/**
 * Update metadata is a static JSON file next to the published APKs. It must
 * stay data-only: the official hosts are allowlisted and the download URL is
 * accepted only on the versioned release path.
 */
export const UPDATE_MANIFEST_URLS = [
  'https://p2p.lienad.ru/download/latest.json',
  'https://lienad.ru/messenger/download/latest.json',
] as const;

/** Public half of the offline manifest-signing key; private key never ships. */
export const UPDATE_SIGNING_PUBLIC_KEY = '9f75c929c0548afebe55e4ab4193f22245a81cd898aeb1d275e04b746059fe93';

const MAX_VERSION_LENGTH = 40;
const MAX_NOTES_LENGTH = 400;
const MAX_URL_LENGTH = 2048;
const MAX_VERSION_CODE = 2_100_000_000;
const VERSION_PATTERN = /^\d{1,6}\.\d{1,6}\.\d{1,6}(?:[-+][0-9A-Za-z.-]{1,32})?$/;

export interface AndroidUpdate {
  version: string;
  versionCode: number;
  url: string;
  alternateUrl?: string;
  sha256: string;
  notes?: string;
}

export interface UpdateManifest {
  android: AndroidUpdate;
  publishedAt?: string;
  /** Ed25519 signature of the canonical manifest fields; required by the app. */
  signature?: string;
}

function isOfficialHost(host: string, pathname: string) {
  if (host === 'p2p.lienad.ru') return pathname.startsWith('/download/');
  if (host === 'lienad.ru') return pathname.startsWith('/messenger/download/');
  return false;
}

/** Accepts only HTTPS APK downloads on the two official LastCall hosts. */
export function officialUpdateUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > MAX_URL_LENGTH) return;
  let url: URL;
  try { url = new URL(value.trim()); } catch { return; }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) return;
  if (url.port || !url.pathname.toLowerCase().endsWith('.apk')) return;
  if (!isOfficialHost(url.hostname.toLowerCase(), url.pathname)) return;
  return url.toString();
}

export function parseUpdateManifest(value: unknown): UpdateManifest | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  const root = value as Record<string, unknown>;
  if (!root.android || typeof root.android !== 'object' || Array.isArray(root.android)) return;
  const input = root.android as Record<string, unknown>;

  const version = typeof input.version === 'string' ? input.version.trim() : '';
  if (version.length > MAX_VERSION_LENGTH || !VERSION_PATTERN.test(version)) return;

  const versionCode = input.versionCode;
  if (typeof versionCode !== 'number' || !Number.isInteger(versionCode) || versionCode < 1 || versionCode > MAX_VERSION_CODE) return;

  const url = officialUpdateUrl(input.url);
  if (!url) return;
  const alternateUrl = input.alternateUrl === undefined ? undefined : officialUpdateUrl(input.alternateUrl);
  if (input.alternateUrl !== undefined && !alternateUrl) return;

  const sha256 = typeof input.sha256 === 'string' ? input.sha256.trim().toLowerCase() : '';
  if (!/^[a-f0-9]{64}$/.test(sha256)) return;

  let notes: string | undefined;
  if (input.notes !== undefined) {
    if (typeof input.notes !== 'string') return;
    notes = input.notes.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, MAX_NOTES_LENGTH) || undefined;
  }

  let publishedAt: string | undefined;
  if (root.publishedAt !== undefined) {
    if (typeof root.publishedAt !== 'string' || root.publishedAt.length > MAX_VERSION_LENGTH || !Number.isFinite(Date.parse(root.publishedAt))) return;
    publishedAt = root.publishedAt;
  }

  let signature: string | undefined;
  if (root.signature !== undefined) {
    if (typeof root.signature !== 'string' || !/^[0-9a-f]{128}$/i.test(root.signature)) return;
    signature = root.signature.toLowerCase();
  }

  return {
    android: { version, versionCode, url, ...(alternateUrl ? { alternateUrl } : {}), sha256, ...(notes ? { notes } : {}) },
    ...(publishedAt ? { publishedAt } : {}),
    ...(signature ? { signature } : {}),
  };
}

/** Android updates are ordered by versionCode; equal or older builds get no prompt. */
export function updateAvailable(currentVersionCode: number, manifest: UpdateManifest): AndroidUpdate | undefined {
  if (!Number.isInteger(currentVersionCode) || currentVersionCode < 1) return;
  return manifest.android.versionCode > currentVersionCode ? manifest.android : undefined;
}

export function updateDownloadUrls(update: AndroidUpdate): string[] {
  return [...new Set([update.url, update.alternateUrl].filter((url): url is string => !!url))];
}
