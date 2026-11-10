import {afterEach,describe,expect,it,vi} from 'vitest';
import {createDeviceIdentity,type DeviceIdentity,type DirectoryUser} from './directory.js';
import {MessengerClient,OUTBOX_TTL_MS} from './messenger.js';
import {signGroupDefinition} from './group-sync.js';
import {messageReactionSchema,signMessageReaction,verifyMessageReaction,type ReactionEmoji} from './message-reaction.js';
import {openLocalState} from './persistence.js';
const alice=createDeviceIdentity(n=>new Uint8Array(n).fill(131)),bob=createDeviceIdentity(n=>new Uint8Array(n).fill(132)),carol=createDeviceIdentity(n=>new Uint8Array(n).fill(133));
const user=(i:DeviceIdentity,name:string):DirectoryUser=>({userId:i.userId,publicKey:i.publicKey,username:name,displayName:name,online:false,lastSeen:1});
function storage(){let sealed:string|null=null;const blobs=new Map<string,string>();return {blobs,get sealed(){return sealed;},loadState:async()=>sealed,saveState:vi.fn(async(s:string)=>{sealed=s;}),saveAttachment:async(k:string,s:string)=>{blobs.set(k,s);},loadAttachment:async(k:string)=>blobs.get(k)??null,deleteAttachment:vi.fn(async(k:string)=>{blobs.delete(k);})};}
const clients:MessengerClient[]=[];
let seed=0;
function make(identity=alice,store=storage()){const c=new MessengerClient({identity,serverUrl:'https://example.com',username:'tester',displayName:'Tester',...store,randomBytes:size=>{const b=new Uint8Array(size);new DataView(b.buffer).setUint32(0,++seed);return b;}});clients.push(c);return {c,i:c as any,store};}
afterEach(()=>{for(const c of clients.splice(0))c.disconnect();});
const chat=(c:MessengerClient,id:string)=>c.getSnapshot().conversations.find(x=>x.id===id)!;
const messageId='cd'.repeat(16);
const textFrame=(id:string,text='hello')=>({id:messageId,text,from:'peer' as const,timestamp:Date.now(),status:'received' as const,conversationId:id});
function connectedPair(reactions=true){const sent:any[]=[];return {sent,pair:{session:{getSnapshot:()=>({status:'connected',callState:'idle',files:[]}),sendApplication:async(p:unknown)=>{sent.push(p);},sendText:async(_text:string)=>{},supportsMessageChanges:()=>true,supportsReactions:()=>reactions,disconnect:vi.fn()},attempt:0,flushing:false,notified:true,lastUsed:Date.now(),lastSent:new Map(),definitions:new Set()}};}
/** Bob holds a message from Alice in their direct chat. */
async function received(){const b=make(bob);const id=await b.c.addContact(user(alice,'alice'));await b.i.receiveMessage(alice.userId,textFrame(id));return {b,id};}
function signed(id:string,revision:number,emoji?:ReactionEmoji,identity=alice,reactedAt=Date.now(),author=bob.userId){return signMessageReaction(identity,{conversationId:id,author,id:messageId,type:'message',emoji,revision,reactedAt,expiresAt:reactedAt+OUTBOX_TTL_MS});}

describe('signed reaction',()=>{
 const base={conversationId:'dm:'+'ab'.repeat(32),author:bob.userId,id:messageId,type:'message' as const,emoji:'👍' as const,revision:1,reactedAt:1000,expiresAt:1000+OUTBOX_TTL_MS};
 it('verifies only the reactor and only the signed content',()=>{
  const r=signMessageReaction(alice,base);expect(r.reactor).toBe(alice.userId);expect(verifyMessageReaction(r,alice.publicKey)).toBe(true);expect(verifyMessageReaction(r,bob.publicKey)).toBe(false);
  expect(verifyMessageReaction({...r,emoji:'❤️'},alice.publicKey)).toBe(false);expect(verifyMessageReaction({...r,emoji:undefined},alice.publicKey)).toBe(false);expect(verifyMessageReaction({...r,revision:2},alice.publicKey)).toBe(false);
 });
 it('accepts only the fixed emoji set and lifetime',()=>{
  const r=signMessageReaction(alice,base);expect(()=>messageReactionSchema.parse({...r,emoji:'BUY NOW'})).toThrow();expect(()=>messageReactionSchema.parse({...r,expiresAt:r.expiresAt+1})).toThrow();expect(()=>messageReactionSchema.parse({...r,extra:1})).toThrow();
  expect(messageReactionSchema.parse(signMessageReaction(alice,{...base,emoji:undefined})).emoji).toBeUndefined();
 });
});

