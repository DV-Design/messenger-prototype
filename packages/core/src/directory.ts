import { e164PhoneSchema, iceServersSchema, phoneChallengeSchema, serviceCapabilitiesSchema } from './services.js';
import { z } from 'zod';
import { ed25519, x25519 } from '@noble/curves/ed25519.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { bytesToHex, hexToBytes, randomChecked, secureRandomBytes, type RandomBytes } from './crypto.js';
import { peerIdSchema, roomIdSchema } from './protocol.js';
export interface DeviceIdentity { privateKey:string;publicKey:string;userId:string; }
const utf8=(value:string)=>new TextEncoder().encode(value);
export const usernameSchema=z.string().regex(/^[a-z0-9_]{3,24}$/);
export const displayNameSchema=z.string().min(1).max(48);
export function userIdFromPublicKey(publicKey:string):string {
  roomIdSchema.parse(publicKey);const point=ed25519.Point.fromBytes(hexToBytes(publicKey));point.assertValidity();
  if(point.isSmallOrder()||!point.isTorsionFree())throw new Error('Invalid identity public key');
  return bytesToHex(sha256(hexToBytes(publicKey)));
}
export function createDeviceIdentity(random:RandomBytes=secureRandomBytes):DeviceIdentity {
  const privateKey=bytesToHex(randomChecked(random,32));const publicKey=bytesToHex(ed25519.getPublicKey(hexToBytes(privateKey)));
  return {privateKey,publicKey,userId:userIdFromPublicKey(publicKey)};
}
export function validateDeviceIdentity(identity:DeviceIdentity):void {
  roomIdSchema.parse(identity.privateKey);
  if(bytesToHex(ed25519.getPublicKey(hexToBytes(identity.privateKey)))!==identity.publicKey||userIdFromPublicKey(identity.publicKey)!==identity.userId)throw new Error('Identity seed and public key mismatch');
}
export function authenticationPayload(challenge:string,publicKey:string,username:string,displayName:string):Uint8Array {
  roomIdSchema.parse(challenge);userIdFromPublicKey(publicKey);usernameSchema.parse(username);displayNameSchema.parse(displayName);
  return utf8(JSON.stringify(['messenger-directory/v1',challenge,publicKey,username,displayName]));
}
export function signAuthentication(identity:DeviceIdentity,challenge:string,username:string,displayName:string):string {
  validateDeviceIdentity(identity);return bytesToHex(ed25519.sign(authenticationPayload(challenge,identity.publicKey,username,displayName),hexToBytes(identity.privateKey)));
}
export function verifyAuthentication(publicKey:string,challenge:string,username:string,displayName:string,signature:string):boolean {
  try {if(!/^[0-9a-f]{128}$/.test(signature))return false;return ed25519.verify(hexToBytes(signature),authenticationPayload(challenge,publicKey,username,displayName),hexToBytes(publicKey),{zip215:false});}catch{return false;}
}
/** Separate signature purpose: resolving an existing installation never registers a profile. */
export function profileResolvePayload(challenge:string,publicKey:string):Uint8Array {
  roomIdSchema.parse(challenge);userIdFromPublicKey(publicKey);
  return utf8(JSON.stringify(['lastcall/profile-resolve/v1',challenge,publicKey]));
}
export function signProfileResolve(identity:DeviceIdentity,challenge:string):string {
  validateDeviceIdentity(identity);return bytesToHex(ed25519.sign(profileResolvePayload(challenge,identity.publicKey),hexToBytes(identity.privateKey)));
}
export function verifyProfileResolve(publicKey:string,challenge:string,signature:string):boolean {
  try{if(!/^[0-9a-f]{128}$/.test(signature))return false;return ed25519.verify(hexToBytes(signature),profileResolvePayload(challenge,publicKey),hexToBytes(publicKey),{zip215:false});}catch{return false;}
}
export function directConversationId(first:string,second:string):string {
  roomIdSchema.parse(first);roomIdSchema.parse(second);if(first===second)throw new Error('Cannot create conversation with self');
  return 'dm:'+bytesToHex(sha256(utf8(JSON.stringify(['messenger-pair/v1',...[first,second].sort()]))));
}
export function conversationInvite(identity:DeviceIdentity,remotePublicKey:string):string {
  validateDeviceIdentity(identity);const remote=userIdFromPublicKey(remotePublicKey);const conversationId=directConversationId(identity.userId,remote);
  const secret=ed25519.utils.toMontgomerySecret(hexToBytes(identity.privateKey));
  const shared=x25519.getSharedSecret(secret,ed25519.utils.toMontgomery(hexToBytes(remotePublicKey)));
  try{return bytesToHex(hkdf(sha256,shared,utf8('messenger-pair/hkdf/v1'),utf8(conversationId),32));}finally{secret.fill(0);shared.fill(0);}
}
export const directoryUserSchema=z.object({userId:roomIdSchema,publicKey:roomIdSchema,username:usernameSchema,displayName:displayNameSchema,online:z.boolean(),lastSeen:z.number().finite().nonnegative()}).strict().refine(user=>{try{return userIdFromPublicKey(user.publicKey)===user.userId;}catch{return false;}},{message:'User ID does not match public key'});
export type DirectoryUser=z.infer<typeof directoryUserSchema>;
export const directoryPageSchema=z.object({users:z.array(directoryUserSchema).max(100),nextCursor:usernameSchema.optional()}).strict();
export type DirectoryPage=z.infer<typeof directoryPageSchema>;
export const phoneMatchSchema=z.object({hash:roomIdSchema,user:directoryUserSchema}).strict();
export type PhoneMatch=z.infer<typeof phoneMatchSchema>;
export const wakeIntentSchema=z.object({kind:z.enum(['message','file','call']),intentId:peerIdSchema,expiresAt:z.number().int().positive().max(Number.MAX_SAFE_INTEGER)}).strict();
export type WakeIntent=z.infer<typeof wakeIntentSchema>;
export type WakeKind=WakeIntent['kind'];
export const directoryClientFrameSchema=z.discriminatedUnion('type',[
  z.object({type:z.literal('resolve-profile'),publicKey:roomIdSchema,signature:z.string().regex(/^[0-9a-f]{128}$/)}).strict(),
  z.object({type:z.literal('list-users'),requestId:peerIdSchema,cursor:usernameSchema.optional()}).strict(),
  z.object({type:z.literal('services'),requestId:peerIdSchema}).strict(),
  z.object({type:z.literal('ice'),requestId:peerIdSchema}).strict(),
  z.object({type:z.literal('phone-start'),phone:e164PhoneSchema,requestId:peerIdSchema}).strict(),
  z.object({type:z.literal('phone-verify'),challengeId:peerIdSchema,code:z.string().regex(/^[0-9]{6}$/),requestId:peerIdSchema}).strict(),
  z.object({type:z.literal('phone-discover'),hashes:z.array(roomIdSchema).max(100),requestId:peerIdSchema}).strict(),
  z.object({type:z.literal('push-register'),token:z.string().min(1).max(4096),backgroundSync:z.boolean().optional(),requestId:peerIdSchema}).strict(),
  z.object({type:z.literal('wake'),to:roomIdSchema,kind:wakeIntentSchema.shape.kind.optional(),intentId:peerIdSchema.optional(),expiresAt:wakeIntentSchema.shape.expiresAt.optional()}).strict().refine(frame=>[frame.kind,frame.intentId,frame.expiresAt].filter(value=>value!==undefined).length%3===0,{message:'Wake metadata must be supplied together'}),
  z.object({type:z.literal('authenticate'),publicKey:roomIdSchema,username:usernameSchema,displayName:displayNameSchema,signature:z.string().regex(/^[0-9a-f]{128}$/)}).strict(),
  z.object({type:z.literal('search'),query:z.string().max(48),requestId:peerIdSchema}).strict(),
  z.object({type:z.literal('lookup'),userIds:z.array(roomIdSchema).max(200),requestId:peerIdSchema}).strict(),
  z.object({type:z.literal('watch'),userIds:z.array(roomIdSchema).max(200)}).strict(),
  z.object({type:z.literal('connect'),to:roomIdSchema}).strict(),
]);
export const directoryServerFrameSchema=z.discriminatedUnion('type',[
  z.object({type:z.literal('profile'),user:directoryUserSchema.nullable()}).strict(),
  z.object({type:z.literal('users-page'),requestId:peerIdSchema,...directoryPageSchema.shape}).strict(),
  z.object({type:z.literal('services'),requestId:peerIdSchema,capabilities:serviceCapabilitiesSchema}).strict(),
  z.object({type:z.literal('ice'),requestId:peerIdSchema,iceServers:iceServersSchema}).strict(),
  z.object({type:z.literal('phone-challenge'),requestId:peerIdSchema,challenge:phoneChallengeSchema}).strict(),
  z.object({type:z.literal('phone-verified'),requestId:peerIdSchema}).strict(),
  z.object({type:z.literal('phone-matches'),requestId:peerIdSchema,matches:z.array(phoneMatchSchema).max(100)}).strict(),
  z.object({type:z.literal('push-registered'),requestId:peerIdSchema}).strict(),
  z.object({type:z.literal('challenge'),challenge:roomIdSchema}).strict(),
  z.object({type:z.literal('ready'),self:directoryUserSchema}).strict(),
  z.object({type:z.literal('results'),requestId:peerIdSchema,users:z.array(directoryUserSchema).max(200)}).strict(),
  z.object({type:z.literal('presence'),user:directoryUserSchema}).strict(),
  z.object({type:z.literal('connect'),from:directoryUserSchema}).strict(),
  z.object({type:z.literal('error'),code:z.string().max(100),message:z.string().max(1000),requestId:peerIdSchema.optional()}).strict(),
]);
export type DirectoryClientFrame=z.infer<typeof directoryClientFrameSchema>;
export type DirectoryServerFrame=z.infer<typeof directoryServerFrameSchema>;
/** A base path is a gateway namespace, not a file to replace with URL resolution. */
export function endpointUrl(base:string,path:string):URL {
  const url=new URL(base);
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash)throw new Error('Expected http(s) base URL without credentials, query or fragment');
  if(!/^\/?[a-z][a-z0-9/-]*$/i.test(path)||path.includes('..'))throw new Error('Invalid endpoint path');
  url.pathname=url.pathname.replace(/\/+$/,'')+'/'+path.replace(/^\//,'');return url;
}

