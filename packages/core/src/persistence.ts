import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes, randomChecked, secureRandomBytes, type RandomBytes } from './crypto.js';
import { validateDeviceIdentity, type DeviceIdentity } from './directory.js';
export const MAX_LOCAL_STATE_BYTES=8*1024*1024;
const encoder=new TextEncoder();
function localKey(identity:DeviceIdentity){validateDeviceIdentity(identity);return hkdf(sha256,hexToBytes(identity.privateKey),encoder.encode('messenger/local-state/hkdf/v2'),encoder.encode(identity.userId),32);}
export function sealLocalState(identity:DeviceIdentity,state:unknown,random:RandomBytes=secureRandomBytes):string {
  const plaintext=encoder.encode(JSON.stringify(state));if(plaintext.length>MAX_LOCAL_STATE_BYTES)throw new Error('Local state exceeds limit');
  const nonce=randomChecked(random,24);const key=localKey(identity);
  try{return JSON.stringify({version:1,nonce:bytesToHex(nonce),ciphertext:bytesToHex(xchacha20poly1305(key,nonce,encoder.encode('messenger/local-state/v2/'+identity.userId)).encrypt(plaintext))});}finally{key.fill(0);plaintext.fill(0);}
}
export function openLocalState(identity:DeviceIdentity,sealed:string):unknown {
  if(sealed.length>MAX_LOCAL_STATE_BYTES*2+1024)throw new Error('Sealed state exceeds limit');
  const value=JSON.parse(sealed) as {version:number;nonce:string;ciphertext:string};
  if(value.version!==1||!/^[a-f0-9]{48}$/.test(value.nonce)||typeof value.ciphertext!=='string'||value.ciphertext.length<32||value.ciphertext.length>MAX_LOCAL_STATE_BYTES*2+32||!/^(?:[a-f0-9]{2})+$/.test(value.ciphertext))throw new Error('Invalid sealed local state');
  const key=localKey(identity);let plaintext:Uint8Array|undefined;
  try{plaintext=xchacha20poly1305(key,hexToBytes(value.nonce),encoder.encode('messenger/local-state/v2/'+identity.userId)).decrypt(hexToBytes(value.ciphertext));return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(plaintext));}finally{key.fill(0);plaintext?.fill(0);}
}
