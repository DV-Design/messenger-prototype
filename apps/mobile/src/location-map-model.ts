import { parseLocationText } from './location-contact';
import { distanceMeters } from './live-location-model';

/**
 * What the full-screen chat map shows, like Telegram: everyone in the chat who is sharing a live
 * location now (one pin per person), the place that was tapped when it is a plain location, and
 * where the viewer is right now.
 */
export interface MapMessage { id: string; from: string; text: string; timestamp: number; editedAt?: number }
export interface MapPin {
  /** Unique on the map: the person for a live share or the viewer, `place:<messageId>` for a sent place. */
  key: string;
  kind: 'live' | 'place' | 'device';
  /** Who it belongs to: the sharer, the sender of the place, or the viewer. */
  ownerId: string;
  lat: number;
  lng: number;
  /** When the point was last updated (the message's last edit, or the phone's fix). */
  updatedAt: number;
  /** The place's own name, e.g. "Tverskaya Street, 7" (empty for live shares and the viewer). */
  label: string;
  messageId?: string;
  /** The viewer's own pin: their live share, or else their phone's position. */
  self: boolean;
}

/** The longest share is 8 h; a live card not edited for longer was left by a share that died. */
export const LIVE_STALE_MS = 8 * 60 * 60 * 1000;

/**
 * A person's newest live share wins. A tapped plain location is its own "place" pin, whoever sent it.
 * The viewer appears once: as their own live share if one runs in this chat, otherwise at the phone's
 * current position when it is known.
 */
export function mapPins(messages: readonly MapMessage[], focusId: string | undefined, ownId: string, device: { lat: number; lng: number; at: number } | undefined, now: number, unwrap: (text: string) => string = text => text): MapPin[] {
  const live = new Map<string, MapPin>();
  for (const message of messages) {
    const location = parseLocationText(unwrap(message.text));
    if (!location?.live) continue;
    const updatedAt = message.editedAt ?? message.timestamp;
    if (now - updatedAt > LIVE_STALE_MS) continue;
    const previous = live.get(message.from);
    if (previous && previous.updatedAt >= updatedAt) continue;
    live.set(message.from, { key: message.from, kind: 'live', ownerId: message.from, lat: location.lat, lng: location.lng, updatedAt, label: '', messageId: message.id, self: message.from === ownId });
  }
  const pins = [...live.values()];
  const focus = focusId ? messages.find(message => message.id === focusId) : undefined;
  const place = focus ? parseLocationText(unwrap(focus.text)) : undefined;
  // A tapped live card is already its sender's live pin (or a share that died: then show its last point).
  if (focus && place && !(place.live && live.get(focus.from)?.messageId === focus.id)) {
    pins.push({ key: `place:${focus.id}`, kind: 'place', ownerId: focus.from, lat: place.lat, lng: place.lng, updatedAt: focus.editedAt ?? focus.timestamp, label: place.live ? '' : place.label, messageId: focus.id, self: false });
  }
  if (device && !live.has(ownId)) pins.push({ key: ownId, kind: 'device', ownerId: ownId, lat: device.lat, lng: device.lng, updatedAt: device.at, label: '', self: true });
  // The tapped point first, then the viewer, then the others by most recent update.
  const rank = (pin: MapPin) => pin.messageId !== undefined && pin.messageId === focusId ? 0 : pin.self ? 1 : 2;
  return pins.sort((a, b) => rank(a) - rank(b) || b.updatedAt - a.updatedAt);
}

/** Meters from the viewer, or nothing when the viewer's position is unknown or it is the viewer's own pin. */
export function distanceFrom(self: MapPin | undefined, pin: MapPin): number | undefined {
  if (!self || pin.key === self.key) return undefined;
  return distanceMeters(self.lat, self.lng, pin.lat, pin.lng);
}
