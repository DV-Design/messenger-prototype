import { ed25519 } from '@noble/curves/ed25519.js';
import { bytesToHex, hexToBytes } from './crypto.js';
import { peerIdSchema, roomIdSchema } from './protocol.js';
import { directoryClientFrameSchema, directoryServerFrameSchema, emailAddressSchema, emailLocaleSchema, emailPurposeSchema, endpointUrl, normalizeEmail, userIdFromPublicKey, validateDeviceIdentity, type DeviceIdentity, type DirectoryClientFrame, type DirectoryServerFrame, type DirectoryUser, type EmailLocale, type EmailPurpose } from './directory.js';

const utf8 = (value: string) => new TextEncoder().encode(value);
const signed = /^[0-9a-f]{128}$/;

/** Separate signature purposes: neither frame can stand in for the other or for authentication. */
export function emailStartPayload(challenge: string, publicKey: string, purpose: EmailPurpose, email: string, locale: EmailLocale): Uint8Array {
  roomIdSchema.parse(challenge); userIdFromPublicKey(publicKey); emailPurposeSchema.parse(purpose); emailAddressSchema.parse(email); emailLocaleSchema.parse(locale);
  return utf8(JSON.stringify(['lastcall/email-start/v1', challenge, publicKey, purpose, email, locale]));
}
export function signEmailStart(identity: DeviceIdentity, challenge: string, purpose: EmailPurpose, email: string, locale: EmailLocale): string {
  validateDeviceIdentity(identity); return bytesToHex(ed25519.sign(emailStartPayload(challenge, identity.publicKey, purpose, email, locale), hexToBytes(identity.privateKey)));
}
export function verifyEmailStart(publicKey: string, challenge: string, purpose: EmailPurpose, email: string, locale: EmailLocale, signature: string): boolean {
  try { if (!signed.test(signature)) return false; return ed25519.verify(hexToBytes(signature), emailStartPayload(challenge, publicKey, purpose, email, locale), hexToBytes(publicKey), { zip215: false }); } catch { return false; }
}
export function emailVerifyPayload(challenge: string, publicKey: string, challengeId: string, code: string): Uint8Array {
  roomIdSchema.parse(challenge); userIdFromPublicKey(publicKey); peerIdSchema.parse(challengeId);
  if (!/^[0-9]{6}$/.test(code)) throw new Error('Invalid email code');
  return utf8(JSON.stringify(['lastcall/email-verify/v1', challenge, publicKey, challengeId, code]));
}
export function signEmailVerify(identity: DeviceIdentity, challenge: string, challengeId: string, code: string): string {
  validateDeviceIdentity(identity); return bytesToHex(ed25519.sign(emailVerifyPayload(challenge, identity.publicKey, challengeId, code), hexToBytes(identity.privateKey)));
}
export function verifyEmailVerify(publicKey: string, challenge: string, challengeId: string, code: string, signature: string): boolean {
  try { if (!signed.test(signature)) return false; return ed25519.verify(hexToBytes(signature), emailVerifyPayload(challenge, publicKey, challengeId, code), hexToBytes(publicKey), { zip215: false }); } catch { return false; }
}

/** The server answered with a specific refusal; any other rejection is a network or protocol failure. */
export class EmailAuthError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = 'EmailAuthError'; }
}
export interface EmailVerification { proof?: string; user?: DirectoryUser }

/** Short-lived challenge connection; a network failure is never reported as a negative answer. */
function oneShot<T>(serverUrl: string, identity: DeviceIdentity, build: (challenge: string) => DirectoryClientFrame, accept: (frame: DirectoryServerFrame) => T | undefined): Promise<T> {
  validateDeviceIdentity(identity); const url = endpointUrl(serverUrl, 'directory'); url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url.toString()); let challenged = false; let finished = false;
    const finish = (error?: Error, value?: T) => {
      if (finished) return; finished = true; clearTimeout(timer); socket.onmessage = null; socket.onerror = null; socket.onclose = null; socket.onopen = null;
      try { socket.close(); } catch { /* Some native adapters reject close while connecting. */ }
      if (error) reject(error); else resolve(value as T);
    };
    const timer = setTimeout(() => finish(new Error('Email request timed out')), 15000);
    socket.onmessage = event => {
      if (finished) return;
      try {
        if (typeof event.data !== 'string' || event.data.length > 16 * 1024) throw new Error('Invalid email response frame');
        const frame = directoryServerFrameSchema.parse(JSON.parse(event.data));
        if (frame.type === 'challenge') {
          if (challenged) throw new Error('Repeated email challenge'); challenged = true;
          socket.send(JSON.stringify(directoryClientFrameSchema.parse(build(frame.challenge))));
        } else if (frame.type === 'error') finish(new EmailAuthError(frame.code, frame.message));
        else {
          if (!challenged) throw new Error('Email response before challenge');
          const value = accept(frame);
          if (value === undefined) throw new Error('Unexpected email response');
          finish(undefined, value);
        }
      } catch (error) { finish(error instanceof Error ? error : new Error('Invalid email response')); }
    };
    socket.onerror = () => finish(new Error('Email connection failed'));
    socket.onclose = () => finish(new Error('Email connection closed'));
  });
}

/** Asks the server to mail a code. The reply is the same whether or not the address has an account. */
export function startEmailChallenge(serverUrl: string, identity: DeviceIdentity, input: { purpose: EmailPurpose; email: string; locale: EmailLocale }): Promise<string> {
  const email = emailAddressSchema.parse(normalizeEmail(input.email));
  return oneShot(serverUrl, identity,
    challenge => ({ type: 'email-start', purpose: input.purpose, email, locale: input.locale, publicKey: identity.publicKey, signature: signEmailStart(identity, challenge, input.purpose, email, input.locale) }),
    frame => frame.type === 'email-started' ? frame.challengeId : undefined);
}

/** register returns `proof` for authenticate, recover returns the moved profile as `user`, bind returns neither. */
export function verifyEmailChallenge(serverUrl: string, identity: DeviceIdentity, challengeId: string, code: string): Promise<EmailVerification> {
  return oneShot(serverUrl, identity,
    challenge => ({ type: 'email-verify', challengeId, code, publicKey: identity.publicKey, signature: signEmailVerify(identity, challenge, challengeId, code) }),
    frame => {
      if (frame.type !== 'email-verified') return undefined;
      if (frame.user && (frame.user.userId !== identity.userId || frame.user.publicKey !== identity.publicKey)) throw new Error('Recovered profile identity mismatch');
      return { ...(frame.proof ? { proof: frame.proof } : {}), ...(frame.user ? { user: { ...frame.user } } : {}) };
    });
}