describe('reacting',()=>{
 it('sets, replaces and removes one reaction, and survives restart',async()=>{
  const {b,id}=await received();const record={id:messageId,type:'message' as const,author:alice.userId};
  await b.c.react(id,record,'👍');expect(chat(b.c,id).messages[0]!.reactions).toEqual([{userId:bob.userId,emoji:'👍'}]);
  await b.c.react(id,record,'❤️');expect(chat(b.c,id).messages[0]!.reactions).toEqual([{userId:bob.userId,emoji:'❤️'}]);expect(b.i.conversations.get(id).reactions).toHaveLength(1);expect(b.i.conversations.get(id).reactions[0].revision).toBe(2);
  await b.c.flushState();const stored=openLocalState(bob,b.store.sealed!) as any;expect(stored.version).toBe(7);expect(stored.conversations[0].reactions).toHaveLength(1);expect(stored.conversations[0].messages[0]).not.toHaveProperty('reactions');
  b.c.disconnect();const restored=make(bob,b.store);await restored.c.flushState();expect(chat(restored.c,id).messages[0]!.reactions).toEqual([{userId:bob.userId,emoji:'❤️'}]);
  await restored.c.react(id,record,undefined);expect(chat(restored.c,id).messages[0]!.reactions).toBeUndefined();expect(restored.i.conversations.get(id).reactions[0]).toMatchObject({revision:3});expect(restored.i.conversations.get(id).reactions[0].emoji).toBeUndefined();
 });
 it('refuses an unknown message and does nothing for the same choice',async()=>{
  const {b,id}=await received();await expect(b.c.react(id,{id:'ee'.repeat(16),type:'message',author:alice.userId},'👍')).rejects.toThrow('Unknown message');
  await b.c.react(id,{id:messageId,type:'message',author:alice.userId},undefined);expect(b.i.conversations.get(id).reactions).toBeUndefined();
 });
 it('rolls back when it cannot be saved',async()=>{
  const {b,id}=await received();await b.c.flushState();b.store.saveState.mockRejectedValueOnce(new Error('disk'));
  await expect(b.c.react(id,{id:messageId,type:'message',author:alice.userId},'👍')).rejects.toThrow();expect(chat(b.c,id).messages[0]!.reactions).toBeUndefined();
 });
 it('goes once to a peer that supports reactions, waits for one that does not, and never echoes the peer\'s own',async()=>{
  const {b,id}=await received();await b.c.react(id,{id:messageId,type:'message',author:alice.userId},'😂');
  const old=connectedPair(false);b.i.pairs.set(alice.userId,old.pair);await b.i.flushPeer(alice.userId);expect(old.sent.filter(x=>x.kind==='message-reaction')).toHaveLength(0);
  const fresh=connectedPair(true);b.i.pairs.set(alice.userId,fresh.pair);await b.i.flushPeer(alice.userId);await b.i.flushPeer(alice.userId);expect(fresh.sent.filter(x=>x.kind==='message-reaction')).toHaveLength(1);
  const a=make();const dm=await a.c.addContact(user(bob,'bob'));a.i.conversations.get(dm).messages.push({id:messageId,text:'hello',from:alice.userId,timestamp:Date.now(),status:'delivered',conversationId:dm,expiresAt:Date.now()+OUTBOX_TTL_MS});
  await a.i.receiveApplication(bob.userId,fresh.sent.find(x=>x.kind==='message-reaction'));expect(chat(a.c,dm).messages[0]!.reactions).toEqual([{userId:bob.userId,emoji:'😂'}]);
  const back=connectedPair(true);a.i.pairs.set(bob.userId,back.pair);await a.i.flushPeer(bob.userId);expect(back.sent.filter(x=>x.kind==='message-reaction')).toHaveLength(0);
 });
});

