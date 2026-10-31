import {xchacha20poly1305} from '@noble/ciphers/chacha.js';
import {hkdf} from '@noble/hashes/hkdf.js';
import {sha256} from '@noble/hashes/sha2.js';
import {z} from 'zod';
import {bytesToHex,hexToBytes,randomChecked,secureRandomBytes,type RandomBytes} from './crypto.js';
import {conversationInvite,directConversationId,userIdFromPublicKey,wakeIntentSchema,type DeviceIdentity,type WakeIntent} from './directory.js';
import {callPushSchema,callPushEnvelopeSchema,type CallInvitation} from './call-control.js';
const encoder=new TextEncoder(),decoder=new TextDecoder('utf-8',{fatal:true});
const payloadSchema=z.object({conversationId:z.string().regex(/^dm:[a-f0-9]{64}$/),video:z.boolean()}).strict();
type Envelope=z.infer<typeof callPushEnvelopeSchema>;
function context(header:Omit<Envelope,'nonce'|'ciphertext'>){return encoder.encode(JSON.stringify(['lastcall/call-push/v1',header.version,header.kind,header.senderId,header.recipientId,header.callId,header.intentId,header.issuedAt,header.expiresAt,header.serverEpoch]));}
function key(identity:DeviceIdentity,publicKey:string,aad:Uint8Array){const pair=hexToBytes(conversationInvite(identity,publicKey));try{return hkdf(sha256,pair,encoder.encode('lastcall/call-push/hkdf/v1'),aad,32);}finally{pair.fill(0);}}
export interface OpenedCallPush extends CallInvitation {callerId:string;conversationId:string;video:boolean;serverEpoch:string;}
export function encryptCallPush(identity:DeviceIdentity,publicKey:string,invitation:CallInvitation,serverEpoch:string,input:{conversationId:string;video:boolean},random:RandomBytes=secureRandomBytes):string{
 const recipientId=userIdFromPublicKey(publicKey),payload=payloadSchema.parse(input);if(payload.conversationId!==directConversationId(identity.userId,recipientId))throw new Error('Call conversation mismatch');
 const header={version:1 as const,kind:'call-invite' as const,senderId:identity.userId,recipientId,callId:invitation.callId,issuedAt:invitation.issuedAt,expiresAt:invitation.expiresAt,intentId:invitation.callId,serverEpoch};const aad=context(header),derived=key(identity,publicKey,aad),nonce=randomChecked(random,24),plaintext=encoder.encode(JSON.stringify(payload));
 try{return callPushSchema.parse(JSON.stringify({...header,nonce:bytesToHex(nonce),ciphertext:bytesToHex(xchacha20poly1305(derived,nonce,aad).encrypt(plaintext))}));}finally{derived.fill(0);plaintext.fill(0);}
}
export function decryptCallPush(identity:DeviceIdentity,publicKey:string,sealed:string,intent:WakeIntent,now=Date.now()):OpenedCallPush{
 wakeIntentSchema.parse(intent);const envelope=callPushEnvelopeSchema.parse(JSON.parse(callPushSchema.parse(sealed)));
 if(intent.kind!=='call'||envelope.senderId!==userIdFromPublicKey(publicKey)||envelope.recipientId!==identity.userId||envelope.callId!==intent.intentId||envelope.expiresAt!==intent.expiresAt||now>=envelope.expiresAt||envelope.issuedAt>now+5000)throw new Error('Call target, intent or expiry mismatch');
 const aad=context(envelope),derived=key(identity,publicKey,aad);let plaintext:Uint8Array|undefined;
 try{plaintext=xchacha20poly1305(derived,hexToBytes(envelope.nonce),aad).decrypt(hexToBytes(envelope.ciphertext));if(plaintext.length>256)throw new Error('Call payload exceeds limit');const payload=payloadSchema.parse(JSON.parse(decoder.decode(plaintext)));if(payload.conversationId!==directConversationId(identity.userId,envelope.senderId))throw new Error('Call conversation mismatch');return {callerId:envelope.senderId,callId:envelope.callId,issuedAt:envelope.issuedAt,expiresAt:envelope.expiresAt,serverEpoch:envelope.serverEpoch,...payload};}finally{derived.fill(0);plaintext?.fill(0);}
}
