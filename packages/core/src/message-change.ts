import {z} from 'zod';
import {ed25519} from '@noble/curves/ed25519.js';
import {bytesToHex,hexToBytes} from './crypto.js';
import {userIdFromPublicKey,type DeviceIdentity} from './directory.js';
import {OUTBOX_TTL_MS} from './group-sync.js';
import {conversationIdSchema,MAX_TEXT_CHARS,peerIdSchema,roomIdSchema} from './protocol.js';

/** An author's signed request to replace or remove their own message on recipients' devices. */
export const messageChangeSchema=z.object({kind:z.literal('message-change'),conversationId:conversationIdSchema,author:roomIdSchema,id:peerIdSchema,type:z.enum(['message','file']),action:z.enum(['edit','delete']),revision:z.number().int().positive().max(Number.MAX_SAFE_INTEGER),text:z.string().min(1).max(MAX_TEXT_CHARS).optional(),changedAt:z.number().int().nonnegative(),expiresAt:z.number().int().nonnegative(),signature:z.string().regex(/^[a-f0-9]{128}$/)}).strict()
  .refine(change=>change.action==='edit'?change.type==='message'&&change.text!==undefined:change.text===undefined,{message:'Edit requires message text; delete carries none'})
  .refine(change=>change.expiresAt===change.changedAt+OUTBOX_TTL_MS,{message:'Change lifetime is fixed'});
export type MessageChange=z.infer<typeof messageChangeSchema>;
function payload(c:Omit<MessageChange,'signature'>){return new TextEncoder().encode(JSON.stringify(['lastcall/message-change/v1',c.conversationId,c.author,c.id,c.type,c.action,c.revision,c.text??null,c.changedAt,c.expiresAt]));}
export function signMessageChange(identity:DeviceIdentity,input:Omit<MessageChange,'kind'|'author'|'signature'>):MessageChange {
  const value={kind:'message-change' as const,...input,author:identity.userId};
  return messageChangeSchema.parse({...value,signature:bytesToHex(ed25519.sign(payload(value),hexToBytes(identity.privateKey)))});
}
export function verifyMessageChange(change:MessageChange,publicKey:string):boolean {
  try{return userIdFromPublicKey(publicKey)===change.author&&ed25519.verify(hexToBytes(change.signature),payload(change),hexToBytes(publicKey),{zip215:false});}catch{return false;}
}
