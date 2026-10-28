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
export const phoneMatchSchema=z.object({hash:roomIdSchema,user:directoryUserSchema}).strict();
export type PhoneMatch=z.infer<typeof phoneMatchSchema>;
export const directoryClientFrameSchema=z.discriminatedUnion('type',[
  z.object({type:z.literal('services'),requestId:peerIdSchema}).strict(),
  z.object({type:z.literal('ice'),requestId:peerIdSchema}).strict(),
  z.object({type:z.literal('phone-start'),phone:e164PhoneSchema,requestId:peerIdSchema}).strict(),
  z.object({type:z.literal('phone-verify'),challengeId:peerIdSchema,code:z.string().regex(/^[0-9]{6}$/),requestId:peerIdSchema}).strict(),
  z.object({type:z.literal('phone-discover'),hashes:z.array(roomIdSchema).max(100),requestId:peerIdSchema}).strict(),
  z.object({type:z.literal('push-register'),token:z.string().min(1).max(4096),requestId:peerIdSchema}).strict(),
  z.object({type:z.literal('wake'),to:roomIdSchema}).strict(),
  z.object({type:z.literal('authenticate'),publicKey:roomIdSchema,username:usernameSchema,displayName:displayNameSchema,signature:z.string().regex(/^[0-9a-f]{128}$/)}).strict(),
  z.object({type:z.literal('search'),query:z.string().max(24),requestId:peerIdSchema}).strict(),
  z.object({type:z.literal('lookup'),userIds:z.array(roomIdSchema).max(200),requestId:peerIdSchema}).strict(),
  z.object({type:z.literal('watch'),userIds:z.array(roomIdSchema).max(200)}).strict(),
  z.object({type:z.literal('connect'),to:roomIdSchema}).strict(),
]);
export const directoryServerFrameSchema=z.discriminatedUnion('type',[
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
