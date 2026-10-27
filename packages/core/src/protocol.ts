import { z } from 'zod';
export const MAX_FILE_BYTES = 5 * 1024 * 1024;
export const FILE_CHUNK_BYTES = 12 * 1024;
export const MAX_TEXT_CHARS = 4000;
export const MAX_WIRE_BYTES = 96 * 1024;
export const MAX_FILES = 4;
const hex = (length: number) => z.string().regex(new RegExp(`^[0-9a-f]{${length}}$`));
export const roomIdSchema = hex(64);
export const peerIdSchema = hex(32);
export const sealedEnvelopeSchema = z.object({version:z.literal(1),nonce:hex(48),ciphertext:z.string().min(32).max(90 * 1024).regex(/^(?:[0-9a-f]{2})+$/)}).strict();
export const clientFrameSchema = z.discriminatedUnion('type', [
  z.object({type:z.literal('join'), roomId:roomIdSchema, peerId:peerIdSchema}).strict(),
  z.object({type:z.literal('signal'),payload:sealedEnvelopeSchema}).strict(),
  z.object({type:z.literal('leave')}).strict(),
]);
export const serverFrameSchema = z.discriminatedUnion('type', [
  z.object({type:z.literal('joined'),roomId:roomIdSchema,peerId:peerIdSchema,role:z.enum(['initiator','responder']),peerPresent:z.boolean()}).strict(),
  z.object({type:z.literal('peer-joined'),peerId:peerIdSchema}).strict(),
  z.object({type:z.literal('peer-left'),peerId:peerIdSchema}).strict(),
  z.object({type:z.literal('signal'),from:peerIdSchema,payload:sealedEnvelopeSchema}).strict(),
  z.object({type:z.literal('error'),code:z.string().max(100),message:z.string().max(1000)}).strict(),
]);
export type SealedEnvelope = z.infer<typeof sealedEnvelopeSchema>;
export type ClientFrame = z.infer<typeof clientFrameSchema>;
export type ServerFrame = z.infer<typeof serverFrameSchema>;
const id = peerIdSchema;
export const conversationIdSchema=z.string().regex(/^(?:dm:[0-9a-f]{64}|group:[0-9a-f]{32})$/);
const conversationId=conversationIdSchema.optional();
export const signalBodySchema = z.discriminatedUnion('kind',[
  z.object({kind:z.literal('description'),description:z.object({type:z.enum(['offer','answer']),sdp:z.string().max(40000)}).strict()}).strict(),
  z.object({kind:z.literal('candidate'),candidate:z.object({candidate:z.string().max(3000),sdpMid:z.string().nullable().optional(),sdpMLineIndex:z.number().int().min(0).max(100).nullable().optional(),usernameFragment:z.string().max(300).nullable().optional()}).strict()}).strict(),
  z.object({kind:z.literal('renegotiate')}).strict(),
  z.object({kind:z.literal('call-invite'),callId:id,video:z.boolean()}).strict(),
  z.object({kind:z.literal('call-accept'),callId:id}).strict(),
  z.object({kind:z.literal('call-end'),callId:id}).strict(),
]);
export type SignalBody = z.infer<typeof signalBodySchema>;
export const dataFrameSchema = z.discriminatedUnion('kind',[
  z.object({kind:z.literal('text-ack'),id,conversationId}).strict(),
  z.object({kind:z.literal('application'),id,body:z.string().max(16000)}).strict(),
  z.object({kind:z.literal('text'),id,conversationId,text:z.string().min(1).max(MAX_TEXT_CHARS),timestamp:z.number().finite().nonnegative()}).strict(),
  z.object({kind:z.literal('file-start'),id,conversationId,name:z.string().min(1).max(255),mime:z.string().max(127),size:z.number().int().min(0).max(MAX_FILE_BYTES)}).strict(),
  z.object({kind:z.literal('file-chunk'),id,offset:z.number().int().min(0).max(MAX_FILE_BYTES),hex:z.string().max(FILE_CHUNK_BYTES*2).regex(/^(?:[0-9a-f]{2})+$/)}).strict(),
  z.object({kind:z.literal('file-end'),id}).strict(),
  z.object({kind:z.literal('file-ack'),id}).strict(),
]);
export type DataFrame = z.infer<typeof dataFrameSchema>;
