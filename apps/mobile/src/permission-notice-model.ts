import { t } from './i18n';

/** Device access that a feature needed and the person refused. Shown once, with a way to the phone settings. */
export type MediaPermission = 'microphone' | 'camera' | 'photos';
const ORDER: MediaPermission[] = ['microphone', 'camera', 'photos'];

export function addDenied(current: readonly MediaPermission[], kinds: readonly MediaPermission[]): MediaPermission[] {
  return ORDER.filter(kind => current.includes(kind) || kinds.includes(kind));
}

export function deniedText(kinds: readonly MediaPermission[]): string {
  const names = kinds.map(kind => kind === 'microphone' ? t('the microphone') : kind === 'camera' ? t('the camera') : t('photos and videos'));
  const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} ${t('and')} ${names[names.length - 1]}` : names[0] ?? '';
  return t('LastCall has no access to {list}. Allow it in the phone settings: Permissions.', { list });
}

/** Access was refused and the permission notice already says so, with a way to the settings. */
export class AccessDenied extends Error {}

/** react-native-webrtc rejects with NotAllowedError (or a "permission" message) when Android access is refused. */
export function isPermissionError(error: unknown): boolean {
  const value = error as { name?: unknown; message?: unknown } | null;
  return !!value && (value.name === 'NotAllowedError' || value.name === 'SecurityError' || /permission|not allowed|denied/i.test(String(value.message ?? '')));
}
