import {xchacha20poly1305} from '@noble/ciphers/chacha.js';
import {hkdf} from '@noble/hashes/hkdf.js';
import {sha256} from '@noble/hashes/sha2.js';
import {z} from 'zod';
import {bytesToHex,hexToBytes,randomChecked,secureRandomBytes,type RandomBytes} from './crypto.js';
import {conversationInvite,directConversationId,userIdFromPublicKey,wakeIntentSchema,pushPreviewSchema,pushPreviewEnvelopeSchema,type DeviceIdentity,type WakeIntent} from './directory.js';
import {conversationIdSchema,peerIdSchema,MAX_TEXT_CHARS} from './protocol.js';

export const MAX_PUSH_PREVIEW_TEXT_BYTES=800;
const MAX_PLAINTEXT_BYTES=1100;
const encoder=new TextEncoder();const decoder=new TextDecoder('utf-8',{fatal:true});
const payloadSchema=z.object({conversationId:conversationIdSchema,messageId:peerIdSchema,text:z.string().min(1).refine(text=>encoder.encode(text).length<=MAX_PUSH_PREVIEW_TEXT_BYTES),truncated:z.boolean()}).strict();
export interface PushPreview {kind:'message'|'file';senderId:string;conversationId:string;messageId:string;text:string;truncated:boolean;}
export interface OpenedPushPreview extends PushPreview {displayName:string;}
type Envelope=z.infer<typeof pushPreviewEnvelopeSchema>;
function context(value:Omit<Envelope,'nonce'|'ciphertext'>){return encoder.encode(JSON.stringify(['lastcall/push-preview/v1',value.version,value.senderId,value.recipientId,value.kind,value.intentId,value.expiresAt]));}
function key(identity:DeviceIdentity,remotePublicKey:string,aad:Uint8Array){
  const pair=hexToBytes(conversationInvite(identity,remotePublicKey));
  try{return hkdf(sha256,pair,encoder.encode('lastcall/push-preview/hkdf/v1'),aad,32);}finally{pair.fill(0);}
}
/** Pair-authenticated notification text only; this is not a chat record or a delivery receipt. */
export function encryptPushPreview(identity:DeviceIdentity,remotePublicKey:string,intent:WakeIntent,input:{conversationId:string;messageId:string;text:string},random:RandomBytes=secureRandomBytes):string{
  wakeIntentSchema.parse(intent);if(intent.kind!=='message'&&intent.kind!=='file')throw new Error('Only message/file intents have previews');
  conversationIdSchema.parse(input.conversationId);peerIdSchema.parse(input.messageId);if(typeof input.text!=='string'||!input.text.length||input.text.length>MAX_TEXT_CHARS)throw new Error('Preview source text exceeds message limit');
  const recipientId=userIdFromPublicKey(remotePublicKey);
  if(input.conversationId.startsWith('dm:')&&input.conversationId!==directConversationId(identity.userId,recipientId))throw new Error('Preview conversation mismatch');
  const header={version:1 as const,senderId:identity.userId,recipientId,...intent,kind:intent.kind};
  // Encoding replaces isolated surrogates; iteration never splits a Unicode code point.
  const original=decoder.decode(encoder.encode(input.text));let text='';let bytes=0;
  for(const character of original){const size=encoder.encode(character).length;const candidate=text+character;
    if(bytes+size>MAX_PUSH_PREVIEW_TEXT_BYTES||encoder.encode(JSON.stringify({...input,text:candidate,truncated:true})).length>MAX_PLAINTEXT_BYTES)break;
    text=candidate;bytes+=size;
  }
  const payload=payloadSchema.parse({conversationId:input.conversationId,messageId:input.messageId,text,truncated:text!==original});
  const plaintext=encoder.encode(JSON.stringify(payload));const aad=context(header);const nonce=randomChecked(random,24);const derived=key(identity,remotePublicKey,aad);
  try{return pushPreviewSchema.parse(JSON.stringify({...header,nonce:bytesToHex(nonce),ciphertext:bytesToHex(xchacha20poly1305(derived,nonce,aad).encrypt(plaintext))}));}
  finally{derived.fill(0);plaintext.fill(0);}
}
export function decryptPushPreview(identity:DeviceIdentity,remotePublicKey:string,sealed:string,intent:WakeIntent,now=Date.now()):PushPreview{
  wakeIntentSchema.parse(intent);const envelope=pushPreviewEnvelopeSchema.parse(JSON.parse(pushPreviewSchema.parse(sealed)));
  if(!Number.isSafeInteger(now)||now<0||(intent.kind!=='message'&&intent.kind!=='file')||envelope.kind!==intent.kind||envelope.senderId!==userIdFromPublicKey(remotePublicKey)||envelope.recipientId!==identity.userId||envelope.intentId!==intent.intentId||envelope.expiresAt!==intent.expiresAt||now>=intent.expiresAt||intent.expiresAt>now+65000)throw new Error('Preview target, intent or expiry mismatch');
  const aad=context(envelope);const derived=key(identity,remotePublicKey,aad);let plaintext:Uint8Array|undefined;
  try{
    plaintext=xchacha20poly1305(derived,hexToBytes(envelope.nonce),aad).decrypt(hexToBytes(envelope.ciphertext));if(plaintext.length>MAX_PLAINTEXT_BYTES)throw new Error('Preview plaintext exceeds limit');
    const payload=payloadSchema.parse(JSON.parse(decoder.decode(plaintext)));
    if(payload.conversationId.startsWith('dm:')&&payload.conversationId!==directConversationId(identity.userId,envelope.senderId))throw new Error('Preview conversation mismatch');
    return {kind:envelope.kind,senderId:envelope.senderId,...payload};
  }finally{derived.fill(0);plaintext?.fill(0);}
}
