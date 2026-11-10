import {z} from 'zod';
import {ed25519} from '@noble/curves/ed25519.js';
import {bytesToHex,hexToBytes} from './crypto.js';
import {userIdFromPublicKey,type DeviceIdentity} from './directory.js';
import {OUTBOX_TTL_MS} from './group-sync.js';
import {conversationIdSchema,peerIdSchema,roomIdSchema} from './protocol.js';

/** Every app with the reactions capability can show these. Adding one needs a new session capability, or older apps reject the record. */
export const REACTION_EMOJI=['👍','❤️','😂','😮','😢','🙏'] as const;
export type ReactionEmoji=typeof REACTION_EMOJI[number];
/** A member's signed choice of one reaction on a message or file. No emoji means the reaction was taken back. */
export const messageReactionSchema=z.object({kind:z.literal('message-reaction'),conversationId:conversationIdSchema,author:roomIdSchema,id:peerIdSchema,type:z.enum(['message','file']),reactor:roomIdSchema,emoji:z.enum(REACTION_EMOJI).optional(),revision:z.number().int().positive().max(Number.MAX_SAFE_INTEGER),reactedAt:z.number().int().nonnegative(),expiresAt:z.number().int().nonnegative(),signature:z.string().regex(/^[a-f0-9]{128}$/)}).strict()
  .refine(reaction=>reaction.expiresAt===reaction.reactedAt+OUTBOX_TTL_MS,{message:'Reaction lifetime is fixed'});
export type MessageReaction=z.infer<typeof messageReactionSchema>;
function payload(r:Omit<MessageReaction,'signature'>){return new TextEncoder().encode(JSON.stringify(['lastcall/message-reaction/v1',r.conversationId,r.author,r.id,r.type,r.reactor,r.emoji??null,r.revision,r.reactedAt,r.expiresAt]));}
export function signMessageReaction(identity:DeviceIdentity,input:Omit<MessageReaction,'kind'|'reactor'|'signature'>):MessageReaction {
  const value={kind:'message-reaction' as const,...input,reactor:identity.userId};
  return messageReactionSchema.parse({...value,signature:bytesToHex(ed25519.sign(payload(value),hexToBytes(identity.privateKey)))});
}
export function verifyMessageReaction(reaction:MessageReaction,publicKey:string):boolean {
  try{return userIdFromPublicKey(publicKey)===reaction.reactor&&ed25519.verify(hexToBytes(reaction.signature),payload(reaction),hexToBytes(publicKey),{zip215:false});}catch{return false;}
}
