import {afterEach,describe,expect,it,vi} from 'vitest';
import {createDeviceIdentity,type DirectoryUser} from './directory.js';
import {MessengerClient} from './messenger.js';
import {openLocalState} from './persistence.js';
import {PeerSession,type PeerSessionOptions} from './session.js';
import type {DataFrame} from './protocol.js';
const alice=createDeviceIdentity(n=>new Uint8Array(n).fill(131)),bob=createDeviceIdentity(n=>new Uint8Array(n).fill(132));
const user:DirectoryUser={userId:alice.userId,publicKey:alice.publicKey,username:'alice',displayName:'Alice',online:false,lastSeen:1};
const managers:MessengerClient[]=[];afterEach(()=>{for(const m of managers.splice(0))m.disconnect();vi.useRealTimers();});
function deferred(){let resolve!:()=>void;const promise=new Promise<void>(yes=>{resolve=yes;});return {promise,resolve};}
function storage(){let sealed:string|null=null;const blobs=new Map<string,string>();return {blobs,get sealed(){return sealed;},loadState:async()=>sealed,saveState:vi.fn(async(value:string)=>{sealed=value;}),saveAttachment:vi.fn(async(key:string,value:string)=>{blobs.set(key,value);}),loadAttachment:async(key:string)=>blobs.get(key)??null,deleteAttachment:vi.fn(async(key:string)=>{blobs.delete(key);})};}
function client(store=storage()){
 let n=0;const m=new MessengerClient({serverUrl:'https://example.com',identity:bob,username:'bob',displayName:'Bob',randomBytes:bytes=>new Uint8Array(bytes).fill(++n),...store});managers.push(m);return {m,internal:m as any,store};
}
function transport(options:Partial<PeerSessionOptions>={}){
 let n=0;const frames:DataFrame[]=[];const session=new PeerSession({serverUrl:'https://example.com',invite:'ab'.repeat(32),randomBytes:bytes=>new Uint8Array(bytes).fill(++n),...options});const channel:any={readyState:'open',bufferedAmount:0,send:(raw:string)=>frames.push(JSON.parse(raw)),close:()=>{channel.readyState='closed';}};(session as any).attachChannel(channel);return {session,frames,receive:(frame:DataFrame)=>channel.onmessage?.({data:JSON.stringify(frame)}),internal:session as any};
}
function attach(manager:ReturnType<typeof client>){const t=transport({onMessage:m=>manager.internal.receiveMessage(alice.userId,m),onFile:f=>manager.internal.receiveFile(alice.userId,f),onApplication:p=>manager.internal.receiveApplication(alice.userId,p)});manager.internal.pairs.set(alice.userId,{session:t.session,attempt:0,flushing:false,notified:false,lastUsed:Date.now(),lastSent:new Map(),definitions:new Set()});return t;}
describe('terminal durable background runtime shutdown',()=>{
 it('waits for a delayed text receive write, suppresses stale ACK and prevents old-instance writes after recreation',async()=>{
  const f=client();const id=await f.m.addContact(user);await f.internal.durable();const t=attach(f);const gate=deferred();let entered=false;
  // Keep a real encrypted backing write after the deliberate delay.
  const actual=storage();f.internal.options.saveState=async(value:string)=>{entered=true;await gate.promise;await actual.saveState(value);};
  t.receive({kind:'text',id:'aa'.repeat(16),conversationId:id,text:'received before drain',timestamp:Date.now()});await vi.waitFor(()=>expect(entered).toBe(true));let settled=false;const close=f.m.disconnectAndFlush().then(()=>{settled=true;});await Promise.resolve();expect(settled).toBe(false);gate.resolve();await close;expect(t.frames).toEqual([]);expect((openLocalState(bob,actual.sealed!) as any).conversations[0].messages[0].text).toBe('received before drain');
  const next=client(actual);await next.internal.restore();expect(next.m.getSnapshot().conversations[0]?.messages[0]?.text).toBe('received before drain');const count=actual.saveState.mock.calls.length;await new Promise(yes=>setTimeout(yes,300));expect(actual.saveState.mock.calls.length).toBe(count);await expect(f.m.sendText(id,'late write')).rejects.toThrow(/disposed/);await expect(f.m.connect()).rejects.toThrow(/disposed/);f.m.markRead(id);expect(actual.saveState.mock.calls.length).toBe(count);
 });
 it('waits for incoming file bytes then metadata and drops queued post-close receives',async()=>{
  const f=client();const id=await f.m.addContact(user);await f.internal.durable();const t=attach(f),gate=deferred();let entered=false;const save=f.store.saveAttachment;f.internal.options.saveAttachment=async(key:string,sealed:string)=>{entered=true;await gate.promise;await save(key,sealed);};
  for(const frame of [{kind:'file-start',id:'ab'.repeat(16),conversationId:id,name:'durable.bin',mime:'',size:2},{kind:'file-chunk',id:'ab'.repeat(16),offset:0,hex:'0102'},{kind:'file-end',id:'ab'.repeat(16)}] as DataFrame[])t.receive(frame);
  await vi.waitFor(()=>expect(entered).toBe(true));t.receive({kind:'text',id:'ac'.repeat(16),conversationId:id,text:'queued only',timestamp:Date.now()});let settled=false;const close=f.m.disconnectAndFlush().then(()=>{settled=true;});await Promise.resolve();expect(settled).toBe(false);gate.resolve();await close;expect(t.frames).toEqual([]);
  const next=client(f.store);await next.m.addContact(user);expect(await next.m.getFileData(id,'ab'.repeat(16),alice.userId)).toEqual(new Uint8Array([1,2]));expect(next.m.getSnapshot().conversations[0]?.messages).toEqual([]);
 });
 it('drains an already enqueued local file and its metadata before a new manager loads storage',async()=>{
  const f=client();const id=await f.m.addContact(user);await f.internal.durable();const gate=deferred();let entered=false;const save=f.store.saveAttachment;f.internal.options.saveAttachment=async(key:string,sealed:string)=>{entered=true;await gate.promise;await save(key,sealed);};
  const sending=f.m.sendFile(id,{name:'pending.bin',mime:'',data:new Uint8Array([3,4])});await vi.waitFor(()=>expect(entered).toBe(true));let settled=false;const close=f.m.disconnectAndFlush().then(()=>{settled=true;});expect(f.m.disconnectAndFlush()).toBe((f.internal.shutdown));await Promise.resolve();expect(settled).toBe(false);gate.resolve();await sending;await close;
  const next=client(f.store);await next.m.addContact(user);const file=next.m.getSnapshot().conversations[0]!.files[0]!;expect(file.deliveryStatus).toBe('pending');expect(await next.m.getFileData(id,file.id)).toEqual(new Uint8Array([3,4]));
 });
 it('rejects shutdown on persistent save failure instead of claiming a durable completion',async()=>{
  const f=client();await f.m.addContact(user);const save=vi.fn(async()=>{throw new Error('persistent disk failure');});f.internal.options.saveState=save;await expect(f.m.disconnectAndFlush()).rejects.toThrow('persistent disk failure');const count=save.mock.calls.length;f.m.disconnect();await Promise.resolve();expect(save).toHaveBeenCalledTimes(count);
 });
 it('returns the same disposal promise when an onChange callback reenters shutdown',async()=>{
  const f=client();await f.m.addContact(user);let fromCallback:Promise<void>|undefined;f.internal.options.onChange=()=>{fromCallback=f.m.disconnectAndFlush();};const closed=f.m.disconnectAndFlush();expect(fromCallback).toBe(closed);await closed;
 });
 it('session drain still waits for callbacks after a prior channel-close queue reset',async()=>{
  const gate=deferred();let entered=false;const t=transport({onMessage:async()=>{entered=true;await gate.promise;}});t.receive({kind:'text',id:'aa'.repeat(16),text:'delayed',timestamp:1});await vi.waitFor(()=>expect(entered).toBe(true));const channel=t.internal.channel;channel.readyState='closed';channel.onclose();let settled=false;const close=t.session.disconnectAndFlush().then(()=>{settled=true;});await Promise.resolve();expect(settled).toBe(false);gate.resolve();await close;expect(t.frames).toEqual([]);
 });
 it('keeps the original synchronous disconnect reconnectable',async()=>{
  const f=client();const id=await f.m.addContact(user);f.m.disconnect();await f.m.sendText(id,'offline enqueue remains supported');expect(f.m.getSnapshot().conversations[0]!.messages[0]!.status).toBe('pending');await f.m.disconnectAndFlush();
 });
});
