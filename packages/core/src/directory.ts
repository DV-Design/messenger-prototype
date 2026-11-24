import {callOfferFrameSchema,callReceivedFrameSchema,callActionFrameSchema,callStateGetFrameSchema,callStateSchema,callPushSchema} from './call-control.js';
import { e164PhoneSchema, iceServersSchema, phoneChallengeSchema, serviceCapabilitiesSchema } from './services.js';
import { z } from 'zod';
import { ed25519, x25519 } from '@noble/curves/ed25519.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { bytesToHex, hexToBytes, randomChecked, secureRandomBytes, type RandomBytes } from './crypto.js';
import { conversationIdSchema, peerIdSchema, roomIdSchema } from './protocol.js';
import { MAX_MAILBOX_PAGE_ITEMS, MAX_MAILBOX_PUT_ITEMS, MAX_MAILBOX_RECEIPTS, mailboxAckSchema, mailboxItemSchema, mailboxPutItemSchema, mailboxReceiptSchema, mailboxRefusalSchema } from './mailbox-wire.js';
export interface DeviceIdentity { privateKey:string;publicKey:string;userId:string; }
const utf8=(value:string)=>new TextEncoder().encode(value);
export const usernameSchema=z.string().regex(/^[a-z0-9_]{3,24}$/);
export const displayNameSchema=z.string().min(1).max(48);
/** Address as typed to address as compared and signed; no provider-specific rewriting. */
export function normalizeEmail(input:string):string {return input.trim().toLowerCase();}
// ASCII only and no list/display-name syntax: one address can never become several recipients.
export const emailAddressSchema=z.string().min(3).max(254).regex(/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9-]+(\.[a-z0-9-]+)+$/);
export const emailPurposeSchema=z.enum(['register','recover','bind']);
export const emailLocaleSchema=z.enum(['en','ru']);
export type EmailPurpose=z.infer<typeof emailPurposeSchema>;
export type EmailLocale=z.infer<typeof emailLocaleSchema>;
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
export const inviteCodeSchema = roomIdSchema;
/**
 * Countries the phone itself reports at sign-up (Google Play account, current mobile network,
 * SIM): the server cannot rely on the connection address alone. Only sent to a server that
 * announced `countryHints` in its registration policy; never stored.
 */
export const countryHintsSchema = z.array(z.string().regex(/^[A-Z]{2}$/)).min(1).max(4);
export const COUNTRY_HINTS_HEADER = 'x-lastcall-country-hints';
const inviteTimestampSchema = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const pendingInviteSchema = z.object({ id: peerIdSchema, expiresAt: inviteTimestampSchema }).strict();
const inviteStatusSchema = z.object({
  isAdmin: z.boolean(),
  canInvite: z.boolean(),
  remaining: z.number().int().min(0).max(5),
  resetAt: inviteTimestampSchema,
  active: z.array(pendingInviteSchema).max(35),
  granted: z.array(usernameSchema).max(100),
}).strict();
const createdInviteSchema = pendingInviteSchema.extend({ code: inviteCodeSchema });
export type InviteStatus = z.infer<typeof inviteStatusSchema>;
export type CreatedInvite = z.infer<typeof createdInviteSchema>;
const registrationPolicySchema = z.object({ mode: z.enum(['open', 'invite', 'closed']), countryHints: z.literal(true).optional() }).strict();
export type RegistrationPolicy = z.infer<typeof registrationPolicySchema>['mode'];
export interface RegistrationPolicyInfo { mode: RegistrationPolicy; supportsInvites: boolean; /** The server weighs countries reported by the phone. */ countryHints?: boolean }

