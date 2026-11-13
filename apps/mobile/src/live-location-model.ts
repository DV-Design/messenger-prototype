/** Pure state and decisions for live location sharing; the side-effecting manager lives in live-location.ts. */
export const LIVE_DURATIONS_MIN = [15, 60, 480] as const;
export type LiveDurationMin = typeof LIVE_DURATIONS_MIN[number];
const MIN_UPDATE_MS = 20000;
const MAX_SILENCE_MS = 60000;
const MIN_MOVE_METERS = 15;

export type LiveShareBar = { active: false } | { active: true; conversationId: string; until: number };
export interface LiveShareState { conversationId: string; messageId: string; until: number; lastSentAt: number; lastLat: number; lastLng: number }

/** Haversine distance in meters; accurate enough for a 15 m move threshold. */
export function distanceMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000, rad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = rad(lat2 - lat1), dLng = rad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Throttles edits: at most once every 20s, and only sooner than 60s if the point moved 15m+. */
export function shouldUpdateLiveLocation(last: { lastSentAt: number; lastLat: number; lastLng: number }, lat: number, lng: number, now: number): boolean {
  const elapsed = now - last.lastSentAt;
  if (elapsed < MIN_UPDATE_MS) return false;
  if (elapsed >= MAX_SILENCE_MS) return true;
  return distanceMeters(last.lastLat, last.lastLng, lat, lng) >= MIN_MOVE_METERS;
}

export function liveLocationExpired(until: number, now: number): boolean { return now >= until; }

export function untilFromDuration(minutes: LiveDurationMin, now: number): number { return now + minutes * 60000; }
