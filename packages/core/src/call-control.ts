import {z} from 'zod';
import {peerIdSchema,roomIdSchema} from './protocol.js';
const time=z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const CALL_INVITE_TTL_MS=30000;
export const callPushEnvelopeSchema=z.object({version:z.literal(1),kind:z.literal('call-invite'),senderId:roomIdSchema,recipientId:roomIdSchema,callId:peerIdSchema,intentId:peerIdSchema,issuedAt:time,expiresAt:time,serverEpoch:peerIdSchema,nonce:z.string().regex(/^[a-f0-9]{48}$/),ciphertext:z.string().min(32).max(600).regex(/^(?:[a-f0-9]{2})+$/)}).strict().refine(value=>value.callId===value.intentId&&value.expiresAt-value.issuedAt===CALL_INVITE_TTL_MS);
export const callPushSchema=z.string().min(1).max(1500).superRefine((value,ctx)=>{try{if(new TextEncoder().encode(value).length>1500||!callPushEnvelopeSchema.safeParse(JSON.parse(value)).success)throw new Error();}catch{ctx.addIssue({code:'custom',message:'Invalid encrypted call invitation'});}}).transform(value=>JSON.stringify(callPushEnvelopeSchema.parse(JSON.parse(value))));
export const callStateSchema=z.object({callerId:roomIdSchema,calleeId:roomIdSchema,callId:peerIdSchema,serverEpoch:peerIdSchema,issuedAt:time,expiresAt:time,state:z.enum(['pending','ringing','accepted','ended','unknown']),revision:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)}).strict();
export type CallState=z.infer<typeof callStateSchema>;
export interface CallInvitation {callId:string;issuedAt:number;expiresAt:number;}
export const callOfferFrameSchema=z.object({type:z.literal('call-offer'),requestId:peerIdSchema,to:roomIdSchema,callId:peerIdSchema,issuedAt:time,expiresAt:time,serverEpoch:peerIdSchema,invite:callPushSchema}).strict();
export const callReceivedFrameSchema=z.object({type:z.literal('call-received'),requestId:peerIdSchema,callerId:roomIdSchema,callId:peerIdSchema,serverEpoch:peerIdSchema}).strict();
export const callActionFrameSchema=z.object({type:z.literal('call-action'),requestId:peerIdSchema,otherId:roomIdSchema,callId:peerIdSchema,serverEpoch:peerIdSchema,issuedAt:time,expiresAt:time,action:z.enum(['accept','decline','cancel','end'])}).strict();
export const callStateGetFrameSchema=z.object({type:z.literal('call-state-get'),requestId:peerIdSchema,otherId:roomIdSchema,callId:peerIdSchema,serverEpoch:peerIdSchema}).strict();
