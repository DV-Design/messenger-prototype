import { AppState, Linking, PermissionsAndroid, Platform } from 'react-native';
import { addDenied, isPermissionError, type MediaPermission } from './permission-notice-model';

let denied: MediaPermission[] = [];
const listeners = new Set<() => void>();
const publish = (next: MediaPermission[]) => { denied = next; listeners.forEach(listener => listener()); };

export const deniedPermissions = () => denied;
export function onDeniedPermissions(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
export function reportDenied(...kinds: MediaPermission[]) { publish(addDenied(denied, kinds)); }
export function dismissDenied() { publish([]); }
export const openPermissionSettings = () => Linking.openSettings();

const ANDROID: Partial<Record<MediaPermission, string>> = {
  microphone: PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
  camera: PermissionsAndroid.PERMISSIONS.CAMERA,
  location: PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
};
async function granted(kind: MediaPermission) {
  const name = ANDROID[kind];
  if (Platform.OS !== 'android' || !name) return false;
  try { return await PermissionsAndroid.check(name as never); } catch { return false; }
}

/** After a refused getUserMedia: work out which access is missing and say so. */
export async function reportMediaFailure(constraints: { audio?: unknown; video?: unknown } | undefined, error: unknown): Promise<boolean> {
  if (!isPermissionError(error) && Platform.OS !== 'android') return false;
  const wanted: MediaPermission[] = [...(constraints?.audio ? ['microphone' as const] : []), ...(constraints?.video ? ['camera' as const] : [])];
  const missing: MediaPermission[] = [];
  for (const kind of wanted) if (!(await granted(kind))) missing.push(kind);
  if (missing.length) reportDenied(...missing);
  return missing.length > 0;
}

// Coming back from the phone settings: drop what is now allowed.
AppState.addEventListener('change', state => {
  if (state !== 'active' || !denied.length) return;
  void Promise.all(denied.map(async kind => (kind === 'photos' ? false : await granted(kind)) ? undefined : kind)).then(left => publish(left.filter((kind): kind is MediaPermission => !!kind)));
});