describe('receiving a reaction',()=>{
 it('keeps the newest revision per member',async()=>{
  const {b,id}=await received();
  await b.i.receiveApplication(alice.userId,signed(id,2,'❤️',alice,Date.now(),alice.userId));await b.i.receiveApplication(alice.userId,signed(id,1,'👍',alice,Date.now(),alice.userId));
  expect(chat(b.c,id).messages[0]!.reactions).toEqual([{userId:alice.userId,emoji:'❤️'}]);
  await b.i.receiveApplication(alice.userId,signed(id,3,undefined,alice,Date.now(),alice.userId));expect(chat(b.c,id).messages[0]!.reactions).toBeUndefined();
 });
 it('rejects forged, foreign and future reactions; ignores expired, blocked and unknown targets',async()=>{
  const {b,id}=await received();
  await expect(b.i.receiveApplication(alice.userId,{...signed(id,1,'👍',alice,Date.now(),alice.userId),emoji:'❤️'})).rejects.toThrow('Invalid reaction');
  await expect(b.i.receiveApplication(alice.userId,signed(id,1,'👍',carol,Date.now(),alice.userId))).rejects.toThrow('Invalid reaction');
  await expect(b.i.receiveApplication(alice.userId,signed(id,1,'👍',alice,Date.now()+120000,alice.userId))).rejects.toThrow('future');
  await b.i.receiveApplication(alice.userId,signed(id,1,'👍',alice,Date.now()-OUTBOX_TTL_MS-1,alice.userId));
  await b.i.receiveApplication(alice.userId,signed(id,1,"👍",alice,Date.now(),alice.userId));expect(chat(b.c,id).messages[0]!.reactions).toHaveLength(1);
  const ghost=signMessageReaction(alice,{conversationId:id,author:alice.userId,id:'ee'.repeat(16),type:'message',emoji:'👍',revision:1,reactedAt:Date.now(),expiresAt:Date.now()+OUTBOX_TTL_MS});await b.i.receiveApplication(alice.userId,ghost);expect(b.i.conversations.get(id).reactions).toHaveLength(1);
  await b.c.blockContact(alice.userId);await b.i.receiveApplication(alice.userId,signed(id,2,'😢',alice,Date.now(),alice.userId));expect(b.i.conversations.get(id).reactions[0].emoji).toBe('👍');
 });
 it('a group member can relay another member\'s reaction but not forge it',async()=>{
  const group=signGroupDefinition(alice,{kind:'group-definition',id:'group:'+'ef'.repeat(16),title:'Team',creatorId:alice.userId,members:[user(alice,'alice'),user(bob,'bob'),user(carol,'carol')]});
  const b=make(bob);await b.i.receiveApplication(alice.userId,group);const id=group.id;const c=b.i.conversations.get(id);c.messages.push({id:messageId,text:'from alice',from:alice.userId,timestamp:Date.now(),status:'received',conversationId:id,expiresAt:Date.now()+OUTBOX_TTL_MS});
  await b.i.receiveApplication(carol.userId,signed(id,1,'🙏',alice,Date.now(),alice.userId));expect(chat(b.c,id).messages[0]!.reactions).toEqual([{userId:alice.userId,emoji:'🙏'}]);
  await expect(b.i.receiveApplication(carol.userId,{...signed(id,1,'👍',carol,Date.now(),alice.userId),reactor:alice.userId})).rejects.toThrow('Invalid reaction');
 });
 it('disappears with its message',async()=>{
  const {b,id}=await received();await b.i.receiveApplication(alice.userId,signed(id,1,'👍',alice,Date.now(),alice.userId));
  await b.c.deleteMessage(id,{id:messageId,type:'message',author:alice.userId},'me');expect(b.i.conversations.get(id).reactions).toBeUndefined();
 });
});
