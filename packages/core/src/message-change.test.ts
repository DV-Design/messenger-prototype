import {afterEach,describe,expect,it,vi} from 'vitest';
import {createDeviceIdentity,type DeviceIdentity,type DirectoryUser} from './directory.js';
import {MessengerClient,OUTBOX_TTL_MS} from './messenger.js';
import {contentHash,signGroupDefinition} from './group-sync.js';
import {messageChangeSchema,signMessageChange,verifyMessageChange} from './message-change.js';
import {openLocalState} from './persistence.js';
const alice=createDeviceIdentity(n=>new Uint8Array(n).fill(121)),bob=createDeviceIdentity(n=>new Uint8Array(n).fill(122)),carol=createDeviceIdentity(n=>new Uint8Array(n).fill(123));
const user=(i:DeviceIdentity,name:string):DirectoryUser=>({userId:i.userId,publicKey:i.publicKey,username:name,displayName:name,online:false,lastSeen:1});
function storage(){let sealed:string|null=null;const blobs=new Map<string,string>();return {blobs,get sealed(){return sealed;},loadState:async()=>sealed,saveState:vi.fn(async(s:string)=>{sealed=s;}),saveAttachment:async(k:string,s:string)=>{blobs.set(k,s);},loadAttachment:async(k:string)=>blobs.get(k)??null,deleteAttachment:vi.fn(async(k:string)=>{blobs.delete(k);})};}
const clients:MessengerClient[]=[];
let seed=0;
function make(identity=alice,store=storage()){const c=new MessengerClient({identity,serverUrl:'https://example.com',username:'tester',displayName:'Tester',...store,randomBytes:size=>{const b=new Uint8Array(size);new DataView(b.buffer).setUint32(0,++seed);return b;}});clients.push(c);return {c,i:c as any,store};}
afterEach(()=>{for(const c of clients.splice(0))c.disconnect();});
const chat=(c:MessengerClient,id:string)=>c.getSnapshot().conversations.find(x=>x.id===id)!;
const messageId='ab'.repeat(16);
const textFrame=(id:string,text='original',messageIdValue=messageId)=>({id:messageIdValue,text,from:'peer' as const,timestamp:Date.now(),status:'received' as const,conversationId:id});
function connectedPair(support=true){const sent:any[]=[];return {sent,pair:{session:{getSnapshot:()=>({status:'connected',callState:'idle',files:[]}),sendApplication:async(p:unknown)=>{sent.push(p);},sendText:async(_text:string)=>{},supportsMessageChanges:()=>support,disconnect:vi.fn()},attempt:0,flushing:false,notified:true,lastUsed:Date.now(),lastSent:new Map(),definitions:new Set()}};}
describe('signed message change',()=>{
 const base={conversationId:'dm:'+'ab'.repeat(32),id:messageId,type:'message' as const,action:'edit' as const,revision:1,text:'new',changedAt:1000,expiresAt:1000+OUTBOX_TTL_MS};
 it('verifies only the author and only the signed content',()=>{
  const change=signMessageChange(alice,base);expect(verifyMessageChange(change,alice.publicKey)).toBe(true);expect(verifyMessageChange(change,bob.publicKey)).toBe(false);
  expect(verifyMessageChange({...change,text:'tampered'},alice.publicKey)).toBe(false);expect(verifyMessageChange({...change,revision:2},alice.publicKey)).toBe(false);expect(verifyMessageChange({...change,action:'delete',text:undefined},alice.publicKey)).toBe(false);
 });
 it('fixes the shape and lifetime of a change',()=>{
  const change=signMessageChange(alice,base);expect(()=>messageChangeSchema.parse({...change,expiresAt:change.expiresAt+1})).toThrow();expect(()=>messageChangeSchema.parse({...change,text:undefined})).toThrow();expect(()=>messageChangeSchema.parse({...change,action:'delete'})).toThrow();expect(()=>messageChangeSchema.parse({...change,type:'file'})).toThrow();expect(()=>messageChangeSchema.parse({...change,extra:1})).toThrow();
 });
});
describe('editing',()=>{
 it('shows the new text, keeps the wire text, and survives restart as version 6',async()=>{
  const a=make();const id=await a.c.addContact(user(bob,'bob'));await a.c.sendText(id,'original');const m=chat(a.c,id).messages[0]!;
  await a.c.editMessage(id,m.id,'edited');expect(chat(a.c,id).messages[0]).toMatchObject({text:'edited',originalText:'original',status:'pending'});expect(chat(a.c,id).messages[0]!.editedAt).toBeGreaterThan(0);
  await a.c.flushState();const stored=openLocalState(alice,a.store.sealed!) as any;expect(stored.version).toBe(6);expect(stored.conversations[0].changes).toHaveLength(1);
  a.c.disconnect();const restored=make(alice,a.store);await restored.c.flushState();expect(chat(restored.c,id).messages[0]).toMatchObject({text:'edited',originalText:'original'});
  const sentText:string[]=[];const {pair,sent}=connectedPair();pair.session.sendText=async(text:string)=>{sentText.push(text);};restored.i.pairs.set(bob.userId,pair);await restored.i.flushPeer(bob.userId);
  expect(sentText).toEqual(['original']);expect(sent.map(x=>x.kind)).toEqual(['message-change']);await restored.i.flushPeer(bob.userId);expect(sent).toHaveLength(1);
 });
 it('refuses other authors, unchanged text, invalid text and expired messages',async()=>{
  const a=make();const id=await a.c.addContact(user(bob,'bob'));await a.i.receiveMessage(bob.userId,textFrame(id));
  await expect(a.c.editMessage(id,messageId,'nope')).rejects.toThrow('Unknown message');
  await a.c.sendText(id,'mine');const own=chat(a.c,id).messages.find(m=>m.from===alice.userId)!;
  await a.c.editMessage(id,own.id,'mine');expect(a.i.conversations.get(id).changes).toBeUndefined();
  await expect(a.c.editMessage(id,own.id,'  ')).rejects.toThrow('1–4000');await expect(a.c.editMessage(id,own.id,'x'.repeat(4001))).rejects.toThrow('1–4000');
  await expect(a.c.editMessage(id,own.id,'\u0001'.repeat(4000))).rejects.toThrow('special characters');expect(chat(a.c,id).messages.find(m=>m.id===own.id)!.text).toBe('mine');
  a.i.conversations.get(id).messages.find((m:any)=>m.id===own.id).status='expired';await expect(a.c.editMessage(id,own.id,'late')).rejects.toThrow('expired');
 });
 it('rolls back when the edit cannot be saved',async()=>{
  const a=make();const id=await a.c.addContact(user(bob,'bob'));await a.c.sendText(id,'original');const m=chat(a.c,id).messages[0]!;await a.c.flushState();
  a.store.saveState.mockRejectedValueOnce(new Error('disk'));await expect(a.c.editMessage(id,m.id,'edited')).rejects.toThrow();
  expect(chat(a.c,id).messages[0]).toMatchObject({text:'original'});expect(chat(a.c,id).messages[0]!.originalText).toBeUndefined();expect(a.i.conversations.get(id).changes).toBeUndefined();
 });
 it('keeps edits and deletion records inside a fixed budget',async()=>{
  const a=make();const id=await a.c.addContact(user(bob,'bob'));const other=await a.c.addContact(user(carol,'carol'));const c=a.i.conversations.get(id),d=a.i.conversations.get(other);const now=Date.now();
  const edited=(conversationId:string,prefix:string,count:number)=>Array.from({length:count},(_,n)=>({id:prefix+n.toString(16).padStart(31,'0'),text:'b',originalText:'я'.repeat(4000),from:alice.userId,timestamp:now,status:'delivered',conversationId,expiresAt:now+OUTBOX_TTL_MS}));
  c.tombstones=Array.from({length:256},(_,n)=>({id:n.toString(16).padStart(32,'0'),author:bob.userId,type:'message',expiresAt:now+1000+n}));c.messages=edited(id,'c',64);d.messages=edited(other,'d',64);
  await a.c.sendText(id,'fresh');const own=chat(a.c,id).messages.at(-1)!;await a.c.editMessage(id,own.id,'edited');expect(a.i.fitChangeBudget()).toBe(true);expect(c.tombstones.length).toBeLessThan(256);expect(c.tombstones[0].expiresAt).toBeGreaterThan(now+1000);
  d.messages=edited(other,'d',100);c.tombstones=[];
  await expect(a.c.editMessage(id,own.id,'again')).rejects.toThrow('storage for edits is full');expect(chat(a.c,id).messages.find(m=>m.id===own.id)!.text).toBe('edited');
 });
});
describe('receiving a change',()=>{
 async function received(){const b=make(bob);const id=await b.c.addContact(user(alice,'alice'));await b.i.receiveMessage(alice.userId,textFrame(id));return {b,id};}
 function signed(id:string,revision:number,action:'edit'|'delete',text?:string,identity=alice,changedAt=Date.now()){return signMessageChange(identity,{conversationId:id,id:messageId,type:'message',action,revision,text,changedAt,expiresAt:changedAt+OUTBOX_TTL_MS});}
 it('applies the highest revision without touching unread order, and an old replay still matches',async()=>{
  const {b,id}=await received();const before=chat(b.c,id);
  await b.i.receiveApplication(alice.userId,signed(id,2,'edit','second'));await b.i.receiveApplication(alice.userId,signed(id,1,'edit','first'));await b.i.receiveApplication(alice.userId,signed(id,2,'edit','same'));
  const after=chat(b.c,id);expect(after.messages[0]).toMatchObject({text:'second',originalText:'original'});expect(after.unread).toBe(before.unread);expect(after.updatedAt).toBe(before.updatedAt);
  expect(await b.i.receiveMessage(alice.userId,textFrame(id))).toBe(true);expect(chat(b.c,id).messages).toHaveLength(1);expect(chat(b.c,id).messages[0]!.text).toBe('second');
  await expect(b.i.receiveMessage(alice.userId,textFrame(id,'forged'))).rejects.toThrow('Conflicting');
 });
 it('read receipts keep hashing the original text after an edit',async()=>{
  const a=make();const id=await a.c.addContact(user(bob,'bob'));await a.c.sendText(id,'original');const m=chat(a.c,id).messages[0]!;const b=make(bob);await b.c.addContact(user(alice,'alice'));
  await b.i.receiveMessage(alice.userId,{...m,from:'peer'});await a.c.editMessage(id,m.id,'edited');await b.i.receiveApplication(alice.userId,a.i.conversations.get(id).changes[0]);expect(chat(b.c,id).messages[0]!.text).toBe('edited');
  await b.c.markRead(id);const receipt=b.i.conversations.get(id).readReceipts[0];expect(receipt.hash).toBe(contentHash('message','original'));await a.i.receiveApplication(bob.userId,receipt);expect(chat(a.c,id).messages[0]!.readBy).toEqual([bob.userId]);
 });
 it('applies a change that arrives before its message',async()=>{
  const b=make(bob);const id=await b.c.addContact(user(alice,'alice'));await b.i.receiveApplication(alice.userId,signed(id,1,'edit','later'));expect(chat(b.c,id).messages).toHaveLength(0);
  await b.i.receiveMessage(alice.userId,textFrame(id));expect(chat(b.c,id).messages[0]).toMatchObject({text:'later',originalText:'original'});
 });
 it('rejects forged, foreign and future changes, and ignores expired ones',async()=>{
  const {b,id}=await received();
  await expect(b.i.receiveApplication(alice.userId,{...signed(id,1,'edit','x'),text:'y'})).rejects.toThrow('Invalid message change');
  await expect(b.i.receiveApplication(alice.userId,signed(id,1,'edit','x',carol))).rejects.toThrow('Invalid message change');
  await expect(b.i.receiveApplication(alice.userId,signed(id,1,'edit','x',alice,Date.now()+120000))).rejects.toThrow('future');
  await b.i.receiveApplication(alice.userId,signed(id,1,'edit','x',alice,Date.now()-OUTBOX_TTL_MS-1));expect(chat(b.c,id).messages[0]!.text).toBe('original');
 });
 it('a member cannot change another author\'s record through a group, and a relayed change applies',async()=>{
  const group=signGroupDefinition(alice,{kind:'group-definition',id:'group:'+'cd'.repeat(16),title:'Team',creatorId:alice.userId,members:[user(alice,'alice'),user(bob,'bob'),user(carol,'carol')]});
  const b=make(bob);await b.i.receiveApplication(alice.userId,group);const id=group.id;const c=b.i.conversations.get(id);c.messages.push({id:messageId,text:'from alice',from:alice.userId,timestamp:Date.now(),status:'received',conversationId:id,expiresAt:Date.now()+OUTBOX_TTL_MS});
  await b.i.receiveApplication(carol.userId,signed(id,1,'edit','by carol',carol));expect(c.messages[0].text).toBe('from alice');
  await b.i.receiveApplication(carol.userId,signed(id,1,'edit','by alice'));expect(c.messages[0].text).toBe('by alice');
 });
 it('delete wins over any later edit, and a replay does not bring the message back',async()=>{
  const {b,id}=await received();await b.i.receiveApplication(alice.userId,signed(id,1,'delete'));expect(chat(b.c,id).messages).toHaveLength(0);expect(chat(b.c,id).unread).toBe(0);
  await b.i.receiveApplication(alice.userId,signed(id,5,'edit','back'));expect(await b.i.receiveMessage(alice.userId,textFrame(id))).toBe(true);expect(chat(b.c,id).messages).toHaveLength(0);
  await b.c.flushState();b.c.disconnect();const restored=make(bob,b.store);await restored.c.flushState();expect(await restored.i.receiveMessage(alice.userId,textFrame(id))).toBe(true);expect(chat(restored.c,id).messages).toHaveLength(0);
 });
 it('deletes the received file blob and refuses a file replay',async()=>{
  const b=make(bob);const id=await b.c.addContact(user(alice,'alice'));const file={id:messageId,name:'a.bin',mime:'application/octet-stream',size:3,from:'peer' as const,status:'complete' as const,receivedBytes:3,conversationId:id,data:new Uint8Array([1,2,3])};
  await b.i.receiveFile(alice.userId,file);expect(b.store.blobs.size).toBe(1);
  const at=Date.now();await b.i.receiveApplication(alice.userId,signMessageChange(alice,{conversationId:id,id:messageId,type:'file',action:'delete',revision:1,changedAt:at,expiresAt:at+OUTBOX_TTL_MS}));
  await b.i.receiveFile(alice.userId,file);expect(chat(b.c,id).files).toHaveLength(0);expect(b.store.blobs.size).toBe(0);
 });
 it('tolerates read and group receipts for records that are gone',async()=>{
  const a=make();const id=await a.c.addContact(user(bob,'bob'));await a.c.sendText(id,'x');const m=chat(a.c,id).messages[0]!;const b=make(bob);await b.c.addContact(user(alice,'alice'));await b.i.receiveMessage(alice.userId,{...m,from:'peer'});await b.c.markRead(id);const receipt=b.i.conversations.get(id).readReceipts[0];
  await a.c.deleteMessage(id,{id:m.id,type:'message',author:alice.userId},'everyone');await expect(a.i.receiveApplication(bob.userId,receipt)).resolves.toBeUndefined();await expect(a.i.receiveApplication(bob.userId,{...receipt,signature:'00'.repeat(64)})).rejects.toThrow('Invalid read receipt');
 });
});
describe('deleting',()=>{
 it('delete for everyone drops the outbox entry so restart stays valid, and still tells the recipient',async()=>{
  const a=make();const id=await a.c.addContact(user(bob,'bob'));await a.c.sendText(id,'pending');const m=chat(a.c,id).messages[0]!;expect(a.i.pending).toHaveLength(1);
  await a.c.deleteMessage(id,{id:m.id,type:'message',author:alice.userId},'everyone');expect(a.i.pending).toHaveLength(0);expect(chat(a.c,id).messages).toHaveLength(0);expect(a.i.conversations.get(id).changes[0]).toMatchObject({action:'delete',id:m.id});
  await a.c.flushState();a.c.disconnect();const restored=make(alice,a.store);await restored.c.flushState();expect(restored.c.getSnapshot().status).not.toBe('error');expect(chat(restored.c,id).messages).toHaveLength(0);expect(restored.i.pending).toHaveLength(0);
  const {pair,sent}=connectedPair();restored.i.pairs.set(bob.userId,pair);await restored.i.flushPeer(bob.userId);expect(sent.map(x=>x.action)).toEqual(['delete']);
 });
 it('sends nothing to a peer without support, and keeps it for later',async()=>{
  const a=make();const id=await a.c.addContact(user(bob,'bob'));await a.c.sendText(id,'x');const m=chat(a.c,id).messages[0]!;await a.c.editMessage(id,m.id,'y');
  const old=connectedPair(false);a.i.pairs.set(bob.userId,old.pair);await a.i.flushPeer(bob.userId);expect(old.sent).toHaveLength(0);expect(a.i.conversations.get(id).changes).toHaveLength(1);
  const fresh=connectedPair(true);a.i.pairs.set(bob.userId,fresh.pair);await a.i.flushPeer(bob.userId);expect(fresh.sent).toHaveLength(1);
 });
 it('only the author can delete for everyone; delete for me tombstones a received message',async()=>{
  const b=make(bob);const id=await b.c.addContact(user(alice,'alice'));await b.i.receiveMessage(alice.userId,textFrame(id));
  await expect(b.c.deleteMessage(id,{id:messageId,type:'message',author:alice.userId},'everyone')).rejects.toThrow('your own');
  await b.c.deleteMessage(id,{id:messageId,type:'message',author:alice.userId},'me');expect(chat(b.c,id).messages).toHaveLength(0);expect(b.i.conversations.get(id).changes).toBeUndefined();expect(chat(b.c,id).unread).toBe(0);
  expect(await b.i.receiveMessage(alice.userId,textFrame(id))).toBe(true);expect(chat(b.c,id).messages).toHaveLength(0);
 });
 it('removes own file bytes only after the state is saved',async()=>{
  const a=make();const id=await a.c.addContact(user(bob,'bob'));await a.c.sendFile(id,{name:'a.bin',mime:'application/octet-stream',data:new Uint8Array([1])});const f=chat(a.c,id).files[0]!;expect(a.store.blobs.size).toBe(1);await a.c.flushState();
  a.store.saveState.mockRejectedValueOnce(new Error('disk'));await expect(a.c.deleteMessage(id,{id:f.id,type:'file',author:alice.userId},'me')).rejects.toThrow();expect(a.store.blobs.size).toBe(1);expect(chat(a.c,id).files).toHaveLength(1);expect(a.i.pending).toHaveLength(1);
  await a.c.deleteMessage(id,{id:f.id,type:'file',author:alice.userId},'me');expect(a.store.blobs.size).toBe(0);expect(a.i.pending).toHaveLength(0);expect(await a.c.getFileData(id,f.id)).toBeNull();
 });
 it('delete chat clears and hides it, blocks replays, and a new message brings it back',async()=>{
  const b=make(bob);const id=await b.c.addContact(user(alice,'alice'));await b.i.receiveMessage(alice.userId,textFrame(id));await b.c.sendText(id,'mine');await b.c.sendFile(id,{name:'a.bin',mime:'application/octet-stream',data:new Uint8Array([1])});expect(b.store.blobs.size).toBe(1);
  await b.c.deleteChat(id);expect(chat(b.c,id)).toMatchObject({hidden:true,unread:0,messages:[],files:[]});expect(b.i.pending).toHaveLength(0);expect(b.store.blobs.size).toBe(0);expect(b.c.getSnapshot().contacts.map(x=>x.userId)).toEqual([alice.userId]);
  expect(await b.i.receiveMessage(alice.userId,textFrame(id))).toBe(true);expect(chat(b.c,id).messages).toHaveLength(0);expect(chat(b.c,id).hidden).toBe(true);
  await b.c.flushState();b.c.disconnect();const restored=make(bob,b.store);await restored.c.flushState();expect(chat(restored.c,id).hidden).toBe(true);
  await restored.i.receiveMessage(alice.userId,textFrame(id,'new','cd'.repeat(16)));expect(chat(restored.c,id).hidden).toBeUndefined();expect(chat(restored.c,id).messages.map(m=>m.text)).toEqual(['new']);
 });
 it('delete chat keeps a group and its definition',async()=>{
  const group=signGroupDefinition(alice,{kind:'group-definition',id:'group:'+'ef'.repeat(16),title:'Team',creatorId:alice.userId,members:[user(alice,'alice'),user(bob,'bob'),user(carol,'carol')]});
  const b=make(bob);await b.i.receiveApplication(alice.userId,group);await b.c.deleteChat(group.id);expect(chat(b.c,group.id).hidden).toBe(true);expect(b.i.conversations.get(group.id).definition.id).toBe(group.id);await b.i.receiveApplication(alice.userId,group);expect(chat(b.c,group.id).hidden).toBe(true);
 });
});
describe('removing a contact',()=>{
 it('removes the chat, outbox, verification and session, and restart stays valid',async()=>{
  const a=make();const id=await a.c.addContact(user(bob,'bob'));await a.c.markContactVerified(bob.userId);await a.c.sendText(id,'pending');await a.c.sendFile(id,{name:'a.bin',mime:'application/octet-stream',data:new Uint8Array([1])});const {pair}=connectedPair();a.i.pairs.set(bob.userId,pair);
  await a.c.removeContact(bob.userId);const s=a.c.getSnapshot();expect(s.contacts).toEqual([]);expect(s.conversations).toEqual([]);expect(s.verifiedContacts).toEqual([]);expect(a.i.pending).toEqual([]);expect(a.store.blobs.size).toBe(0);expect(a.i.pairs.has(bob.userId)).toBe(false);expect(pair.session.disconnect).toHaveBeenCalled();
  await a.c.flushState();a.c.disconnect();const restored=make(alice,a.store);await restored.c.flushState();expect(restored.c.getSnapshot().contacts).toEqual([]);
 });
 it('keeps the entry of a blocked contact so the block survives restart',async()=>{
  const a=make();await a.c.addContact(user(bob,'bob'));await a.c.blockContact(bob.userId);await a.c.removeContact(bob.userId);expect(a.c.getSnapshot().blockedContacts).toEqual([bob.userId]);expect(a.c.getSnapshot().conversations).toEqual([]);
  await a.c.flushState();a.c.disconnect();const restored=make(alice,a.store);await restored.c.flushState();expect(restored.c.getSnapshot().blockedContacts).toEqual([bob.userId]);
 });
 it('keeps the entry and session of a group member, and restart stays valid',async()=>{
  const group=signGroupDefinition(bob,{kind:'group-definition',id:'group:'+'aa'.repeat(16),title:'Team',creatorId:bob.userId,members:[user(alice,'alice'),user(bob,'bob'),user(carol,'carol')]});
  const a=make();await a.c.addContact(user(bob,'bob'));await a.i.receiveApplication(bob.userId,group);const {pair}=connectedPair();a.i.pairs.set(bob.userId,pair);
  await a.c.removeContact(bob.userId);const s=a.c.getSnapshot();expect(s.contacts.map(x=>x.userId)).toContain(bob.userId);expect(s.conversations.map(x=>x.id)).toEqual([group.id]);expect(a.i.pairs.has(bob.userId)).toBe(true);
  await a.c.flushState();a.c.disconnect();const restored=make(alice,a.store);await restored.c.flushState();expect(restored.c.getSnapshot().conversations.map(x=>x.id)).toEqual([group.id]);
 });
 it('refuses a contact without a direct chat',async()=>{
  const a=make();await expect(a.c.removeContact(bob.userId)).rejects.toThrow('Unknown contact');
 });
 it('an inbound connect stays hidden until a message or the owner opens it',async()=>{
  const a=make();const c=a.i.ensureDirect(user(bob,'bob'),true);a.i.remember(user(bob,'bob'));expect(chat(a.c,c.id)).toMatchObject({hidden:true,implicit:true});
  await a.c.addContact(user(bob,'bob'));expect(chat(a.c,c.id).hidden).toBeUndefined();expect(chat(a.c,c.id).implicit).toBeUndefined();
  const again=make(alice,storage());const d=again.i.ensureDirect(user(bob,'bob'),true);again.i.remember(user(bob,'bob'));await again.i.receiveMessage(bob.userId,textFrame(d.id));expect(chat(again.c,d.id).hidden).toBeUndefined();expect(chat(again.c,d.id).implicit).toBeUndefined();
 });
});