/** A correlated refusal of an invitation-management request. */
export class InviteRequestError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'InviteRequestError';
  }
}
export const phoneMatchSchema=z.object({hash:roomIdSchema,user:directoryUserSchema}).strict();
export type PhoneMatch=z.infer<typeof phoneMatchSchema>;
export const MAX_DELIVERY_PEERS=64;
export const wakeIntentSchema=z.object({kind:z.enum(['message','file','call']),intentId:peerIdSchema,expiresAt:z.number().int().positive().max(Number.MAX_SAFE_INTEGER)}).strict();
export type WakeIntent=z.infer<typeof wakeIntentSchema>;
export type WakeKind=WakeIntent['kind'];
export const MAX_PUSH_PREVIEW_BYTES=3000;
export const pushPreviewEnvelopeSchema=z.object({version:z.literal(1),senderId:roomIdSchema,recipientId:roomIdSchema,kind:z.enum(['message','file']),intentId:peerIdSchema,expiresAt:wakeIntentSchema.shape.expiresAt,nonce:z.string().regex(/^[0-9a-f]{48}$/),ciphertext:z.string().min(32).max(2232).regex(/^(?:[0-9a-f]{2})+$/)}).strict();
/** Opaque authenticated content; bounds apply before parsing and after canonical serialization. */
export const pushPreviewSchema=z.string().min(1).max(MAX_PUSH_PREVIEW_BYTES).superRefine((value,ctx)=>{
  try{if(new TextEncoder().encode(value).length>MAX_PUSH_PREVIEW_BYTES||!pushPreviewEnvelopeSchema.safeParse(JSON.parse(value)).success)throw new Error();}
  catch{ctx.addIssue({code:'custom',message:'Invalid encrypted push preview'});}
}).transform(value=>JSON.stringify(pushPreviewEnvelopeSchema.parse(JSON.parse(value))));
export const directoryClientFrameSchema=z.discriminatedUnion('type',[
  callOfferFrameSchema,callReceivedFrameSchema,callActionFrameSchema,callStateGetFrameSchema,
  z.object({type:z.literal('resolve-profile'),publicKey:roomIdSchema,signature:z.string().regex(/^[0-9a-f]{128}$/)}).strict(),
  z.object({type:z.literal('list-users'),requestId:peerIdSchema,cursor:usernameSchema.optional()}).strict(),
  z.object({type:z.literal('services'),requestId:peerIdSchema,callInviteV1:z.literal(true).optional(),deliveryV1:z.literal(true).optional(),mailboxV1:z.literal(true).optional()}).strict(),
  /** Encrypted items for one recipient; the server keeps them until that phone takes them, up to seven days. */
  z.object({type:z.literal('mailbox-put'),requestId:peerIdSchema,to:roomIdSchema,items:z.array(mailboxPutItemSchema).min(1).max(MAX_MAILBOX_PUT_ITEMS)}).strict(),
  z.object({type:z.literal('mailbox-fetch'),requestId:peerIdSchema,after:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional()}).strict(),
  z.object({type:z.literal('mailbox-ack'),requestId:peerIdSchema,items:z.array(mailboxAckSchema).max(MAX_MAILBOX_PAGE_ITEMS),receipts:z.array(mailboxReceiptSchema).max(MAX_MAILBOX_RECEIPTS)}).strict(),
  z.object({type:z.literal('ice'),requestId:peerIdSchema}).strict(),
  z.object({type:z.literal('phone-start'),phone:e164PhoneSchema,requestId:peerIdSchema}).strict(),
  z.object({type:z.literal('phone-verify'),challengeId:peerIdSchema,code:z.string().regex(/^[0-9]{6}$/),requestId:peerIdSchema}).strict(),
  z.object({type:z.literal('phone-discover'),hashes:z.array(roomIdSchema).max(100),requestId:peerIdSchema}).strict(),
  z.object({type:z.literal('push-register'),token:z.string().min(1).max(4096),backgroundSync:z.boolean().optional(),messagePreview:z.boolean().optional(),callInviteV1:z.boolean().optional(),deliveryV1:z.boolean().optional(),requestId:peerIdSchema}).strict(),
  /** The complete list of peers still waiting for this phone's queue. Who and until when, never what. */
  z.object({type:z.literal('delivery-sync'),peers:z.array(z.object({to:roomIdSchema,expiresAt:wakeIntentSchema.shape.expiresAt}).strict()).max(MAX_DELIVERY_PEERS)}).strict(),
  z.object({type:z.literal('wake'),to:roomIdSchema,kind:wakeIntentSchema.shape.kind.optional(),intentId:peerIdSchema.optional(),expiresAt:wakeIntentSchema.shape.expiresAt.optional(),preview:pushPreviewSchema.optional()}).strict().refine(frame=>[frame.kind,frame.intentId,frame.expiresAt].filter(value=>value!==undefined).length%3===0&&(frame.preview===undefined||((frame.kind==='message'||frame.kind==='file')&&pushPreviewSchema.safeParse(frame.preview).success&&JSON.parse(frame.preview).kind===frame.kind)),{message:'Wake metadata must be supplied together; previews require matching message/file intent'}),
  z.object({type:z.literal('authenticate'),publicKey:roomIdSchema,username:usernameSchema,displayName:displayNameSchema,signature:z.string().regex(/^[0-9a-f]{128}$/),emailProof:roomIdSchema.optional(),inviteCode:inviteCodeSchema.optional(),countryHints:countryHintsSchema.optional()}).strict(),
  z.object({type:z.literal('email-start'),purpose:emailPurposeSchema,email:emailAddressSchema,locale:emailLocaleSchema,publicKey:roomIdSchema,signature:z.string().regex(/^[0-9a-f]{128}$/),inviteCode:inviteCodeSchema.optional(),countryHints:countryHintsSchema.optional()}).strict()
    .refine(frame => frame.inviteCode === undefined || frame.purpose === 'register', { message: 'Invitation codes only belong to registration' })
    .refine(frame => frame.countryHints === undefined || frame.purpose === 'register', { message: 'Country hints only belong to registration' }),
  z.object({type:z.literal('email-verify'),challengeId:peerIdSchema,code:z.string().regex(/^[0-9]{6}$/),publicKey:roomIdSchema,signature:z.string().regex(/^[0-9a-f]{128}$/)}).strict(),
  z.object({ type: z.literal('invite-status'), requestId: peerIdSchema }).strict(),
  z.object({ type: z.literal('invite-create'), requestId: peerIdSchema }).strict(),
  z.object({ type: z.literal('invite-revoke'), requestId: peerIdSchema, inviteId: peerIdSchema }).strict(),
  z.object({ type: z.literal('invite-grant'), requestId: peerIdSchema, username: usernameSchema, enabled: z.boolean() }).strict(),
  z.object({type:z.literal('search'),query:z.string().max(48),requestId:peerIdSchema}).strict(),
  z.object({type:z.literal('lookup'),userIds:z.array(roomIdSchema).max(200),requestId:peerIdSchema}).strict(),
  /** `consent`: who of the watched may wake this phone (pushes, calls); without it, all of them, as before 1.0.42. */
  z.object({type:z.literal('watch'),userIds:z.array(roomIdSchema).max(200),identityMovedV1:z.literal(true).optional(),consent:z.array(roomIdSchema).max(200).optional()}).strict().refine(frame=>!frame.consent||frame.consent.every(id=>frame.userIds.includes(id)),{message:'Consent must be a subset of the watched users'}),
  z.object({type:z.literal('connect'),to:roomIdSchema}).strict(),
  z.object({type:z.literal('delete-account'),requestId:peerIdSchema}).strict(),
  z.object({type:z.literal('report'),requestId:peerIdSchema,targetId:roomIdSchema,targetKind:z.enum(['user','group']),conversationId:conversationIdSchema.optional(),reason:z.enum(['spam','harassment','illegal','other']),details:z.string().max(500).optional()}).strict(),
]);
export const directoryServerFrameSchema=z.discriminatedUnion('type',[
  z.object({type:z.literal('call-state'),requestId:peerIdSchema.optional(),...callStateSchema.shape}).strict(),
  z.object({type:z.literal('call-invitation'),invite:callPushSchema}).strict(),
  z.object({type:z.literal('profile'),user:directoryUserSchema.nullable()}).strict(),
  z.object({type:z.literal('email-started'),challengeId:peerIdSchema}).strict(),
  z.object({type:z.literal('email-verified'),proof:roomIdSchema.optional(),user:directoryUserSchema.optional()}).strict(),
  inviteStatusSchema.extend({ type: z.literal('invite-status'), requestId: peerIdSchema }),
  createdInviteSchema.extend({ type: z.literal('invite-created'), requestId: peerIdSchema }),
  z.object({ type: z.literal('invite-updated'), requestId: peerIdSchema }).strict(),
  z.object({type:z.literal('identity-moved'),oldUserId:roomIdSchema,user:directoryUserSchema}).strict(),
  z.object({type:z.literal('users-page'),requestId:peerIdSchema,...directoryPageSchema.shape}).strict(),
  z.object({type:z.literal('services'),requestId:peerIdSchema,capabilities:serviceCapabilitiesSchema}).strict(),
  z.object({type:z.literal('ice'),requestId:peerIdSchema,iceServers:iceServersSchema}).strict(),
  z.object({type:z.literal('phone-challenge'),requestId:peerIdSchema,challenge:phoneChallengeSchema}).strict(),
  z.object({type:z.literal('phone-verified'),requestId:peerIdSchema}).strict(),
  z.object({type:z.literal('phone-matches'),requestId:peerIdSchema,matches:z.array(phoneMatchSchema).max(100)}).strict(),
  z.object({type:z.literal('push-registered'),requestId:peerIdSchema}).strict(),
  z.object({type:z.literal('mailbox-stored'),requestId:peerIdSchema,accepted:z.boolean(),reason:mailboxRefusalSchema.optional()}).strict(),
  z.object({type:z.literal('mailbox'),requestId:peerIdSchema,items:z.array(mailboxItemSchema).max(MAX_MAILBOX_PAGE_ITEMS),users:z.array(directoryUserSchema).max(MAX_MAILBOX_PAGE_ITEMS),receipts:z.array(mailboxReceiptSchema).max(MAX_MAILBOX_RECEIPTS),more:z.boolean()}).strict(),
  z.object({type:z.literal('mailbox-acked'),requestId:peerIdSchema}).strict(),
  /** Something new is waiting: items for this phone or receipts for its own messages. Sent only to phones that asked for the mailbox. */
  z.object({type:z.literal('mailbox-available')}).strict(),
  z.object({type:z.literal('challenge'),challenge:roomIdSchema}).strict(),
  z.object({type:z.literal('ready'),self:directoryUserSchema}).strict(),
  z.object({type:z.literal('results'),requestId:peerIdSchema,users:z.array(directoryUserSchema).max(200)}).strict(),
  z.object({type:z.literal('presence'),user:directoryUserSchema}).strict(),
  z.object({type:z.literal('connect'),from:directoryUserSchema}).strict(),
  z.object({type:z.literal('account-deleted'),requestId:peerIdSchema}).strict(),
  z.object({type:z.literal('report-received'),requestId:peerIdSchema}).strict(),
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

/** Older servers have no policy endpoint. Other failures must not look like an open policy. */
/** The same origin and path; a query a fetch layer may add does not make a response come from elsewhere. */
function withoutQuery(value: string): string {
  return value.split('#')[0]!.split('?')[0]!;
}

export async function fetchRegistrationPolicyInfo(serverUrl: string, countryHints?: string[]): Promise<RegistrationPolicyInfo> {
  const hints = countryHints?.length ? countryHintsSchema.parse(countryHints) : undefined;
  const url = endpointUrl(serverUrl, 'registration-policy').toString();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    // A header, not the query string: nothing about the person goes into URLs or access logs.
    // No `cache` option: React Native's fetch polyfill turns `no-store` into a `?_=<time>` suffix,
    // which the server does not route. The server answers with `Cache-Control: no-store` anyway.
    const response = await fetch(url, { signal: controller.signal, redirect: 'error', ...(hints ? { headers: { [COUNTRY_HINTS_HEADER]: hints.join(',') } } : {}) });
    if (response.redirected || (response.url && withoutQuery(response.url) !== url)) {
      throw new Error('Registration policy request was redirected');
    }
    if (response.status === 404) return { mode: 'open', supportsInvites: false };
    if (!response.ok) throw new Error('Registration policy request failed');
    const body = await response.text();
    if (body.length > 1024) throw new Error('Invalid registration policy');
    const policy = registrationPolicySchema.safeParse(JSON.parse(body));
    if (!policy.success) throw new Error('Invalid registration policy');
    return { ...policy.data, supportsInvites: true };
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchRegistrationPolicy(serverUrl: string): Promise<RegistrationPolicy> {
  return (await fetchRegistrationPolicyInfo(serverUrl)).mode;
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
