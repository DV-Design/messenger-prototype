import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRegistrationCountryLookup } from '../src/registration-geoip.js';

const mock = vi.hoisted(() => ({ read: vi.fn(), get: vi.fn(), open: vi.fn() }));
vi.mock('node:fs', () => ({ readFileSync: mock.read }));
vi.mock('maxmind', () => ({
  Reader: class {
    constructor(buffer: Buffer) { mock.open(buffer); }
    get = mock.get;
  },
}));

const database = '/fixture/country.mmdb';

describe('registration country lookup', () => {
  beforeEach(() => { vi.resetAllMocks(); });

  it('opens the configured file and reads the country from a local MMDB record', () => {
    const data = Buffer.from('fixture');
    mock.read.mockReturnValue(data);
    mock.get.mockReturnValue({ country: { iso_code: 'RU' }, registered_country: { iso_code: 'US' } });
    const lookup = createRegistrationCountryLookup(database);

    expect(mock.read).toHaveBeenCalledExactlyOnceWith(database);
    expect(mock.open).toHaveBeenCalledExactlyOnceWith(data);
    expect(lookup('77.88.8.8')).toBe('RU');
    expect(mock.get).toHaveBeenCalledExactlyOnceWith('77.88.8.8');
  });

  it('normalizes a compatible country record and skips registry-only and unknown records', () => {
    mock.get.mockReturnValueOnce({ country_code: ' ca ' })
      .mockReturnValueOnce({ registered_country: { iso_code: 'US' } })
      .mockReturnValueOnce({ country: { iso_code: 'ZZ' } })
      .mockReturnValueOnce({ country_code: 'XX' })
      .mockReturnValueOnce(null)
      .mockImplementationOnce(() => { throw new Error('invalid input'); });
    const lookup = createRegistrationCountryLookup(database);

    expect(lookup('2001:4860:4860::8888')).toBe('CA');
    for (const ip of ['192.0.2.1', '203.0.113.9', '10.0.0.1', 'fe80::1', 'not-an-ip']) {
      expect(lookup(ip)).toBeUndefined();
    }
  });

  it('refuses to start on missing or corrupt data without exposing the path', () => {
    mock.read.mockImplementationOnce(() => { throw new Error(`Could not read ${database}`); });
    expect(() => createRegistrationCountryLookup(database)).toThrow(/^Registration country database is unavailable$/);

    mock.open.mockImplementationOnce(() => { throw new Error('Could not decode file'); });
    expect(() => createRegistrationCountryLookup(database)).toThrow(/^Registration country database is unavailable$/);
  });
});
