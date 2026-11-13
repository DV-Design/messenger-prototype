/**
 * Location and contact "messages" are plain text messages with a recognizable shape, not a new
 * wire concept: older LastCall clients show them as ordinary text with a tappable Google Maps
 * link, newer clients parse the same text back into a rich card. No core/protocol change, no
 * stored-state version bump — the convention lives entirely in this file.
 */
const LOCATION_MARK = '📍';
const LIVE_MARK = '🔴';
const CONTACT_MARK = '👤';
const COORD = '-?\\d{1,3}(?:\\.\\d{1,8})?';
const LOCATION_RE = new RegExp(`^(${LOCATION_MARK}|${LIVE_MARK})[^\\n]*\\n.*https://maps\\.google\\.com/\\?q=(${COORD}),(${COORD})`, 's');
const PHONE_RE = /^[+\d][\d\s()-]{2,19}$/;

export interface ParsedLocation { lat: number; lng: number; live: boolean }
export interface ParsedContact { name: string; phones: string[] }

export function mapsUrl(lat: number, lng: number): string { return `https://maps.google.com/?q=${lat},${lng}`; }

/** `label` is already localized by the caller; this just assembles the recognizable, backward-compatible text. */
export function formatLocationText(label: string, lat: number, lng: number, live: boolean): string {
  return `${live ? LIVE_MARK : LOCATION_MARK} ${label}\n${mapsUrl(lat, lng)}`;
}

export function parseLocationText(text: string): ParsedLocation | undefined {
  const match = LOCATION_RE.exec(text);
  if (!match) return;
  const lat = Number(match[2]), lng = Number(match[3]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return;
  return { lat, lng, live: match[1] === LIVE_MARK };
}

export function formatContactText(name: string, phones: string[]): string {
  const clean = phones.map(phone => phone.trim()).filter(Boolean).slice(0, 5);
  if (!clean.length) throw new Error('A shared contact needs at least one phone number');
  return `${CONTACT_MARK} ${name.trim() || name}\n${clean.join('\n')}`;
}

export function parseContactText(text: string): ParsedContact | undefined {
  const lines = text.split('\n');
  const first = lines[0];
  if (lines.length < 2 || !first || !first.startsWith(`${CONTACT_MARK} `)) return;
  const name = first.slice(CONTACT_MARK.length + 1).trim();
  const phones = lines.slice(1).filter(line => PHONE_RE.test(line.trim())).map(line => line.trim());
  if (!name || !phones.length || phones.length !== lines.length - 1) return;
  return { name, phones };
}
