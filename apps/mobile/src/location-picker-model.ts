/** Pure helpers for the Telegram-style location picker; the screen lives in components/LocationPicker.tsx. */
export interface GeocodedAddress { name?: string | null; street?: string | null; streetNumber?: string | null; district?: string | null; city?: string | null; region?: string | null; country?: string | null }

/** "Тверская ул., 7" — what Telegram shows under the pin: street and house, else the most specific name. */
export function addressTitle(address: GeocodedAddress | undefined): string | undefined {
  if (!address) return;
  const street = address.street?.trim();
  if (street) return address.streetNumber?.trim() ? `${street}, ${address.streetNumber.trim()}` : street;
  // Android puts the house-level line in `name` when it has no street (often "7" or a building name).
  const name = address.name?.trim();
  if (name && !/^\d+[\p{L}]?$/u.test(name)) return name;
  return address.district?.trim() || address.city?.trim() || address.region?.trim() || undefined;
}

/** The line below the title: the wider area, never a repeat of the title. */
export function addressSubtitle(address: GeocodedAddress | undefined, title: string | undefined): string | undefined {
  if (!address) return;
  const parts = [address.district, address.city, address.country].map(part => part?.trim()).filter((part): part is string => !!part && part !== title);
  return [...new Set(parts)].join(', ') || undefined;
}

/** Same spot within a few metres: a selection survives the camera settling onto it. */
export function sameSpot(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }, meters = 6): boolean {
  const dLat = (a.latitude - b.latitude) * 111_320;
  const dLng = (a.longitude - b.longitude) * 111_320 * Math.cos((a.latitude * Math.PI) / 180);
  return Math.hypot(dLat, dLng) <= meters;
}

/** "accurate to 12 m" is only worth saying when the fix reports it. */
export function accuracyMeters(accuracy: number | null | undefined): number | undefined {
  return accuracy && Number.isFinite(accuracy) && accuracy > 0 ? Math.max(1, Math.round(accuracy)) : undefined;
}
