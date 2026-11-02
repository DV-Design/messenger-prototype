import { describe, expect, it } from 'vitest';
import { clientIp, ipInCidr, normalizeIp, rateKey } from '../src/client-ip.js';

describe('trusted proxy client identity',()=>{
  const proxy='172.18.0.0/16';
  it('uses the socket address unless the direct peer is a configured proxy',()=>{
    expect(clientIp('203.0.113.9','198.51.100.4',[])).toBe('203.0.113.9');
    expect(clientIp('203.0.113.9','198.51.100.4',[proxy])).toBe('203.0.113.9');
    expect(clientIp('172.18.0.5','198.51.100.4',[proxy])).toBe('198.51.100.4');
  });
  it('walks X-Forwarded-For from the right so client-supplied prefixes cannot spoof the limit key',()=>{
    expect(clientIp('172.18.0.5','10.9.9.9, 198.51.100.4, 172.18.0.5',[proxy])).toBe('198.51.100.4');
    expect(clientIp('172.18.0.5','2001:db8::1, 172.18.0.5',[proxy])).toBe('2001:db8::1');
    expect(clientIp('172.18.0.5','not-an-ip, 198.51.100.7',[proxy])).toBe('198.51.100.7');
  });
  it('matches IPv4 CIDRs, normalizes mapped addresses and supports exact proxy addresses',()=>{
    expect(normalizeIp('::ffff:172.18.0.5')).toBe('172.18.0.5');
    expect(ipInCidr('172.18.255.254','172.18.0.0/16')).toBe(true);
    expect(ipInCidr('172.19.0.1','172.18.0.0/16')).toBe(false);
    expect(ipInCidr('10.0.0.1','10.0.0.1')).toBe(true);
    expect(ipInCidr('10.0.0.2','10.0.0.1')).toBe(false);
    expect(clientIp('::ffff:172.18.0.5','198.51.100.8',[proxy])).toBe('198.51.100.8');
  });
  it('falls back safely for malformed headers and empty proxy lists',()=>{
    expect(clientIp('172.18.0.5',undefined,[proxy])).toBe('172.18.0.5');
    expect(clientIp('172.18.0.5','',[proxy])).toBe('172.18.0.5');
    expect(clientIp('172.18.0.5','172.18.0.4',[proxy])).toBe('172.18.0.5');
  });
  it('matches IPv6 CIDRs and aggregates IPv6 rate keys to /64',()=>{
    expect(ipInCidr('2001:db8::1','2001:db8::/32')).toBe(true);
    expect(ipInCidr('2001:db9::1','2001:db8::/32')).toBe(false);
    expect(ipInCidr('2001:db8::1','2001:db8::1/128')).toBe(true);
    expect(ipInCidr('2001:db8::2','2001:db8::1/128')).toBe(false);
    expect(ipInCidr('2001:db8::1','::/0')).toBe(true);
    expect(ipInCidr('203.0.113.1','::/0')).toBe(false);
    expect(rateKey('2001:db8::1')).toBe(rateKey('2001:db8::ffff'));
    expect(rateKey('2001:db8::1')).not.toBe(rateKey('2001:db9::1'));
    expect(rateKey('203.0.113.1')).toBe('203.0.113.1');
  });
});