/** Short-lived challenge connection; network/protocol failures are never interpreted as unregistered. */
export async function resolveDeviceProfile(serverUrl:string,identity:DeviceIdentity):Promise<DirectoryUser|null> {
  validateDeviceIdentity(identity);const url=endpointUrl(serverUrl,'directory');url.protocol=url.protocol==='https:'?'wss:':'ws:';
  return new Promise((resolve,reject)=>{
    const socket=new WebSocket(url.toString());let challenged=false;let finished=false;
    const finish=(error?:Error,user:DirectoryUser|null=null)=>{
      if(finished)return;finished=true;clearTimeout(timer);socket.onmessage=null;socket.onerror=null;socket.onclose=null;socket.onopen=null;
      try{socket.close();}catch{/* Some native adapters reject close while connecting. */}
      if(error)reject(error);else resolve(user?{...user}:null);
    };
    const timer=setTimeout(()=>finish(new Error('Profile resolution timed out')),15000);
    socket.onmessage=event=>{
      if(finished)return;
      try{
        if(typeof event.data!=='string'||event.data.length>16*1024)throw new Error('Invalid profile resolution frame');
        const frame=directoryServerFrameSchema.parse(JSON.parse(event.data));
        if(frame.type==='challenge'){
          if(challenged)throw new Error('Repeated profile resolution challenge');challenged=true;
          socket.send(JSON.stringify(directoryClientFrameSchema.parse({type:'resolve-profile',publicKey:identity.publicKey,signature:signProfileResolve(identity,frame.challenge)})));
        }else if(frame.type==='profile'){
          if(!challenged)throw new Error('Profile response before challenge');
          if(frame.user&&(frame.user.userId!==identity.userId||frame.user.publicKey!==identity.publicKey))throw new Error('Resolved profile identity mismatch');
          finish(undefined,frame.user);
        }else if(frame.type==='error'){finish(new Error(`Profile resolution failed: ${frame.code}`));}
        else throw new Error('Unexpected profile resolution response');
      }catch(error){finish(error instanceof Error?error:new Error('Invalid profile resolution response'));}
    };
    socket.onerror=()=>finish(new Error('Profile resolution connection failed'));
    socket.onclose=()=>finish(new Error('Profile resolution disconnected'));
  });
}
