import {z} from 'zod';
import {ed25519} from '@noble/curves/ed25519.js';
import {bytesToHex,hexToBytes} from './crypto.js';
import {userIdFromPublicKey,type DeviceIdentity} from './directory.js';
import {conversationIdSchema,peerIdSchema,roomIdSchema} from './protocol.js';

export const readReceiptSchema=z.object({kind:z.literal('read-receipt'),conversationId:conversationIdSchema,author:roomIdSchema,id:peerIdSchema,type:z.enum(['message','file']),reader:roomIdSchema,hash:roomIdSchema,signature:z.string().regex(/^[a-f0-9]{128}$/)}).strict();
export type ReadReceipt=z.infer<typeof readReceiptSchema>;
function payload(r:Omit<ReadReceipt,'signature'>){return new TextEncoder().encode(JSON.stringify(['lastcall/read-receipt/v1',r.conversationId,r.author,r.id,r.type,r.reader,r.hash]));}
export function signReadReceipt(identity:DeviceIdentity,input:Omit<ReadReceipt,'kind'|'reader'|'signature'>):ReadReceipt {
  const value={kind:'read-receipt' as const,...input,reader:identity.userId};
  return readReceiptSchema.parse({...value,signature:bytesToHex(ed25519.sign(payload(value),hexToBytes(identity.privateKey)))});
}
export function verifyReadReceipt(receipt:ReadReceipt,publicKey:string):boolean {
  try{return userIdFromPublicKey(publicKey)===receipt.reader&&ed25519.verify(hexToBytes(receipt.signature),payload(receipt),hexToBytes(publicKey),{zip215:false});}catch{return false;}
}
