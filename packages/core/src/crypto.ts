import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { z } from 'zod';
import { peerIdSchema, roomIdSchema, sealedEnvelopeSchema, signalBodySchema, type SignalBody, type SealedEnvelope } from './protocol.js';
export { bytesToHex, hexToBytes };
export type RandomBytes = (length:number)=>Uint8Array;
export const secureRandomBytes:RandomBytes = length => {
  if (!globalThis.crypto?.getRandomValues) throw new Error('Secure randomness unavailable; inject platform randomBytes');
  return globalThis.crypto.getRandomValues(new Uint8Array(length));
};
export function randomChecked(random:RandomBytes, length:number):Uint8Array {
  const result=random(length);
  if (!(result instanceof Uint8Array) || result.length!==length) throw new Error('randomBytes returned wrong length');
  return result;
}
export function createInvite(random:RandomBytes=secureRandomBytes):string { return bytesToHex(randomChecked(random,32)); }
export function roomIdFromInvite(invite:string):string { roomIdSchema.parse(invite); return bytesToHex(sha256(hexToBytes(invite))); }
const encoder=new TextEncoder();
const decoder=new TextDecoder('utf-8',{fatal:true});
const plaintextSchema=z.object({recipient:peerIdSchema,sequence:z.number().int().positive().max(Number.MAX_SAFE_INTEGER),body:signalBodySchema}).strict();
/** Prototype PSK signaling only: no ratchet or forward secrecy. A cipher lives with one PeerSession. */
export class SignalingCipher {
  readonly roomId:string;
  private secret:Uint8Array;
  private sequence=0;
  private lastReceived=new Map<string,number>();
  constructor(invite:string, readonly sender:string, private random:RandomBytes=secureRandomBytes) {
    this.roomId=roomIdFromInvite(invite); peerIdSchema.parse(sender); this.secret=hexToBytes(invite);
  }
  private context(sender:string) { return encoder.encode(`messenger-prototype/signaling/v1/${this.roomId}/${sender}`); }
  private key(sender:string) { return hkdf(sha256,this.secret,encoder.encode('messenger-prototype/hkdf/v1'),this.context(sender),32); }
  seal(body:SignalBody,recipient:string):SealedEnvelope {
    peerIdSchema.parse(recipient);
    signalBodySchema.parse(body);
    const nonce=randomChecked(this.random,24);
    const key=this.key(this.sender);
    try {
      const data=encoder.encode(JSON.stringify({recipient,sequence:++this.sequence,body}));
      return sealedEnvelopeSchema.parse({version:1,nonce:bytesToHex(nonce),ciphertext:bytesToHex(xchacha20poly1305(key,nonce,this.context(this.sender)).encrypt(data))});
    } finally { key.fill(0); }
  }
  open(sender:string,envelope:SealedEnvelope):SignalBody {
    peerIdSchema.parse(sender); sealedEnvelopeSchema.parse(envelope);
    if(sender===this.sender) throw new Error('Reflected signal');
    // Two occupants plus bounded reconnect identities; refuse new identities beyond the bound.
    if(!this.lastReceived.has(sender)&&this.lastReceived.size>=16) throw new Error('Replay identity capacity exceeded; create a new session');
    const key=this.key(sender);
    try {
      const plaintext=xchacha20poly1305(key,hexToBytes(envelope.nonce),this.context(sender)).decrypt(hexToBytes(envelope.ciphertext));
      const parsed=plaintextSchema.parse(JSON.parse(decoder.decode(plaintext)));
      if(parsed.recipient!==this.sender)throw new Error('Signal recipient mismatch');
      if(parsed.sequence<=(this.lastReceived.get(sender)??0)) throw new Error('Replayed or reordered signal');
      this.lastReceived.set(sender,parsed.sequence);
      return parsed.body;
    } finally { key.fill(0); }
  }
}
