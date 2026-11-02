import { ed25519, x25519 } from '@noble/curves/ed25519.js';
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes, randomChecked, secureRandomBytes, type RandomBytes } from './crypto.js';
import { userIdFromPublicKey, validateDeviceIdentity, type DeviceIdentity } from './directory.js';
import { contentHelloSchema, peerIdSchema, roomIdSchema, sealedContentSchema, type ContentHello, type SealedContent } from './protocol.js';

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
const MAX_PLAINTEXT_BYTES = 32 * 1024;
const MAX_SEQUENCE = Number.MAX_SAFE_INTEGER;

function helloAad(userId: string, remoteUserId: string, sessionId: string, publicKey: string) {
  return encoder.encode(JSON.stringify(['lastcall/content-hello/v1', userId, remoteUserId, sessionId, publicKey]));
}

/**
 * A per-connection ephemeral X25519 keypair. The Ed25519 signature binds the
 * ephemeral key to the pinned contact identity and to both participants.
 */
export function createContentHello(identity: DeviceIdentity, remoteUserId: string, random: RandomBytes = secureRandomBytes) {
  validateDeviceIdentity(identity);
  roomIdSchema.parse(remoteUserId);
  if (remoteUserId === identity.userId) throw new Error('Cannot encrypt content to self');
  const sessionId = bytesToHex(randomChecked(random, 16));
  const privateKey = randomChecked(random, 32);
  const publicKey = bytesToHex(x25519.getPublicKey(privateKey));
  const signature = bytesToHex(ed25519.sign(helloAad(identity.userId, remoteUserId, sessionId, publicKey), hexToBytes(identity.privateKey)));
  return { hello: contentHelloSchema.parse({ version: 1, sessionId, publicKey, signature }), privateKey };
}

export function verifyContentHello(hello: unknown, remotePublicKey: string, remoteUserId: string, localUserId: string): boolean {
  try {
    const parsed = contentHelloSchema.parse(hello);
    roomIdSchema.parse(remotePublicKey);
    roomIdSchema.parse(remoteUserId);
    roomIdSchema.parse(localUserId);
    if (remoteUserId === localUserId || userIdFromPublicKey(remotePublicKey) !== remoteUserId) return false;
    return ed25519.verify(
      hexToBytes(parsed.signature),
      helloAad(remoteUserId, localUserId, parsed.sessionId, parsed.publicKey),
      hexToBytes(remotePublicKey),
      { zip215: false },
    );
  } catch {
    return false;
  }
}

/**
 * Symmetric per-session content cipher. The two ephemeral keys are combined
 * with the signed transcript; direction keys are assigned by sorted user ID.
 * Sequence numbers are authenticated and monotonically enforced.
 */
export class ContentCipher {
  private sendSequence = 0;
  private receiveSequence = 0;
  private disposed = false;
  readonly contextHash: string;

  private constructor(
    private readonly localUserId: string,
    private readonly remoteUserId: string,
    private sendKey: Uint8Array,
    private receiveKey: Uint8Array,
    contextHash: string,
    private readonly random: RandomBytes,
  ) {
    this.contextHash = contextHash;
  }

  static derive(input: {
    localHello: ContentHello;
    remoteHello: ContentHello;
    ephemeralPrivateKey: Uint8Array;
    localUserId: string;
    remoteUserId: string;
    random?: RandomBytes;
  }): ContentCipher {
    roomIdSchema.parse(input.localUserId);
    roomIdSchema.parse(input.remoteUserId);
    if (input.localUserId === input.remoteUserId) throw new Error('Cannot derive a cipher with self');
    const local = contentHelloSchema.parse(input.localHello);
    const remote = contentHelloSchema.parse(input.remoteHello);
    if (!(input.ephemeralPrivateKey instanceof Uint8Array) || input.ephemeralPrivateKey.length !== 32) throw new Error('Invalid ephemeral key');
    const entries = [
      { userId: input.localUserId, sessionId: local.sessionId, publicKey: local.publicKey },
      { userId: input.remoteUserId, sessionId: remote.sessionId, publicKey: remote.publicKey },
    ].sort((first, second) => first.userId < second.userId ? -1 : 1);
    const transcript = encoder.encode(JSON.stringify(['lastcall/content-transcript/v1', ...entries]));
    const shared = x25519.getSharedSecret(input.ephemeralPrivateKey, hexToBytes(remote.publicKey));
    let material: Uint8Array | undefined;
    try {
      const salt = sha256(transcript);
      material = hkdf(sha256, shared, salt, encoder.encode('lastcall/content-keys/v1'), 64);
      const first = material.slice(0, 32);
      const second = material.slice(32, 64);
      const localFirst = input.localUserId < input.remoteUserId;
      return new ContentCipher(
        input.localUserId,
        input.remoteUserId,
        localFirst ? first : second,
        localFirst ? second : first,
        bytesToHex(sha256(transcript)),
        input.random ?? secureRandomBytes,
      );
    } finally {
      shared.fill(0);
      material?.fill(0);
    }
  }

