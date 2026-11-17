import { readFileSync } from 'node:fs';
import { Reader, type CountryResponse } from 'maxmind';

/**
 * The official DB-IP Lite MMDB uses `country.iso_code`. Some compatible country
 * databases expose a root-level `country_code` instead.
 */
interface RegistrationCountryRecord extends CountryResponse {
  readonly country_code?: string;
}

function isoCountry(value: string | undefined): string | undefined {
  const country = value?.trim().toUpperCase();
  return country && /^[A-Z]{2}$/.test(country) && country !== 'XX' && country !== 'ZZ' ? country : undefined;
}

/**
 * Loads a local MMDB country database and returns a synchronous,
 * local-only lookup. There are no network calls and no IP addresses are stored.
 *
 * Unknown, private, reserved, malformed, or unparseable addresses return
 * `undefined`; the registration policy treats that as restricted (invite).
 * `registered_country` is deliberately ignored because it describes the
 * address registry rather than where the connection is observed from.
 *
 * The reader is created at startup on purpose. In market mode a missing or
 * corrupt database must fail the process instead of silently making every
 * registration invite-only. The error never includes the resolved file path.
 */
export function createRegistrationCountryLookup(databasePath: string): (ip: string) => string | undefined {
  let reader: Reader<RegistrationCountryRecord>;
  try {
    reader = new Reader<RegistrationCountryRecord>(readFileSync(databasePath));
  } catch {
    throw new Error('Registration country database is unavailable');
  }
  return (ip: string): string | undefined => {
    try {
      const record = reader.get(ip);
      return isoCountry(record?.country?.iso_code ?? record?.country_code);
    } catch {
      return undefined;
    }
  };
}
