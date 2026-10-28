import {z} from 'zod';
import {ed25519} from '@noble/curves/ed25519.js';
import {sha256} from '@noble/hashes/sha2.js';
import {bytesToHex,hexToBytes} from './crypto.js';
import {directoryUserSchema,userIdFromPublicKey,type DeviceIdentity} from './directory.js';
import {peerIdSchema,roomIdSchema} from './protocol.js';
export const OUTBOX_TTL_MS=7*24*60*60*1000;
const signature=z.string().regex(/^[a-f0-9]{128}$/);
export const groupDefinitionSchema=z.object({kind:z.literal('group-definition'),id:z.string().regex(/^group:[a-f0-9]{32}$/),title:z.string().min(1).max(64),creatorId:roomIdSchema,members:z.array(directoryUserSchema).min(2).max(8),signature:signature.optional()}).strict();
export type GroupDefinition=z.infer<typeof groupDefinitionSchema>;
const originSchema=z.object({kind:z.literal('group-origin'),groupId:z.string().regex(/^group:[a-f0-9]{32}$/),author:roomIdSchema,id:peerIdSchema,type:z.enum(['message','file']),timestamp:z.number().int().nonnegative(),expiresAt:z.number().int().positive(),hash:roomIdSchema,signature}).strict();
export type GroupOrigin=z.infer<typeof originSchema>;
export const receiptSchema=z.object({kind:z.literal('group-receipt'),groupId:z.string().regex(/^group:[a-f0-9]{32}$/),author:roomIdSchema,id:peerIdSchema,recipient:roomIdSchema,signature}).strict();
export type GroupReceipt=z.infer<typeof receiptSchema>;
const utf8=(s:string)=>new TextEncoder().encode(s);
function sign(identity:DeviceIdentity,value:unknown){return bytesToHex(ed25519.sign(utf8(JSON.stringify(value)),hexToBytes(identity.privateKey)));}
function verify(publicKey:string,signature:string,value:unknown){try{return ed25519.verify(hexToBytes(signature),utf8(JSON.stringify(value)),hexToBytes(publicKey),{zip215:false});}catch{return false;}}
function rosterPayload(g:GroupDefinition){return ['lastcall/group-roster/v1',g.id,g.title,g.creatorId,...g.members.map(m=>[m.userId,m.publicKey,m.username,m.displayName])];}
export function signGroupDefinition(identity:DeviceIdentity,group:GroupDefinition):GroupDefinition {const g=groupDefinitionSchema.parse(group);if(g.creatorId!==identity.userId)throw new Error('Group creator mismatch');return {...g,signature:sign(identity,rosterPayload(g))};}
export function verifyGroupDefinition(group:GroupDefinition):boolean {const creator=group.members.find(m=>m.userId===group.creatorId);return !!creator&&!!group.signature&&new Set(group.members.map(m=>m.userId)).size===group.members.length&&verify(creator.publicKey,group.signature,rosterPayload(group));}
export function contentHash(type:'message'|'file',value:string|Uint8Array,name='',mime=''):string {if(type==='message')return bytesToHex(sha256(utf8(JSON.stringify(['lastcall/text/v1',value]))));const data=value as Uint8Array;return bytesToHex(sha256(utf8(JSON.stringify(['lastcall/file/v1',name,mime,data.length,bytesToHex(sha256(data))]))));}
function originPayload(o:Omit<GroupOrigin,'signature'>|GroupOrigin){return ['lastcall/group-origin/v1',o.groupId,o.author,o.id,o.type,o.timestamp,o.expiresAt,o.hash];}
export function signGroupOrigin(identity:DeviceIdentity,input:Omit<GroupOrigin,'kind'|'author'|'signature'>):GroupOrigin {const value={kind:'group-origin' as const,...input,author:identity.userId};return originSchema.parse({...value,signature:sign(identity,originPayload(value))});}
export function parseGroupOrigin(metadata:string,group:GroupDefinition):GroupOrigin {const o=originSchema.parse(JSON.parse(metadata));const member=group.members.find(m=>m.userId===o.author);if(!verifyGroupDefinition(group)||!member||o.groupId!==group.id||o.expiresAt-o.timestamp!==OUTBOX_TTL_MS||!verify(member.publicKey,o.signature,originPayload(o)))throw new Error('Invalid signed group origin');return o;}
function receiptPayload(r:Omit<GroupReceipt,'signature'>|GroupReceipt){return ['lastcall/group-receipt/v1',r.groupId,r.author,r.id,r.recipient];}
export function signGroupReceipt(identity:DeviceIdentity,origin:GroupOrigin):GroupReceipt {const r={kind:'group-receipt' as const,groupId:origin.groupId,author:origin.author,id:origin.id,recipient:identity.userId};return {...r,signature:sign(identity,receiptPayload(r))};}
export function verifyGroupReceipt(receipt:GroupReceipt,group:GroupDefinition):boolean {const member=group.members.find(m=>m.userId===receipt.recipient);return !!member&&userIdFromPublicKey(member.publicKey)===receipt.recipient&&group.id===receipt.groupId&&group.members.some(m=>m.userId===receipt.author)&&verify(member.publicKey,receipt.signature,receiptPayload(receipt));}
export function attachmentKey(author:string,id:string,conversationId:string){return bytesToHex(sha256(utf8(JSON.stringify(['lastcall/attachment/v1',author,id,conversationId]))));}
