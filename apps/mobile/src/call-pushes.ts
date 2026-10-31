import { acquireBackgroundManager, client } from './runtime';
import { retainWakeRuntime } from './system-calls';
import { runWakeTask, WakeSyncCoordinator } from './wake-model';
import { applyCallPush, parseCallPush } from './call-push-model';

// A call never waits behind a short data wake or an ended earlier call's remaining window.
const windows = new Map<string, { expiresAt: number; coordinator: WakeSyncCoordinator }>();
export async function processCallPush(payload: unknown): Promise<void> {
  const push = parseCallPush(payload); if (!push) return;
  const id = push.type === 'invitation' ? push.intent.intentId : push.callId;
  const expiresAt = push.type === 'invitation' ? push.intent.expiresAt : push.expiresAt;
  for (const [key, value] of windows) if (value.expiresAt <= Date.now()) windows.delete(key);
  const key = `${push.type}:${id}`;
  let window = windows.get(key);
  if (!window) {
    if (windows.size >= 16) return;
    window = { expiresAt, coordinator: new WakeSyncCoordinator(acquireBackgroundManager) }; windows.set(key, window);
  }
  const notice = { legacy: false as const, kind: 'call' as const, id, expiresAt };
  try {
    await runWakeTask(notice, value => retainWakeRuntime(value, push.type === 'invitation'),
      value => window!.coordinator.run(value, signal => applyCallPush(client(), push, signal)));
  } catch { /* Forged/stale/unknown/offline invitations never produce an unauthenticated ringing UI. */ }
}
