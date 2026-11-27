import { ed25519 } from '@noble/curves/ed25519.js';
import { parsePhoneNumberWithError } from 'libphonenumber-js/min';
import { bytesToHex, hexToBytes } from './crypto.js';
import { peerIdSchema, roomIdSchema } from './protocol.js';
import { accessContactSchema, accessMessageSchema, accessNameSchema, directoryClientFrameSchema, directoryServerFrameSchema, endpointUrl, telegramPurposeSchema, userIdFromPublicKey, validateDeviceIdentity, type DeviceIdentity, type DirectoryClientFrame, type DirectoryServerFrame, type DirectoryUser, type TelegramPurpose } from './directory.js';

const utf8 = (value: string) => new TextEncoder().encode(value);
const signed = /^[0-9a-f]{128}$/;

/**
 * Requests made before an account exists (sign-up through Telegram, asking the administrator for
 * access) are signed by the device key over the server's one-time challenge, the request type and
 * its fields, so none can stand in for another or for authentication.
 */
export type SignedRequestType = 'telegram-start' | 'telegram-check' | 'access-request' | 'access-check';
export function signedRequestPayload(challenge: string, publicKey: string, type: SignedRequestType, fields: readonly string[]): Uint8Array {
  roomIdSchema.parse(challenge); userIdFromPublicKey(publicKey);
  return utf8(JSON.stringify(['lastcall/signed-request/v1', challenge, publicKey, type, ...fields]));
}
export function signRequest(identity: DeviceIdentity, challenge: string, type: SignedRequestType, fields: readonly string[]): string {
  validateDeviceIdentity(identity);
  return bytesToHex(ed25519.sign(signedRequestPayload(challenge, identity.publicKey, type, fields), hexToBytes(identity.privateKey)));
}
export function verifyRequest(publicKey: string, challenge: string, type: SignedRequestType, fields: readonly string[], signature: string): boolean {
  try { if (!signed.test(signature)) return false; return ed25519.verify(hexToBytes(signature), signedRequestPayload(challenge, publicKey, type, fields), hexToBytes(publicKey), { zip215: false }); } catch { return false; }
}
/** The signed fields of each request, in a fixed order, the same on both sides. */
export function signedRequestFields(frame: { type: SignedRequestType; purpose?: string; sessionId?: string; name?: string; contact?: string; message?: string }): string[] {
  if (frame.type === 'telegram-start') return [frame.purpose ?? ''];
  if (frame.type === 'telegram-check') return [frame.sessionId ?? ''];
  if (frame.type === 'access-request') return [frame.name ?? '', frame.contact ?? '', frame.message ?? ''];
  return [];
}

/** A refusal the server gave for this request; anything else is a network or protocol failure. */
export class SignedRequestError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = 'SignedRequestError'; }
}

function oneShot<T>(serverUrl: string, identity: DeviceIdentity, build: (challenge: string) => DirectoryClientFrame, accept: (frame: DirectoryServerFrame) => T | undefined): Promise<T> {
  validateDeviceIdentity(identity); const url = endpointUrl(serverUrl, 'directory'); url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url.toString()); let challenged = false; let finished = false;
    const finish = (error?: Error, value?: T) => {
      if (finished) return; finished = true; clearTimeout(timer); socket.onmessage = null; socket.onerror = null; socket.onclose = null; socket.onopen = null;
      try { socket.close(); } catch { /* Some native adapters reject close while connecting. */ }
      if (error) reject(error); else resolve(value as T);
    };
    const timer = setTimeout(() => finish(new Error('Request timed out')), 15000);
    socket.onmessage = event => {
      if (finished) return;
      try {
        if (typeof event.data !== 'string' || event.data.length > 16 * 1024) throw new Error('Invalid response frame');
        const frame = directoryServerFrameSchema.parse(JSON.parse(event.data));
        if (frame.type === 'challenge') {
          if (challenged) throw new Error('Repeated challenge'); challenged = true;
          socket.send(JSON.stringify(directoryClientFrameSchema.parse(build(frame.challenge))));
        } else if (frame.type === 'error') finish(new SignedRequestError(frame.code, frame.message));
        else {
          if (!challenged) throw new Error('Response before challenge');
          const value = accept(frame);
          if (value === undefined) throw new Error('Unexpected response');
          finish(undefined, value);
        }
      } catch (error) { finish(error instanceof Error ? error : new Error('Invalid response')); }
    };
    socket.onerror = () => finish(new Error('Connection failed'));
    socket.onclose = () => finish(new Error('Connection closed'));
  });
}

