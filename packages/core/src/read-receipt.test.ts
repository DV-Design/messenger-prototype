import {afterEach,expect,it,vi} from 'vitest';
import {createDeviceIdentity,type DeviceIdentity,type DirectoryUser} from './directory.js';
import {MessengerClient} from './messenger.js';
import {contentHash,signGroupDefinition} from './group-sync.js';
import {signReadReceipt} from './read-receipt.js';
import {openLocalState} from './persistence.js';
const alice=createDeviceIdentity(n=>new Uint8Array(n).fill(111)),bob=createDeviceIdentity(n=>new Uint8Array(n).fill(112)),charlie=createDeviceIdentity(n=>new Uint8Array(n).fill(113));
const user=(i:DeviceIdentity,name:string):DirectoryUser=>({userId:i.userId,publicKey:i.publicKey,username:name,displayName:name,online:false,lastSeen:1});
function storage(){let sealed:string|null=null;const blobs=new Map<string,string>();return {get sealed(){return sealed;},loadState:async()=>sealed,saveState:vi.fn(async(s:string)=>{sealed=s;}),saveAttachment:async(k:string,s:string)=>{blobs.set(k,s);},loadAttachment:async(k:string)=>blobs.get(k)??null};}
const clients:MessengerClient[]=[];
function make(identity=alice,store=storage()){let n=0;const c=new MessengerClient({identity,serverUrl:'https://example.com',username:'tester',displayName:'Tester',...store,randomBytes:size=>{const b=new Uint8Array(size);new DataView(b.buffer).setUint32(0,++n);return b;}});clients.push(c);return {c,i:c as any,store};}
afterEach(async()=>{for(const c of clients.splice(0))c.disconnect();});
const snapshot=(c:MessengerClient,id:string)=>c.getSnapshot().conversations.find(c=>c.id===id)!;
it('durable delivery is distinct from read, and a read proves delivery even before its ACK',async()=>{
 const a=make(),b=make(bob);const id=await a.c.addContact(user(bob,'bob'));await b.c.addContact(user(alice,'alice'));await a.c.sendText(id,'hello');const message=snapshot(a.c,id).messages[0]!;
 await b.i.receiveMessage(alice.userId,{...message,from:'peer'});
 expect(snapshot(a.c,id).messages[0]!.readBy).toBeUndefined();expect(b.i.conversations.get(id).readReceipts).toBeUndefined();
 await b.c.markRead(id);const receipt=b.i.conversations.get(id).readReceipts[0];
 await a.i.receiveApplication(bob.userId,receipt);expect(snapshot(a.c,id).messages[0]).toMatchObject({status:'delivered',readBy:[bob.userId]});expect(a.i.pending).toHaveLength(0);
 await a.i.receiveApplication(bob.userId,receipt);expect(snapshot(a.c,id).messages[0]!.readBy).toEqual([bob.userId]);
 await a.i.receiveMessage(bob.userId,{...message,from:'self',status:'delivered'});expect(snapshot(a.c,id).messages[0]!.status).toBe('delivered');
});
it('persists signed reading offline and replays it to the author after reader restart',async()=>{
 const b=make(bob);const id=await b.c.addContact(user(alice,'alice'));await b.i.receiveMessage(alice.userId,{id:'ab'.repeat(16),text:'offline author',from:'peer',timestamp:Date.now(),conversationId:id});await b.c.markRead(id);
 const stored=openLocalState(bob,b.store.sealed!) as any;expect(stored.conversations[0].readReceipts).toHaveLength(1);
 const restored=make(bob,b.store);await restored.c.addContact(user(alice,'alice'));const sent:unknown[]=[];const session={getSnapshot:()=>({status:'connected',callState:'idle',files:[]}),sendApplication:async(r:unknown)=>{sent.push(r);},disconnect:()=>{}};
 restored.i.pairs.set(alice.userId,{session,attempt:0,flushing:false,notified:true,lastUsed:Date.now(),lastSent:new Map(),definitions:new Set()});await restored.i.flushPeer(alice.userId);expect(sent).toEqual(stored.conversations[0].readReceipts);
});
it('rejects forged readers, cross-chat and conflicting content without clearing outbox',async()=>{
 const a=make();const id=await a.c.addContact(user(bob,'bob'));await a.c.sendText(id,'real');const message=snapshot(a.c,id).messages[0]!;
 const receipt=signReadReceipt(bob,{conversationId:id,author:alice.userId,id:message.id,type:'message',hash:contentHash('message','real')});
 for(const value of [{...receipt,reader:charlie.userId},{...receipt,conversationId:'group:'+'cd'.repeat(16)},signReadReceipt(bob,{...receipt,hash:contentHash('message','fake')})])await expect(a.i.receiveApplication(bob.userId,value)).rejects.toThrow();
 expect(a.i.pending).toHaveLength(1);expect(snapshot(a.c,id).messages[0]!.readBy).toBeUndefined();
});
it('never sends a read before durable content and receipt writes succeed',async()=>{
 const b=make(bob);const id=await b.c.addContact(user(alice,'alice'));await b.i.receiveMessage(alice.userId,{id:'ac'.repeat(16),text:'durable',from:'peer',timestamp:Date.now(),conversationId:id});const send=vi.fn();b.i.wakePeer=send;
 b.store.saveState.mockRejectedValueOnce(new Error('disk full'));await expect(b.c.markRead(id)).rejects.toThrow('disk full');expect(send).not.toHaveBeenCalled();expect(b.i.conversations.get(id).readReceipts??[]).toHaveLength(0);
 await b.c.markRead(id);expect(send).toHaveBeenCalledWith(alice.userId);
});
it('rolls back read state and preserves queue on sender receipt persistence failure',async()=>{
 const a=make();const id=await a.c.addContact(user(bob,'bob'));await a.c.sendText(id,'durable');const m=snapshot(a.c,id).messages[0]!;const r=signReadReceipt(bob,{conversationId:id,author:alice.userId,id:m.id,type:'message',hash:contentHash('message',m.text)});
 a.store.saveState.mockRejectedValueOnce(new Error('disk full'));await expect(a.i.receiveApplication(bob.userId,r)).rejects.toThrow('disk full');expect(a.i.pending).toHaveLength(1);expect(snapshot(a.c,id).messages[0]!.readBy).toBeUndefined();await a.i.receiveApplication(bob.userId,r);expect(a.i.pending).toHaveLength(0);
});
it('records a file read only for the actual retained complete bytes, never a filename preview',async()=>{
 const a=make(),b=make(bob);const id=await a.c.addContact(user(bob,'bob'));await b.c.addContact(user(alice,'alice'));const data=new Uint8Array([1,2,3]);await a.c.sendFile(id,{name:'voice.m4a',mime:'audio/mp4',data});const f=snapshot(a.c,id).files[0]!;
 await b.c.markRead(id);expect(b.i.conversations.get(id).readReceipts??[]).toHaveLength(0);await b.i.receiveFile(alice.userId,{...f,from:'peer',status:'complete',receivedBytes:3,data});await b.c.markRead(id);const r=b.i.conversations.get(id).readReceipts[0];expect(r.type).toBe('file');await a.i.receiveApplication(bob.userId,r);expect(snapshot(a.c,id).files[0]).toMatchObject({deliveryStatus:'delivered',readBy:[bob.userId]});
});
it('tracks partial group readers separately and authenticates each recipient',async()=>{
 const a=make();await a.c.addContact(user(bob,'bob'));await a.c.addContact(user(charlie,'charlie'));const id='group:'+'cd'.repeat(16),members=[user(alice,'alice'),user(bob,'bob'),user(charlie,'charlie')];const definition=signGroupDefinition(alice,{kind:'group-definition',id,title:'Group',creatorId:alice.userId,members});a.i.conversations.set(id,{id,kind:'group',title:'Group',creatorId:alice.userId,definition,memberIds:members.map(m=>m.userId),messages:[],files:[],unread:0,updatedAt:Date.now()});await a.c.sendText(id,'group');const m=snapshot(a.c,id).messages[0]!;
 for(const reader of [bob,charlie]){await a.i.receiveApplication(bob.userId,signReadReceipt(reader,{conversationId:id,author:alice.userId,id:m.id,type:'message',hash:contentHash('message',m.text)}));}
 expect(snapshot(a.c,id).messages[0]).toMatchObject({status:'delivered',readBy:[bob.userId,charlie.userId]});
});

