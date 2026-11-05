import {z} from 'zod';
import {peerIdSchema} from './protocol.js';

export const CALL_CAPTION_TEXT_MAX=400;
export const captionLanguageSchema=z.string().regex(/^[a-z]{2,3}$/);

/**
 * Live captions travel only over the call's end-to-end encrypted data channel and are never saved.
 * `enabled` is also consent: a phone recognizes its owner's speech only while both sides have enabled.
 */
export const callCaptionStateSchema=z.object({
  kind:z.literal('call-caption-state'),callId:peerIdSchema,enabled:z.boolean(),language:captionLanguageSchema,
  speech:z.enum(['ready','preparing','unavailable']),
}).strict();
export const callCaptionSchema=z.object({
  kind:z.literal('call-caption'),callId:peerIdSchema,language:captionLanguageSchema,
  segment:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),revision:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  final:z.boolean(),text:z.string().max(CALL_CAPTION_TEXT_MAX),
}).strict();
export const callCaptionFrameSchema=z.discriminatedUnion('kind',[callCaptionStateSchema,callCaptionSchema]);
export type CallCaptionState=z.infer<typeof callCaptionStateSchema>;
export type CallCaption=z.infer<typeof callCaptionSchema>;
export type CallCaptionFrame=z.infer<typeof callCaptionFrameSchema>;
