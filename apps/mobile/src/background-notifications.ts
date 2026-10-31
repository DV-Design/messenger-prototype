import * as TaskManager from 'expo-task-manager';
import * as Notifications from 'expo-notifications';
import { processMessagePreview, pushConfigured } from './notifications';
import { parseWakeNotice, runWakeTask, WakeSyncCoordinator } from './wake-model';
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
    try { await runWakeTask(parseWakeNotice(data), notice => retainWakeRuntime(notice),
      notice => coordinator.run(notice, signal => processMessagePreview(data, client(), signal))); }
    catch { /* A failed durable drain must not crash the notification entry point. */ }
  });
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
