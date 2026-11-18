import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { base64Available, base64ToBytes, bytesToBase64, bytesToHex, hexToBytes, randomChecked, secureRandomBytes, type RandomBytes } from './crypto.js';
import { validateDeviceIdentity, type DeviceIdentity } from './directory.js';
/** History (~6 MiB) plus up to 2000 stored file records (~2 KiB each). */
export const MAX_LOCAL_STATE_BYTES=16*1024*1024;
export const MAX_ATTACHMENT_BYTES=5*1024*1024;
export const MAX_SEALED_ATTACHMENT_BYTES=MAX_ATTACHMENT_BYTES*2+1024;
const encoder=new TextEncoder();
const attachmentKeyPattern=/^[a-f0-9]{64}$/;
function attachmentContext(identity:DeviceIdentity,attachmentKey:string){
  validateDeviceIdentity(identity);
  if(typeof attachmentKey!=='string'||!attachmentKeyPattern.test(attachmentKey))throw new Error('Invalid attachment key');
  const context=encoder.encode(JSON.stringify(['lastcall/local-attachment/v1',identity.userId,identity.publicKey,attachmentKey]));
  return {context,key:hkdf(sha256,hexToBytes(identity.privateKey),encoder.encode('lastcall/local-attachment/hkdf/v1'),context,32)};
}
/** Ciphertext blobs stay separate from the bounded encrypted metadata state. */
export function sealAttachment(identity:DeviceIdentity,attachmentKey:string,data:Uint8Array,random:RandomBytes=secureRandomBytes):string {
  if(!(data instanceof Uint8Array)||data.byteLength>MAX_ATTACHMENT_BYTES)throw new Error('Attachment exceeds limit');
  const {context,key}=attachmentContext(identity,attachmentKey);
  try{
    const nonce=randomChecked(random,24);
    return JSON.stringify({version:1,nonce:bytesToHex(nonce),ciphertext:bytesToHex(xchacha20poly1305(key,nonce,context).encrypt(data))});
  }finally{key.fill(0);}
}
export function openAttachment(identity:DeviceIdentity,attachmentKey:string,sealed:string):Uint8Array {
  if(typeof sealed!=='string'||sealed.length>MAX_SEALED_ATTACHMENT_BYTES)throw new Error('Sealed attachment exceeds limit');
  const value:unknown=JSON.parse(sealed);
  if(typeof value!=='object'||value===null||Array.isArray(value))throw new Error('Invalid sealed attachment');
  const envelope=value as Record<string,unknown>;
  if(Object.keys(envelope).length!==3||envelope.version!==1||typeof envelope.nonce!=='string'||!/^[a-f0-9]{48}$/.test(envelope.nonce)
    ||typeof envelope.ciphertext!=='string'||envelope.ciphertext.length<32||envelope.ciphertext.length>MAX_ATTACHMENT_BYTES*2+32||!/^(?:[a-f0-9]{2})+$/.test(envelope.ciphertext))throw new Error('Invalid sealed attachment');
  const {context,key}=attachmentContext(identity,attachmentKey);
  try{return xchacha20poly1305(key,hexToBytes(envelope.nonce),context).decrypt(hexToBytes(envelope.ciphertext));}finally{key.fill(0);}
}
function localKey(identity:DeviceIdentity){validateDeviceIdentity(identity);return hkdf(sha256,hexToBytes(identity.privateKey),encoder.encode('messenger/local-state/hkdf/v2'),encoder.encode(identity.userId),32);}
export function sealLocalState(identity:DeviceIdentity,state:unknown,random:RandomBytes=secureRandomBytes):string {
  const plaintext=encoder.encode(JSON.stringify(state));if(plaintext.length>MAX_LOCAL_STATE_BYTES)throw new Error('Local state exceeds limit');
  const nonce=randomChecked(random,24);const key=localKey(identity);
  try{
    const ciphertext=xchacha20poly1305(key,nonce,encoder.encode('messenger/local-state/v2/'+identity.userId)).encrypt(plaintext);
    // Version 2 stores base64 (a third smaller than hex, and faster to write and parse); version 1 hex is still read.
    return base64Available()?JSON.stringify({version:2,nonce:bytesToHex(nonce),ciphertext:bytesToBase64(ciphertext)}):JSON.stringify({version:1,nonce:bytesToHex(nonce),ciphertext:bytesToHex(ciphertext)});
  }finally{key.fill(0);plaintext.fill(0);}
}
export function openLocalState(identity:DeviceIdentity,sealed:string):unknown {
  if(sealed.length>MAX_LOCAL_STATE_BYTES*2+1024)throw new Error('Sealed state exceeds limit');
  const value=JSON.parse(sealed) as {version:number;nonce:string;ciphertext:string};
  const hexCiphertext=value.version===1&&typeof value.ciphertext==='string'&&/^(?:[a-f0-9]{2})+$/.test(value.ciphertext);
  const base64Ciphertext=value.version===2&&typeof value.ciphertext==='string'&&value.ciphertext.length%4===0&&/^[A-Za-z0-9+/]+={0,2}$/.test(value.ciphertext);
  if((!hexCiphertext&&!base64Ciphertext)||!/^[a-f0-9]{48}$/.test(value.nonce)||value.ciphertext.length<24||value.ciphertext.length>MAX_LOCAL_STATE_BYTES*2+32)throw new Error('Invalid sealed local state');
  const key=localKey(identity);let plaintext:Uint8Array|undefined;
  try{plaintext=xchacha20poly1305(key,hexToBytes(value.nonce),encoder.encode('messenger/local-state/v2/'+identity.userId)).decrypt(hexCiphertext?hexToBytes(value.ciphertext):base64ToBytes(value.ciphertext));return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(plaintext));}finally{key.fill(0);plaintext?.fill(0);}
}
