import * as TaskManager from 'expo-task-manager';
import * as Notifications from 'expo-notifications';
import { processMessagePreview, pushConfigured } from './notifications';
import { parseDeliveryNotice, parseWakeNotice, runWakeTask, WakeSyncCoordinator, type DeliveryNotice } from './wake-model';
import { showDeliveryProgress } from './delivery-progress';
import { acquireBackgroundManager, client } from './runtime';
import { retainWakeRuntime } from './system-calls';
import { processCallPush } from './call-pushes';
import { isCallPushPayload } from './call-push-model';

const TASK = 'lastcall-p2p-wake-v1';
const coordinator = new WakeSyncCoordinator(acquireBackgroundManager);
let registration: Promise<boolean> | undefined;

if (!TaskManager.isTaskDefined(TASK)) {
  TaskManager.defineTask<Notifications.NotificationTaskPayload>(TASK, async ({ data, error }) => {
    if (!pushConfigured || error) return;
    if (isCallPushPayload(data)) { await processCallPush(data); return; }
    const delivery = parseDeliveryNotice(data);
    if (delivery) { await runDelivery(delivery); return; }
    try { await runWakeTask(parseWakeNotice(data), notice => retainWakeRuntime(notice),
      notice => coordinator.run(notice, signal => processMessagePreview(data, client(), signal))); }
    catch { /* A failed durable drain must not crash the notification entry point. */ }
  });
}

/** The queue drains the moment the directory connects; the sender sees why the phone woke. */
async function runDelivery({ role, notice }: DeliveryNotice) {
  const hide = role === 'sender' ? await showDeliveryProgress() : undefined;
  try { await runWakeTask(notice, current => retainWakeRuntime(current), current => coordinator.run(current)); }
  catch { /* The queue stays on the phone; the next push or launch retries. */ }
  finally { await hide?.(); }
}

export function ensureBackgroundNotifications(): Promise<boolean> {
  if (!pushConfigured) return Promise.resolve(false);
  if (!registration) {
    registration = (async () => {
      if (!(await TaskManager.isAvailableAsync())) return false;
      await Notifications.registerTaskAsync(TASK);
      return true;
    })().catch(() => false).then(success => { if (!success) registration = undefined; return success; });
  }
  return registration;
}

// Register before Router mounts. Definition alone is not an advertised capability.
void ensureBackgroundNotifications();
