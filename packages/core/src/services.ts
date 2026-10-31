import { z } from 'zod';
import { parsePhoneNumberWithError } from 'libphonenumber-js/min';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from './crypto.js';
import { peerIdSchema, roomIdSchema } from './protocol.js';
export const serviceCapabilitiesSchema=z.object({phoneVerification:z.boolean(),push:z.boolean(),relay:z.boolean(),phoneVerified:z.boolean(),callInviteV1:z.boolean().optional(),serverEpoch:peerIdSchema.optional()}).strict();
export type ServiceCapabilities=z.infer<typeof serviceCapabilitiesSchema>;
export const phoneChallengeSchema=z.object({challengeId:peerIdSchema,expiresAt:z.number().finite().nonnegative(),retryAt:z.number().finite().nonnegative()}).strict();
export type PhoneChallenge=z.infer<typeof phoneChallengeSchema>;
export const e164PhoneSchema=z.string().regex(/^\+[1-9][0-9]{1,14}$/);
export const iceServerSchema=z.object({urls:z.union([z.string().min(1).max(2048),z.array(z.string().min(1).max(2048)).min(1).max(10)]),username:z.string().max(512).optional(),credential:z.string().max(4096).optional()}).strict().refine(server=>(Array.isArray(server.urls)?server.urls:[server.urls]).every(url=>/^(?:stuns?|turns?):[^\s]+$/i.test(url)),{message:'Invalid ICE server URL'});
export const iceServersSchema=z.array(iceServerSchema).max(20);
/** Parse the whole input, never extract an apparent phone number from arbitrary text. */
export function normalizePhone(input:string,defaultCountry?:'RU'):string {
  if(typeof input!=='string'||!input.trim()||input.length>80)throw new Error('Invalid phone number');
  try {
    const phone=parsePhoneNumberWithError(input,{defaultCountry,extract:false});
    if(phone.ext||!phone.isValid())throw new Error('Invalid phone number');
    return e164PhoneSchema.parse(phone.number);
  }catch{throw new Error('Invalid phone number');}
}
export function phoneLookupHash(e164:string):string {
  e164PhoneSchema.parse(e164);
  if(normalizePhone(e164)!==e164)throw new Error('Expected canonical E.164 phone number');
  return bytesToHex(sha256(new TextEncoder().encode(JSON.stringify(['lastcall/phone-lookup/v1',e164]))));
}
export const phoneHashSchema=roomIdSchema;
