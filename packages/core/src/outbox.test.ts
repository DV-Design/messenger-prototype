import {afterEach,describe,expect,it,vi} from 'vitest';
import {createDeviceIdentity,type DeviceIdentity,type DirectoryUser} from './directory.js';
import {MessengerClient,OUTBOX_TTL_MS,MAX_PENDING_FILES} from './messenger.js';
import {openLocalState,sealLocalState} from './persistence.js';
import {signGroupDefinition,signGroupOrigin,parseGroupOrigin,contentHash,signGroupReceipt,verifyGroupReceipt} from './group-sync.js';
const alice=createDeviceIdentity(n=>new Uint8Array(n).fill(101)),bob=createDeviceIdentity(n=>new Uint8Array(n).fill(102)),charlie=createDeviceIdentity(n=>new Uint8Array(n).fill(103));
const user=(i:DeviceIdentity,name:string):DirectoryUser=>({userId:i.userId,publicKey:i.publicKey,username:name,displayName:name,online:false,lastSeen:1});
function random(){let counter=0;return(n:number)=>{const b=new Uint8Array(n);new DataView(b.buffer).setUint32(0,++counter);return b;};}
function storage(){let sealed:string|null=null;const blobs=new Map<string,string>();return {blobs,get sealed(){return sealed;},loadState:async()=>sealed,saveState:vi.fn(async(value:string)=>{sealed=value;}),saveAttachment:vi.fn(async(key:string,value:string)=>{blobs.set(key,value);}),loadAttachment:async(key:string)=>blobs.get(key)??null,deleteAttachment:vi.fn(async(key:string)=>{blobs.delete(key);})};}
function client(identity=alice,store=storage()){return {client:new MessengerClient({serverUrl:'https://example.com',identity,username:identity===alice?'alice':identity===bob?'bob':'charlie',displayName:'Test',randomBytes:random(),...store}),store};}
const all:MessengerClient[]=[];function tracked(identity=alice,store=storage()){const f=client(identity,store);all.push(f.client);return {...f,internal:f.client as any};}
afterEach(()=>{for(const c of all.splice(0))c.disconnect();vi.useRealTimers();});
describe('seven-day sender-held outbox',()=>{
 it('keeps encrypted file bytes and original deadlines across sender restart',async()=>{
  vi.useFakeTimers();vi.setSystemTime(1000000000);const a=tracked();const id=await a.client.addContact(user(bob,'bob'));const bytes=new Uint8Array([11,22,33]);await a.client.sendFile(id,{name:'secret.txt',mime:'text/plain',data:bytes});await a.client.sendText(id,'secret text');
  expect(a.store.sealed).not.toContain('secret text');expect([...a.store.blobs.values()][0]).not.toContain('secret.txt');const before=a.client.getSnapshot().conversations[0]!;const deadline=before.files[0]!.expiresAt;expect(deadline).toBe(Date.now()+OUTBOX_TTL_MS);a.client.disconnect();
  vi.setSystemTime(Date.now()+6*24*3600000);const restored=tracked(alice,a.store);await restored.client.addContact(user(bob,'bob'));const state=restored.client.getSnapshot().conversations[0]!;expect(state.files[0]!.expiresAt).toBe(deadline);expect(state.files[0]!.deliveryStatus).toBe('pending');expect(await restored.client.getFileData(id,state.files[0]!.id)).toEqual(bytes);expect(state.messages[0]!.status).toBe('pending');
  const payload=openLocalState(alice,a.store.sealed!) as any;expect(payload.version).toBe(3);expect(payload.conversations[0].files[0]).not.toHaveProperty('data');
 });
 it('expires exactly at seven days, stops outbox, and deletes blob only after metadata commit',async()=>{
  vi.useFakeTimers();vi.setSystemTime(1000000000);const a=tracked();const id=await a.client.addContact(user(bob,'bob'));await a.client.sendText(id,'expires');await a.client.sendFile(id,{name:'expires',mime:'',data:new Uint8Array([1])});
  await vi.advanceTimersByTimeAsync(OUTBOX_TTL_MS-1);expect(a.client.getSnapshot().conversations[0]!.messages[0]!.status).toBe('pending');expect(a.store.blobs.size).toBe(1);
  await vi.advanceTimersByTimeAsync(1);const c=a.client.getSnapshot().conversations[0]!;expect(c.messages[0]!.status).toBe('expired');expect(c.files[0]!.deliveryStatus).toBe('expired');expect(c.files[0]!.blobKey).toBeUndefined();expect(a.internal.pending).toHaveLength(0);expect(a.store.blobs.size).toBe(0);expect((openLocalState(alice,a.store.sealed!) as any).pending).toEqual([]);
 });
 it('fails before any transport send when initial encrypted queue write fails',async()=>{
  const a=tracked();const id=await a.client.addContact(user(bob,'bob'));const send=vi.fn();a.internal.status='online';a.internal.stopped=false;a.internal.contacts.set(bob.userId,{...user(bob,'bob'),online:true});a.internal.ensurePair=send;a.store.saveState.mockRejectedValue(new Error('disk full'));
  await expect(a.client.sendText(id,'must not escape')).rejects.toThrow('disk full');await expect(a.client.sendFile(id,{name:'private',mime:'',data:new Uint8Array([1])})).rejects.toThrow('disk full');expect(send).not.toHaveBeenCalled();expect(a.internal.pending).toHaveLength(0);
 });
 it('rejects additional files explicitly and preserves every waiting file at capacity',async()=>{
  const a=tracked();const id=await a.client.addContact(user(bob,'bob'));for(let i=0;i<MAX_PENDING_FILES;i++)await a.client.sendFile(id,{name:`file${i}`,mime:'',data:new Uint8Array([i])});await expect(a.client.sendFile(id,{name:'overflow',mime:'',data:new Uint8Array([1])})).rejects.toThrow(/full/);expect(a.client.getSnapshot().conversations[0]!.files).toHaveLength(MAX_PENDING_FILES);expect(a.store.blobs.size).toBe(MAX_PENDING_FILES);
 });
 it('retries persistence for duplicate incoming text after an earlier failed save',async()=>{
  const b=tracked(bob);const id=await b.client.addContact(user(alice,'alice'));const frame={id:'ab'.repeat(16),text:'retry durable',from:'peer',timestamp:Date.now(),conversationId:id};b.store.saveState.mockRejectedValueOnce(new Error('disk full'));await expect(b.internal.receiveMessage(alice.userId,frame)).rejects.toThrow('disk full');expect(b.client.getSnapshot().conversations[0]!.messages).toHaveLength(1);expect(await b.internal.receiveMessage(alice.userId,frame)).toBe(true);expect((openLocalState(bob,b.store.sealed!) as any).conversations[0].messages).toHaveLength(1);
 });
 it('rejects incoming text when100 protected pending texts occupy the chat',async()=>{
  const a=tracked();const id=await a.client.addContact(user(bob,'bob'));for(let i=0;i<100;i++)await a.client.sendText(id,'waiting');await expect(a.internal.receiveMessage(bob.userId,{id:'fe'.repeat(16),text:'incoming',from:'peer',timestamp:Date.now(),conversationId:id})).rejects.toThrow(/full/);expect(a.client.getSnapshot().conversations[0]!.messages).toHaveLength(100);expect((openLocalState(alice,a.store.sealed!) as any).pending).toHaveLength(100);
 });
 it('preserves sender queue if recording a genuine recipientACK fails',async()=>{
  const a=tracked();const id=await a.client.addContact(user(bob,'bob'));await a.client.sendText(id,'not durable ack');const message=a.client.getSnapshot().conversations[0]!.messages[0]!;a.store.saveState.mockRejectedValueOnce(new Error('disk full'));await expect(a.internal.receiveMessage(bob.userId,{...message,from:'self',status:'delivered'})).rejects.toThrow('disk full');expect(a.internal.pending[0].remaining).toEqual([bob.userId]);expect(a.client.getSnapshot().conversations[0]!.messages[0]!.status).toBe('pending');
 });
 it('retries file blob persistence after failure and never confirms an absent blob',async()=>{
  const b=tracked(bob);const id=await b.client.addContact(user(alice,'alice'));const frame={id:'af'.repeat(16),name:'file',mime:'',size:2,from:'peer',status:'complete',receivedBytes:2,data:new Uint8Array([4,5]),conversationId:id};b.store.saveAttachment.mockRejectedValueOnce(new Error('blob full'));await expect(b.internal.receiveFile(alice.userId,frame)).rejects.toThrow('blob full');expect(b.store.blobs.size).toBe(0);expect(await b.internal.receiveFile(alice.userId,frame)).toBe(true);expect(await b.client.getFileData(id,frame.id,alice.userId)).toEqual(frame.data);
 });
 it('migrates v2 pending timestamps without extending their retention',async()=>{
  vi.useFakeTimers();vi.setSystemTime(OUTBOX_TTL_MS+100);const a=tracked();const id=await a.client.addContact(user(bob,'bob'));const state={version:2,contacts:[user(bob,'bob')],conversations:[{id,kind:'direct',title:'Bob',memberIds:[alice.userId,bob.userId].sort(),messages:[{id:'aa'.repeat(16),text:'old',from:alice.userId,timestamp:100,status:'pending',conversationId:id}],unread:0,updatedAt:100}],pending:[{conversationId:id,messageId:'aa'.repeat(16),remaining:[bob.userId]}]};await a.store.saveState(sealLocalState(alice,state));const restored=tracked(alice,a.store);await restored.client.addContact(user(bob,'bob'));expect(restored.client.getSnapshot().conversations[0]!.messages[0]!.status).toBe('expired');expect(restored.internal.pending).toHaveLength(0);
 });
});
describe('authenticated group synchronization',()=>{
 const groupId='group:'+'cd'.repeat(16);const group=signGroupDefinition(alice,{kind:'group-definition',id:groupId,title:'Three',creatorId:alice.userId,members:[user(alice,'alice'),user(bob,'bob'),user(charlie,'charlie')]});
 it('accepts creator-signed roster from another member and rejects altered roster/origin/hash',async()=>{
  const c=tracked(charlie);await c.client.addContact(user(bob,'bob'));await c.internal.receiveApplication(bob.userId,group);const timestamp=Date.now();const origin=signGroupOrigin(alice,{groupId,id:'ad'.repeat(16),type:'message',timestamp,expiresAt:timestamp+OUTBOX_TTL_MS,hash:contentHash('message','original')});
  await expect(c.internal.receiveMessage(bob.userId,{id:origin.id,text:'changed',from:'peer',timestamp,conversationId:groupId,metadata:JSON.stringify(origin)})).rejects.toThrow(/Invalid/);
  expect(await c.internal.receiveMessage(bob.userId,{id:origin.id,text:'original',from:'peer',timestamp,conversationId:groupId,metadata:JSON.stringify(origin)})).toBe(true);expect(c.client.getSnapshot().conversations.find(x=>x.id===groupId)!.messages[0]!.from).toBe(alice.userId);
  expect(()=>parseGroupOrigin(JSON.stringify({...origin,expiresAt:origin.expiresAt+1}),group)).toThrow();await expect(c.internal.receiveApplication(bob.userId,{...group,title:'Tampered'})).rejects.toThrow();const receipt=signGroupReceipt(charlie,origin);expect(verifyGroupReceipt(receipt,group)).toBe(true);expect(verifyGroupReceipt({...receipt,recipient:bob.userId},group)).toBe(false);
 });
 it('uses a final recipient signature relayed by another member for partial group ACKs',async()=>{
  const a=tracked();await a.client.addContact(user(bob,'bob'));await a.client.addContact(user(charlie,'charlie'));a.internal.conversations.set(groupId,{id:groupId,kind:'group',title:group.title,creatorId:alice.userId,definition:group,memberIds:group.members.map(m=>m.userId).sort(),messages:[],files:[],unread:0,updatedAt:0});await a.client.sendText(groupId,'group pending');const message=a.client.getSnapshot().conversations.find(c=>c.id===groupId)!.messages[0]!;const origin=parseGroupOrigin(message.metadata!,group);
  await a.internal.receiveApplication(bob.userId,signGroupReceipt(bob,origin));expect(a.internal.pending[0].remaining).toEqual([charlie.userId]);const forged={...signGroupReceipt(bob,origin),recipient:charlie.userId};await expect(a.internal.receiveApplication(bob.userId,forged)).rejects.toThrow(/Invalid/);expect(a.internal.pending[0].remaining).toEqual([charlie.userId]);
  await a.internal.receiveApplication(bob.userId,signGroupReceipt(charlie,origin));expect(a.internal.pending).toHaveLength(0);expect(a.client.getSnapshot().conversations.find(c=>c.id===groupId)!.messages[0]!.status).toBe('delivered');
 });
 it('restores a peer-held verified file and can relay it after original author disconnects',async()=>{
  const b=tracked(bob);await b.client.addContact(user(alice,'alice'));await b.internal.receiveApplication(alice.userId,group);const timestamp=Date.now(),data=new Uint8Array([7,8,9]);const origin=signGroupOrigin(alice,{groupId,id:'ae'.repeat(16),type:'file',timestamp,expiresAt:timestamp+OUTBOX_TTL_MS,hash:contentHash('file',data,'file','')});const file={id:origin.id,name:'file',mime:'',size:3,from:'peer',status:'complete',receivedBytes:3,data,conversationId:groupId,metadata:JSON.stringify(origin)};
  await b.internal.receiveFile(alice.userId,file);b.client.disconnect();const restored=tracked(bob,b.store);await restored.client.addContact(user(alice,'alice'));expect(await restored.client.getFileData(groupId,origin.id,alice.userId)).toEqual(data);
  const c=tracked(charlie);await c.client.addContact(user(bob,'bob'));await c.internal.receiveApplication(bob.userId,group);expect(await c.internal.receiveFile(bob.userId,{...file,data:await restored.client.getFileData(groupId,origin.id,alice.userId)})).toBe(true);expect(await c.client.getFileData(groupId,origin.id,alice.userId)).toEqual(data);expect(c.client.getSnapshot().conversations.find(x=>x.id===groupId)!.files[0]!.senderId).toBe(alice.userId);
 });
});
