import * as TaskManager from 'expo-task-manager';
import * as Notifications from 'expo-notifications';
import { pushConfigured } from './notifications';
import { parseWakeNotice, WakeSyncCoordinator } from './wake-model';
import { acquireBackgroundManager } from './runtime';

const TASK = 'lastcall-p2p-wake-v1';
const coordinator = new WakeSyncCoordinator(acquireBackgroundManager);
let registration: Promise<boolean> | undefined;

if (!TaskManager.isTaskDefined(TASK)) {
  TaskManager.defineTask<Notifications.NotificationTaskPayload>(TASK, async ({ data, error }) => {
    if (!pushConfigured || error) return;
    try { await coordinator.run(parseWakeNotice(data)); }
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
