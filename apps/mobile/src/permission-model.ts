export type PermissionKind = 'contacts' | 'camera' | 'microphone' | 'photos';
export type Access = { status: 'unknown' | 'undetermined' | 'denied' | 'limited' | 'granted'; canAskAgain: boolean };
export const PERMISSION_ORDER: PermissionKind[] = ['contacts', 'camera', 'microphone', 'photos'];
export const UNKNOWN_ACCESS: Access = { status: 'unknown', canAskAgain: true };
export function normalizeAccess(value: { granted?: boolean; status?: string; canAskAgain?: boolean; accessPrivileges?: string }): Access {
  if (value.accessPrivileges === 'limited') return { status: 'limited', canAskAgain: value.canAskAgain ?? false };
  if (value.granted || value.status === 'granted') return { status: 'granted', canAskAgain: value.canAskAgain ?? true };
  return { status: value.status === 'denied' ? 'denied' : 'undetermined', canAskAgain: value.canAskAgain ?? true };
}
export const hasAccess = (value: Access) => value.status === 'granted' || value.status === 'limited';
export async function inSequence<T>(items: readonly PermissionKind[], operation: (kind: PermissionKind) => Promise<T>): Promise<{ kind: PermissionKind; result?: T; error?: unknown }[]> {
  const results: { kind: PermissionKind; result?: T; error?: unknown }[] = [];
  for (const kind of items) {
    try { results.push({ kind, result: await operation(kind) }); }
    catch (error) { results.push({ kind, error }); }
  }
  return results;
}