it('retains sender read receipts and reader lists across encrypted restore',async()=>{
 const a=make();const id=await a.c.addContact(user(bob,'bob'));await a.c.sendText(id,'restore read');const m=snapshot(a.c,id).messages[0]!;await a.i.receiveApplication(bob.userId,signReadReceipt(bob,{conversationId:id,author:alice.userId,id:m.id,type:'message',hash:contentHash('message',m.text)}));
 const restored=make(alice,a.store);await restored.c.addContact(user(bob,'bob'));expect(snapshot(restored.c,id).messages[0]).toMatchObject({status:'delivered',readBy:[bob.userId]});const copy=snapshot(restored.c,id).messages[0]!;copy.readBy!.push('mutation');expect(snapshot(restored.c,id).messages[0]!.readBy).toEqual([bob.userId]);
});
it('rolls back a newly signed local receipt if its own save fails after content save',async()=>{
 const b=make(bob);const id=await b.c.addContact(user(alice,'alice'));await b.i.receiveMessage(alice.userId,{id:'ad'.repeat(16),text:'two writes',from:'peer',timestamp:Date.now(),conversationId:id});const send=vi.fn();b.i.wakePeer=send;
 b.store.saveState.mockImplementationOnce(async()=>{}).mockRejectedValueOnce(new Error('receipt disk full'));await expect(b.c.markRead(id)).rejects.toThrow('receipt disk full');expect(send).not.toHaveBeenCalled();expect(b.i.conversations.get(id).readReceipts).toHaveLength(0);expect(snapshot(b.c,id).unread).toBe(1);await b.c.markRead(id);expect(send).toHaveBeenCalledTimes(1);
});
it('does not read a file while its encrypted blob write is pending or failed',async()=>{
 const b=make(bob);const id=await b.c.addContact(user(alice,'alice'));let reject!:(e:Error)=>void;
 b.i.options.saveAttachment=()=>new Promise<void>((_yes,no)=>{reject=no;});
 const receiving=b.i.receiveFile(alice.userId,{id:'ae'.repeat(16),name:'slow',mime:'',size:1,from:'peer',status:'complete',receivedBytes:1,data:new Uint8Array([1]),conversationId:id});const failure=expect(receiving).rejects.toThrow('blob failed');
 await Promise.resolve();await b.c.markRead(id);expect(b.i.conversations.get(id).readReceipts??[]).toHaveLength(0);expect(snapshot(b.c,id).files[0]!.status).toBe('receiving');reject(new Error('blob failed'));await failure;await b.c.markRead(id);expect(b.i.conversations.get(id).readReceipts??[]).toHaveLength(0);
});
it('does not include a new arrival in a read checkpoint that was already saving',async()=>{
 const b=make(bob);const id=await b.c.addContact(user(alice,'alice'));let release!:()=>void;
 b.store.saveState.mockImplementationOnce(()=>new Promise<void>(yes=>{release=yes;}));const reading=b.c.markRead(id);
 while(!release)await Promise.resolve();
 const receiving=b.i.receiveMessage(alice.userId,{id:'af'.repeat(16),text:'arrived during write',from:'peer',timestamp:Date.now(),conversationId:id});
 release();await Promise.all([reading,receiving]);expect(b.i.conversations.get(id).readReceipts??[]).toHaveLength(0);expect(snapshot(b.c,id).unread).toBe(1);await b.c.markRead(id);expect(b.i.conversations.get(id).readReceipts).toHaveLength(1);
});
