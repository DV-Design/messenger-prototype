import { AppState } from 'react-native';
import { File } from 'expo-file-system';

/**
 * Decrypted image previews, kept only while the app is in the foreground so reopening a chat does
 * not decrypt every picture again. Leaving the foreground deletes them, and pruneMediaCache()
 * removes anything a killed process left behind (same `lastcall-preview-` prefix).
 */
const previews = new Map<string, string>();

export function cachedPreview(key: string): string | undefined {
  const uri = previews.get(key);
  if (!uri) return;
  try { if (new File(uri).exists) return uri; } catch { /* treated as missing */ }
  previews.delete(key);
}

export function rememberPreview(key: string, uri: string): void {
  if (AppState.currentState !== 'active') { forget(uri); return; }
  previews.set(key, uri);
}

function forget(uri: string) { try { const file = new File(uri); if (file.exists) file.delete(); } catch { /* best effort */ } }

AppState.addEventListener('change', state => {
  if (state === 'active') return;
  for (const uri of previews.values()) forget(uri);
  previews.clear();
});
