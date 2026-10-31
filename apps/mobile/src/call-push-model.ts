import { callPushSchema, callPushEnvelopeSchema, type MessengerSnapshot, type PendingIncomingCall, type WakeIntent, type CallState } from '@messenger/core';
export type CallPush = { type: 'invitation'; envelope: string; intent: WakeIntent }
  | { type: 'state'; callId: string; callerId: string; calleeId: string; serverEpoch: string; issuedAt: number; expiresAt: number };
const object = (value: unknown): Record<string, unknown> | undefined => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
const utf8 = (value: string) => new TextEncoder().encode(value).length;
function candidates(payload: unknown) {
  const encoded = JSON.stringify(payload); if (!encoded || utf8(encoded) > 12_288) return [];
  const pending = [{ value: payload, depth: 0 }], seen = new Set<object>(), result: Record<string, unknown>[] = [];
  while (pending.length && seen.size < 32) {
    const { value, depth } = pending.shift()!, record = object(value);
    if (!record || seen.has(record) || depth > 6) continue;
    seen.add(record);
    if (record.kind === 'lastcall-call' || record.kind === 'lastcall-call-state') result.push(record);
    for (const key of ['notification', 'request', 'content', 'data']) if (object(record[key])) pending.push({ value: record[key], depth: depth + 1 });
    for (const key of ['dataString', 'body']) if (typeof record[key] === 'string' && utf8(record[key]) <= 4096) {
      try { pending.push({ value: JSON.parse(record[key]), depth: depth + 1 }); } catch { /* No unbounded or arbitrary traversal. */ }
    }
  }
  return result;
}
export function isCallPushPayload(payload: unknown): boolean { try { return candidates(payload).length > 0; } catch { return false; } }
const hex = (value: unknown, length: number): value is string => typeof value === 'string' && new RegExp(`^[a-f0-9]{${length}}$`).test(value);
const time = (value: unknown): number => typeof value === 'string' && /^[0-9]{10,16}$/.test(value) && Number.isSafeInteger(Number(value)) ? Number(value) : NaN;
/** Parse transport metadata only; a parsed invitation still needs pinned-key/authenticated server validation. */
export function parseCallPush(payload: unknown, now = Date.now()): CallPush | null {
  try {
    const records = candidates(payload); if (!records.length) return null;
    const parsed = records.map(raw => {
      if (utf8(JSON.stringify(raw)) > 4096) throw new Error('Oversized call data');
      // Expo Android RemoteMessageSerializer appends dataString=null when the FCM data has no "body".
      // Strip only that known transport null before strict key validation; never mutate the input.
      const { dataString, ...rest } = raw, data = dataString === null ? rest : raw;
      if (data.kind === 'lastcall-call') {
        if (Object.keys(data).length !== 5 || data.intentKind !== 'call' || !hex(data.intentId, 32) || typeof data.callInvite !== 'string') throw new Error('Invalid invitation');
        const expiresAt = time(data.expiresAt); if (expiresAt <= now || expiresAt > now + 35_000 || !Number.isFinite(expiresAt)) throw new Error('Expired invitation');
        const envelope = callPushSchema.parse(data.callInvite), header = callPushEnvelopeSchema.parse(JSON.parse(envelope));
        if (header.callId !== data.intentId || header.expiresAt !== expiresAt || header.issuedAt > now + 5000) throw new Error('Mismatched invitation');
        return { type: 'invitation' as const, envelope, intent: { kind: 'call' as const, intentId: data.intentId, expiresAt } };
      }
      const issuedAt = time(data.issuedAt), expiresAt = time(data.expiresAt);
      if (Object.keys(data).length !== 7 || !hex(data.callId, 32) || !hex(data.callerId, 64) || !hex(data.calleeId, 64) || data.callerId === data.calleeId || !hex(data.serverEpoch, 32)
        || !Number.isFinite(issuedAt) || !Number.isFinite(expiresAt) || expiresAt - issuedAt !== 30_000 || issuedAt > now + 5000 || expiresAt <= now) throw new Error('Invalid call-state hint');
      return { type: 'state' as const, callId: data.callId, callerId: data.callerId, calleeId: data.calleeId, serverEpoch: data.serverEpoch, issuedAt, expiresAt };
    });
    if (parsed.some(item => JSON.stringify(item) !== JSON.stringify(parsed[0]))) return null;
    return parsed[0]!;
  } catch { return null; }
}
export const callInviteCapability = (backgroundSync: boolean, nativePrepared: boolean): boolean => backgroundSync === true && nativePrepared === true;
export const callInviteNativeReady = (status: { supported: boolean; notifications: boolean; channel: boolean } | undefined): boolean =>
  status?.supported === true && status.notifications === true && status.channel === true;
interface CallPushManager {
  openCallPush(envelope: string, intent: WakeIntent, signal?: AbortSignal): Promise<PendingIncomingCall>;
  connect(): Promise<void>;
  getSnapshot(): MessengerSnapshot;
  refreshCallState(callId: string, otherId: string, serverEpoch: string): Promise<CallState>;
}
/** Terminal metadata is never an end command. Only the authenticated response may change core state. */
export async function applyCallPush(manager: CallPushManager, push: CallPush, signal: AbortSignal): Promise<void> {
  const expiresAt = push.type === 'invitation' ? push.intent.expiresAt : push.expiresAt;
  if (signal.aborted || expiresAt <= Date.now()) return;
  if (push.type === 'invitation') { await manager.openCallPush(push.envelope, push.intent, signal); return; }
  const matches = () => {
    const snapshot = manager.getSnapshot(), call = snapshot.activeCall, pending = snapshot.pendingIncomingCall;
    return call?.session.callId === push.callId && [push.callerId, push.calleeId].includes(call.peerId)
      && (!pending || (pending.callId === push.callId && pending.serverEpoch === push.serverEpoch && pending.callerId === push.callerId));
  };
  if (!matches()) return;
  await manager.connect();
  if (signal.aborted || expiresAt <= Date.now() || !matches()) return;
  const own = manager.getSnapshot().self?.userId;
  if (!own || (own !== push.callerId && own !== push.calleeId)) return;
  await manager.refreshCallState(push.callId, own === push.callerId ? push.calleeId : push.callerId, push.serverEpoch);
}
