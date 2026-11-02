import { isIP } from 'node:net';

export function normalizeIp(value: string): string {
  const trimmed = value.trim().replace(/^\[|\]$/g, '');
  return trimmed.toLowerCase().startsWith('::ffff:') && isIP(trimmed.slice(7)) === 4 ? trimmed.slice(7) : trimmed;
}

function ipv4Number(value: string): bigint | undefined {
  const parts = value.split('.');
  if (parts.length !== 4) return;
  let result = 0n;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return;
    const byte = Number(part);
    if (byte > 255) return;
    result = (result << 8n) | BigInt(byte);
  }
  return result;
}

function ipv6Number(value: string): bigint | undefined {
  let text = normalizeIp(value).split('%')[0]!;
  if (text.includes('.')) {
    const lastColon = text.lastIndexOf(':');
    const ipv4 = text.slice(lastColon + 1);
    const number = ipv4Number(ipv4);
    if (number === undefined || lastColon < 0) return;
    text = `${text.slice(0, lastColon)}:${(number >> 16n).toString(16)}:${(number & 0xffffn).toString(16)}`;
  }
  if (!/^[0-9a-f:]+$/i.test(text)) return;
  const halves = text.split('::');
  if (halves.length > 2) return;
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const valid = (parts: string[]) => parts.every(part => /^[0-9a-f]{1,4}$/i.test(part));
  if (!valid(left) || !valid(right)) return;
  const missing = 8 - left.length - right.length;
  if (missing < 0 || (halves.length === 1 && missing !== 0)) return;
  const groups = [...left, ...Array.from({ length: missing }, () => '0'), ...right];
  if (groups.length !== 8) return;
  return groups.reduce((result, group) => (result << 16n) | BigInt(parseInt(group, 16)), 0n);
}

function parseAddress(value: string): { family: 4 | 6; value: bigint } | undefined {
  const normalized = normalizeIp(value);
  const family = isIP(normalized);
  if (family === 4) {
    const number = ipv4Number(normalized);
    return number === undefined ? undefined : { family: 4, value: number };
  }
  if (family === 6) {
    const number = ipv6Number(normalized);
    return number === undefined ? undefined : { family: 6, value: number };
  }
  return;
}

/** IPv4 and IPv6 CIDRs plus exact addresses are supported for proxy allowlists. */
export function ipInCidr(ip: string, cidr: string): boolean {
  const address = parseAddress(ip);
  if (!address) return false;
  const range = cidr.trim();
  if (!range.includes('/')) {
    const exact = parseAddress(range);
    return !!exact && exact.family === address.family && exact.value === address.value;
  }
  const [networkText, prefixText] = range.split('/');
  if (!networkText || prefixText === undefined) return false;
  const prefix = Number(prefixText);
  const network = parseAddress(networkText);
  const max = address.family === 4 ? 32 : 128;
  if (!network || network.family !== address.family || !Number.isInteger(prefix) || prefix < 0 || prefix > max) return false;
  const shift = BigInt(max - prefix);
  if (prefix === 0) return true;
  const mask = ((1n << BigInt(prefix)) - 1n) << shift;
  return (address.value & mask) === (network.value & mask);
}

/** IPv6 rate keys are aggregated to /64 so address rotation cannot bypass limits. */
export function rateKey(ip: string): string {
  const normalized = normalizeIp(ip);
  if (isIP(normalized) !== 6) return normalized;
  const number = ipv6Number(normalized);
  if (number === undefined) return normalized;
  return `${((number >> 64n) << 64n).toString(16)}/64`;
}

/**
 * Caddy appends the observed client address to X-Forwarded-For. Only trust the
 * header when the direct peer is a configured proxy, and walk from the right so
 * a spoofed client-supplied prefix cannot choose the rate-limit identity.
 */
export function clientIp(direct: string, forwarded: string | string[] | undefined, trustedProxyCidrs: string[]): string {
  const peer = normalizeIp(direct);
  if (!peer || !trustedProxyCidrs.some(cidr => ipInCidr(peer, cidr))) return peer || 'unknown';
  const header = Array.isArray(forwarded) ? forwarded.join(',') : forwarded;
  if (!header) return peer;
  const chain = header.split(',').map(normalizeIp).filter(value => isIP(value) !== 0);
  for (let index = chain.length - 1; index >= 0; index--) {
    const candidate = chain[index]!;
    if (!trustedProxyCidrs.some(cidr => ipInCidr(candidate, cidr))) return candidate;
  }
  return peer;
}