export interface TelegramSession { sessionId: string; url: string; expiresAt: number }
/** A one-time link to our bot; the person shares their own number there. */
export function startTelegram(serverUrl: string, identity: DeviceIdentity, purpose: TelegramPurpose): Promise<TelegramSession> {
  telegramPurposeSchema.parse(purpose);
  return oneShot(serverUrl, identity,
    challenge => ({ type: 'telegram-start', purpose, publicKey: identity.publicKey, signature: signRequest(identity, challenge, 'telegram-start', [purpose]) }),
    frame => frame.type === 'telegram-started' ? { sessionId: frame.sessionId, url: frame.url, expiresAt: frame.expiresAt } : undefined);
}
export interface TelegramCheck { state: 'pending' | 'expired' | 'verified'; proof?: string; user?: DirectoryUser; phone?: string }
/** register returns `proof` for authenticate, recover returns the moved profile as `user`, bind returns neither. */
export function checkTelegram(serverUrl: string, identity: DeviceIdentity, sessionId: string): Promise<TelegramCheck> {
  peerIdSchema.parse(sessionId);
  return oneShot(serverUrl, identity,
    challenge => ({ type: 'telegram-check', sessionId, publicKey: identity.publicKey, signature: signRequest(identity, challenge, 'telegram-check', [sessionId]) }),
    frame => {
      if (frame.type !== 'telegram-status') return undefined;
      if (frame.user && (frame.user.userId !== identity.userId || frame.user.publicKey !== identity.publicKey)) throw new Error('Recovered profile identity mismatch');
      return { state: frame.state, ...(frame.proof ? { proof: frame.proof } : {}), ...(frame.user ? { user: { ...frame.user } } : {}), ...(frame.phone ? { phone: frame.phone } : {}) };
    });
}
/** For people who cannot use Telegram: a note to the administrator, answered in this app. */
export function requestAccess(serverUrl: string, identity: DeviceIdentity, input: { name: string; contact?: string; message: string }): Promise<string> {
  const name = accessNameSchema.parse(input.name), message = accessMessageSchema.parse(input.message);
  const contact = input.contact?.trim() ? accessContactSchema.parse(input.contact) : undefined;
  return oneShot(serverUrl, identity,
    challenge => ({ type: 'access-request', name, message, ...(contact ? { contact } : {}), publicKey: identity.publicKey, signature: signRequest(identity, challenge, 'access-request', [name, contact ?? '', message]) }),
    frame => frame.type === 'access-requested' ? frame.id : undefined);
}
export interface AccessState { state: 'none' | 'pending' | 'approved' | 'declined'; inviteCode?: string }
export function checkAccess(serverUrl: string, identity: DeviceIdentity): Promise<AccessState> {
  return oneShot(serverUrl, identity,
    challenge => ({ type: 'access-check', publicKey: identity.publicKey, signature: signRequest(identity, challenge, 'access-check', []) }),
    frame => frame.type === 'access-status' ? { state: frame.state, ...(frame.inviteCode ? { inviteCode: frame.inviteCode } : {}) } : undefined);
}

/** Russian numbering plan: +7 except Kazakhstan's +7 6xx and +7 7xx. */
export function isRussianNumber(e164: string): boolean { return /^\+7[0-57-9][0-9]{9}$/.test(e164); }
/** "+7 ••• ••• 12": enough to recognise one's own number, nothing more. */
export function maskPhone(e164: string): string {
  let code = '';
  try { code = parsePhoneNumberWithError(e164, { extract: false }).countryCallingCode; } catch { /* Fall back to no country code. */ }
  return `${code ? `+${code} ` : ''}••• ••• ${e164.slice(-2)}`;
}