  private aad(senderId: string, recipientId: string, sequence: number) {
    return encoder.encode(JSON.stringify(['lastcall/content-frame/v1', this.contextHash, senderId, recipientId, sequence]));
  }

  seal(frame: unknown): SealedContent {
    if (this.disposed) throw new Error('Content cipher is closed');
    const plaintext = encoder.encode(JSON.stringify(frame));
    if (plaintext.length > MAX_PLAINTEXT_BYTES) { plaintext.fill(0); throw new Error('Encrypted content exceeds limit'); }
    const sequence = ++this.sendSequence;
    if (sequence > MAX_SEQUENCE) { plaintext.fill(0); throw new Error('Content sequence exhausted'); }
    const randomNonce = randomChecked(this.random, 16);
    const nonce = new Uint8Array(24);
    nonce.set(randomNonce, 0);
    // The trailing counter makes nonce reuse impossible even with a faulty RNG.
    let value = sequence;
    for (let index = 23; index >= 16; index--) { nonce[index] = value & 0xff; value = Math.floor(value / 256); }
    try {
      return sealedContentSchema.parse({
        kind: 'sealed', version: 1, sequence,
        nonce: bytesToHex(nonce),
        ciphertext: bytesToHex(xchacha20poly1305(this.sendKey, nonce, this.aad(this.localUserId, this.remoteUserId, sequence)).encrypt(plaintext)),
      });
    } finally {
      plaintext.fill(0);
    }
  }

  open(input: unknown): unknown {
    if (this.disposed) throw new Error('Content cipher is closed');
    const sealed = sealedContentSchema.parse(input);
    if (sealed.sequence <= this.receiveSequence) throw new Error('Replayed or reordered encrypted content');
    let plaintext: Uint8Array | undefined;
    try {
      plaintext = xchacha20poly1305(this.receiveKey, hexToBytes(sealed.nonce), this.aad(this.remoteUserId, this.localUserId, sealed.sequence)).decrypt(hexToBytes(sealed.ciphertext));
      if (plaintext.length > MAX_PLAINTEXT_BYTES) throw new Error('Encrypted content exceeds limit');
      const value: unknown = JSON.parse(decoder.decode(plaintext));
      this.receiveSequence = sealed.sequence;
      return value;
    } finally {
      plaintext?.fill(0);
    }
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.sendKey.fill(0);
    this.receiveKey.fill(0);
  }
}

function digestFor(parts: string[]) {
  return sha256(encoder.encode(JSON.stringify(parts)));
}

/** Stable 12-group safety number for out-of-band key verification. */
export function safetyNumber(firstPublicKey: string, secondPublicKey: string): string {
  roomIdSchema.parse(firstPublicKey);
  roomIdSchema.parse(secondPublicKey);
  const keys = [firstPublicKey, secondPublicKey].sort();
  const digest = digestFor(['lastcall/safety-number/v1', ...keys]);
  const groups: string[] = [];
  for (let index = 0; index < 24; index += 2) groups.push(String(((digest[index]! << 8) | digest[index + 1]!) % 100000).padStart(5, '0'));
  return groups.join(' ');
}

/** Short per-call code; both sides derive the same value from the call and identities. */
export function callSafetyCode(firstPublicKey: string, secondPublicKey: string, callId: string): string {
  roomIdSchema.parse(firstPublicKey);
  roomIdSchema.parse(secondPublicKey);
  peerIdSchema.parse(callId);
  const keys = [firstPublicKey, secondPublicKey].sort();
  const digest = digestFor(['lastcall/call-safety/v1', ...keys, callId]);
  const value = ((digest[0]! << 24) | (digest[1]! << 16) | (digest[2]! << 8) | digest[3]!) >>> 0;
  const code = String(value % 1_000_000).padStart(6, '0');
  return `${code.slice(0, 3)} ${code.slice(3)}`;
}
