import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { client } from './runtime';
import { t } from './i18n';
import { time } from './components/ui';
import { formatLocationText } from './location-contact';
import { liveLocationExpired, shouldUpdateLiveLocation, untilFromDuration, type LiveDurationMin, type LiveShareBar, type LiveShareState } from './live-location-model';
import { reportDenied } from './permission-notice';
import { AccessDenied } from './permission-notice-model';

const TASK_NAME = 'lastcall-live-location';

let share: LiveShareState | undefined;
const listeners = new Set<() => void>();
const publish = () => listeners.forEach(listener => listener());
export function subscribeLiveShare(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
// useSyncExternalStore needs a referentially stable snapshot while nothing changed, or it
// re-renders forever; cache it and only build a new object when `share` itself changes.
let cachedSource: LiveShareState | undefined;
let cachedBar: LiveShareBar = { active: false };
export function liveShareSnapshot(): LiveShareBar {
  if (share !== cachedSource) { cachedSource = share; cachedBar = share ? { active: true, conversationId: share.conversationId, until: share.until } : { active: false }; }
  return cachedBar;
}
export const isSharingLiveLocation = (conversationId: string) => share?.conversationId === conversationId;

// The task must be defined unconditionally at module load — Android looks it up by name when
// the foreground service wakes the process, not only while a share is actually running.
TaskManager.defineTask(TASK_NAME, async ({ data, error }) => {
  if (error || !share) return;
  const locations = (data as { locations?: { coords: { latitude: number; longitude: number } }[] } | undefined)?.locations;
  const point = locations?.[locations.length - 1]?.coords;
  if (!point) return;
  await onLocationUpdate(point.latitude, point.longitude);
});

async function onLocationUpdate(lat: number, lng: number) {
  if (!share) return;
  const now = Date.now();
  if (liveLocationExpired(share.until, now)) { await stopLiveLocation(); return; }
  if (!shouldUpdateLiveLocation(share, lat, lng, now)) return;
  const current = share;
  current.lastSentAt = now; current.lastLat = lat; current.lastLng = lng;
  try { await client().editMessage(current.conversationId, current.messageId, formatLocationText(t('Live location · until {time}', { time: time(current.until) }), lat, lng, true)); }
  catch { /* A dropped connection or a stale conversation keeps the last-known point; the next update retries. */ }
}

/** Only one live share runs at a time, in any chat; starting a new one stops the previous. */
export async function startLiveLocation(conversationId: string, ownId: string, lat: number, lng: number, minutes: LiveDurationMin): Promise<void> {
  if (share) await stopLiveLocation();
  const permission = await Location.requestForegroundPermissionsAsync();
  if (!permission.granted) { reportDenied('location'); throw new AccessDenied(t('Allow location access in the phone settings.')); }
  const now = Date.now();
  const until = untilFromDuration(minutes, now);
  const text = formatLocationText(t('Live location · until {time}', { time: time(until) }), lat, lng, true);
  const current = client();
  await current.sendText(conversationId, text);
  // sendText resolves only after the message is durably pushed; among same-text own messages
  // (practically always exactly one) the most recent timestamp is the one just sent.
  const candidates = current.getSnapshot().conversations.find(c => c.id === conversationId)?.messages.filter(m => m.from === ownId && m.text === text) ?? [];
  const sent = candidates.reduce<typeof candidates[number] | undefined>((latest, m) => !latest || m.timestamp > latest.timestamp ? m : latest, undefined);
  if (!sent) throw new Error(t('The message could not be found after sending.'));
  share = { conversationId, messageId: sent.id, until, lastSentAt: now, lastLat: lat, lastLng: lng };
  publish();
  try {
    await Location.startLocationUpdatesAsync(TASK_NAME, {
      accuracy: Location.Accuracy.Balanced, timeInterval: 20000, distanceInterval: 15,
      foregroundService: { notificationTitle: 'LastCall', notificationBody: t('Sharing your location until {time}', { time: time(until) }) },
    });
  } catch (cause) { share = undefined; publish(); throw cause; }
}

export async function stopLiveLocation(): Promise<void> {
  const current = share;
  if (!current) return;
  share = undefined; publish();
  try { if (await TaskManager.isTaskRegisteredAsync(TASK_NAME)) await Location.stopLocationUpdatesAsync(TASK_NAME); } catch { /* best effort */ }
  try { await client().editMessage(current.conversationId, current.messageId, formatLocationText(t('Location (sharing ended)'), current.lastLat, current.lastLng, false)); }
  catch { /* The chat may have been deleted or the message expired; nothing left to update. */ }
}
