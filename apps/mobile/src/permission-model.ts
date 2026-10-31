export type PermissionKind = 'camera' | 'microphone' | 'photos' | 'notifications' | 'fullScreenCalls';
export type Access = { status: 'unknown' | 'undetermined' | 'denied' | 'limited' | 'granted' | 'unavailable'; canAskAgain: boolean };
export const RUNTIME_PERMISSION_ORDER: PermissionKind[] = ['microphone', 'camera', 'photos', 'notifications'];
export const PERMISSION_ORDER: PermissionKind[] = [...RUNTIME_PERMISSION_ORDER, 'fullScreenCalls'];
export const UNKNOWN_ACCESS: Access = { status: 'unknown', canAskAgain: true };
export function normalizeAccess(value: { granted?: boolean; status?: string; canAskAgain?: boolean; accessPrivileges?: string }): Access {
  if (value.accessPrivileges === 'limited') return { status: 'limited', canAskAgain: value.canAskAgain ?? false };
  if (value.granted || value.status === 'granted') return { status: 'granted', canAskAgain: value.canAskAgain ?? true };
  return { status: value.status === 'denied' ? 'denied' : 'undetermined', canAskAgain: value.canAskAgain ?? true };
}
export const hasAccess = (value: Access) => value.status === 'granted' || value.status === 'limited';
const attempted = (marker: string | null) => marker === 'done' || marker === 'attempted';
/** An upgrade never repeats the old four prompts; the new call access has its own one-shot marker. */
export function permissionSetupPlan(runtimeMarker: string | null, callMarker: string | null, fullScreen: Access): PermissionKind[] {
  return [...(!attempted(runtimeMarker) ? RUNTIME_PERMISSION_ORDER : []),
    ...(!attempted(callMarker) && !hasAccess(fullScreen) && fullScreen.status !== 'unavailable' ? ['fullScreenCalls' as const] : [])];
}
export function fullScreenCallAccess(platform: string, api: number, status?: { supported?: boolean; fullScreen?: boolean }): Access {
  if (platform !== 'android' || !Number.isFinite(api) || api < 24) return { status: 'unavailable', canAskAgain: false };
  if (api < 34) return { status: 'granted', canAskAgain: false };
  if (!status || status.supported === false) return { status: 'unavailable', canAskAgain: false };
  if (typeof status.fullScreen !== 'boolean') return { status: 'unknown', canAskAgain: false };
  return { status: status.fullScreen ? 'granted' : 'denied', canAskAgain: true };
}
interface SpecialAccessPort {
  read(): Promise<Access>;
  explain(): Promise<boolean>;
  open(): Promise<boolean>;
  subscribe(listener: (state: string) => void): () => void;
  schedule?(callback: () => void, milliseconds: number): () => void;
}
/** Opening settings is not a grant. Recheck only after a real leave/return; timeout keeps prior truth. */
export async function requestSpecialAccess(port: SpecialAccessPort): Promise<Access> {
  const before = await port.read();
  if (hasAccess(before) || !before.canAskAgain || !(await port.explain())) return before;
  return new Promise<Access>((resolve, reject) => {
    let completed = false, left = false;
    let unsubscribe = () => {}, cancelTimeout = () => {};
    const cleanup = () => { unsubscribe(); cancelTimeout(); };
    const finish = (recheck: boolean) => {
      if (completed) return;
      completed = true; cleanup();
      if (recheck) void port.read().then(resolve, reject); else resolve(before);
    };
    unsubscribe = port.subscribe(state => { if (state !== 'active') left = true; else if (left) finish(true); });
    const schedule = port.schedule ?? ((callback, milliseconds) => { const timer = setTimeout(callback, milliseconds); return () => clearTimeout(timer); });
    cancelTimeout = schedule(() => finish(false), 60_000);
    void port.open().then(opened => { if (!opened) finish(false); }, error => {
      if (!completed) { completed = true; cleanup(); reject(error); }
    });
  });
}
export async function inSequence<T>(items: readonly PermissionKind[], operation: (kind: PermissionKind) => Promise<T>): Promise<{ kind: PermissionKind; result?: T; error?: unknown }[]> {
  const results: { kind: PermissionKind; result?: T; error?: unknown }[] = [];
  for (const kind of items) {
    try { results.push({ kind, result: await operation(kind) }); }
    catch (error) { results.push({ kind, error }); }
  }
  return results;
}
