import {afterEach,describe,expect,it,vi} from 'vitest';
import {createDeviceIdentity,directoryClientFrameSchema,wakeIntentSchema,type DirectoryUser} from './directory.js';
import {MessengerClient} from './messenger.js';
import {decryptPushPreview} from './push-preview.js';
const alice=createDeviceIdentity(n=>new Uint8Array(n).fill(91));
const bob=createDeviceIdentity(n=>new Uint8Array(n).fill(92));
const contact:DirectoryUser={userId:bob.userId,publicKey:bob.publicKey,username:'bob',displayName:'Bob',online:false,lastSeen:1};
async function fixture(){
 vi.useFakeTimers();let counter=0;
 const client=new MessengerClient({serverUrl:'https://example.com',identity:alice,username:'alice',displayName:'Alice',randomBytes:n=>{const bytes=new Uint8Array(n);new DataView(bytes.buffer).setUint32(0,++counter);return bytes;}});
 const id=await client.addContact(contact);const internal=client as any;const sent:any[]=[];const events:string[]=[];
 internal.stopped=false;internal.status='online';internal.socket={readyState:1,send:(raw:string)=>{sent.push(JSON.parse(raw));events.push(JSON.parse(raw).type);},close:()=>{}};
 internal.services={push:true,phoneVerification:false,phoneVerified:false,relay:false};
 const snapshot:any={status:'waiting',callState:'idle',messages:[],files:[],stats:{},muted:false,route:'unknown'};
 const session={getSnapshot:()=>snapshot,startCall:vi.fn(async()=>{}),endCall:vi.fn(),sendFile:vi.fn(async()=>{}),sendText:vi.fn(async()=>{}),disconnect:vi.fn()};
 const pair={session,flushing:false,attempt:0,notified:true,lastUsed:0,lastSent:new Map(),definitions:new Set()};
 internal.ensurePair=vi.fn(async()=>{events.push('direct');internal.pairs.set(bob.userId,pair);return pair;});
 return {client,id,internal,sent,events,snapshot,session,pair};
}
afterEach(()=>vi.useRealTimers());
describe('strict typed metadata only',()=>{
 it('accepts legacy or complete metadata and rejects partial/extra/non-safe fields',()=>{
  const intent={kind:'call',intentId:'ab'.repeat(16),expiresAt:Date.now()+30000};
  expect(wakeIntentSchema.safeParse(intent).success).toBe(true);
  expect(directoryClientFrameSchema.safeParse({type:'wake',to:bob.userId}).success).toBe(true);
  expect(directoryClientFrameSchema.safeParse({type:'wake',to:bob.userId,...intent}).success).toBe(true);
  for(const value of [{kind:'call'},{intentId:intent.intentId},{kind:'call',intentId:intent.intentId},{...intent,text:'secret'},{...intent,expiresAt:Number.MAX_SAFE_INTEGER+1},{...intent,expiresAt:1.5}])expect(directoryClientFrameSchema.safeParse({type:'wake',to:bob.userId,...value}).success).toBe(false);
 });
});
describe('direct first message grace',()=>{
 it('attempts direct immediately and suppresses wake when recipient ACK arrives within grace',async()=>{
  const f=await fixture();try{
   f.internal.contacts.set(bob.userId,{...contact,online:true});await f.client.sendText(f.id,'private');
   expect(f.events[0]).toBe('direct');expect(f.sent.filter(x=>x.type==='wake')).toHaveLength(0);
   await vi.advanceTimersByTimeAsync(2000);const message=f.client.getSnapshot().conversations[0]!.messages[0]!;
   f.internal.receiveMessage(bob.userId,{...message,from:'self',status:'delivered'});
   await vi.advanceTimersByTimeAsync(90000);expect(f.sent.filter(x=>x.type==='wake')).toHaveLength(0);
  }finally{f.client.disconnect();}
 });
 it('uses fresh expiring IDs at most once/30s and wall-clock rollback cannot strand retries',async()=>{
  const f=await fixture();try{
   await f.client.sendText(f.id,'private');await vi.advanceTimersByTimeAsync(2500);
   const first=f.sent.find(x=>x.type==='wake');expect(first.kind).toBe('message');expect(first.expiresAt-Date.now()).toBe(60000);
   vi.setSystemTime(Date.now()-120000);await vi.advanceTimersByTimeAsync(30000);
   const wakes=f.sent.filter(x=>x.type==='wake');expect(wakes).toHaveLength(2);expect(wakes[1].intentId).not.toBe(first.intentId);expect(wakes[1].expiresAt-Date.now()).toBe(60000);
   expect(f.client.getSnapshot().conversations[0]!.messages[0]!.status).toBe('pending');
  }finally{f.client.disconnect();}
 });
});
describe('bounded sender-local calls and files',()=>{
 it('gives a new call its own wake after a prior pending call ends within30s',async()=>{
  const f=await fixture();try{
   const first=f.client.startCall(f.id);const firstResult=expect(first).rejects.toThrow(/cancelled/);await vi.advanceTimersByTimeAsync(2500);expect(f.sent.filter(frame=>frame.type==='wake'&&frame.kind==='call')).toHaveLength(1);f.client.endCall();await firstResult;
   const second=f.client.startCall(f.id);const secondResult=expect(second).rejects.toThrow(/cancelled/);await vi.advanceTimersByTimeAsync(2499);expect(f.sent.filter(frame=>frame.type==='wake'&&frame.kind==='call')).toHaveLength(1);await vi.advanceTimersByTimeAsync(1);const wakes=f.sent.filter(frame=>frame.type==='wake'&&frame.kind==='call');expect(wakes).toHaveLength(2);expect(wakes[0].intentId).not.toBe(wakes[1].intentId);f.client.endCall();await secondResult;
  }finally{f.client.disconnect();}
 });
 it('shows local outgoing immediately, cancels before transport, and cannot start later',async()=>{
  const f=await fixture();try{
   const pending=f.client.startCall(f.id,true);const result=expect(pending).rejects.toThrow(/cancelled/);
   expect(f.client.getSnapshot().activeCall?.session.callState).toBe('outgoing');expect(f.session.startCall).not.toHaveBeenCalled();
   await vi.advanceTimersByTimeAsync(2000);f.client.endCall();await result;f.snapshot.status='connected';await vi.advanceTimersByTimeAsync(60000);
   expect(f.client.getSnapshot().activeCall).toBeUndefined();expect(f.session.startCall).not.toHaveBeenCalled();expect(f.sent.filter(x=>x.type==='wake')).toHaveLength(0);
  }finally{f.client.disconnect();}
 });
 it('bounds call wait to30s, emits only short call wake, and never auto-starts after expiry',async()=>{
  const f=await fixture();try{
   const pending=f.client.startCall(f.id);const result=expect(pending).rejects.toThrow(/timed out/);
   await vi.advanceTimersByTimeAsync(2500);const wake=f.sent.find(x=>x.type==='wake');expect(wake.kind).toBe('call');expect(wake.expiresAt-Date.now()).toBeLessThanOrEqual(27500);
   await vi.advanceTimersByTimeAsync(27500);await result;f.snapshot.status='connected';await vi.advanceTimersByTimeAsync(30000);expect(f.session.startCall).not.toHaveBeenCalled();expect(f.client.getSnapshot().activeCall).toBeUndefined();
  }finally{f.client.disconnect();}
 });
 it('cancels microphone startup at deadline so a late permission result cannot invite',async()=>{
  const f=await fixture();let release!:()=>void;
  try{
   f.snapshot.status='connected';f.internal.pairs.set(bob.userId,f.pair);
   let cancelled=false;let invited=false;
   f.session.endCall.mockImplementation(()=>{cancelled=true;});
   f.session.startCall.mockImplementation(async()=>{await new Promise<void>(resolve=>{release=resolve;});if(!cancelled)invited=true;});
   const pending=f.client.startCall(f.id);const result=expect(pending).rejects.toThrow(/timed out/);
   await vi.advanceTimersByTimeAsync(30000);await result;expect(f.session.endCall).toHaveBeenCalled();release();await Promise.resolve();expect(invited).toBe(false);expect(f.client.getSnapshot().activeCall).toBeUndefined();
  }finally{release?.();f.client.disconnect();}
 });
 it('keeps bounded files pending beyond the former60second wait and emits file wake',async()=>{
  const f=await fixture();try{
   const file={name:'file',mime:'application/octet-stream',data:new Uint8Array([1])};
   await expect(f.client.sendFile(f.id,{...file,data:new Uint8Array(5*1024*1024+1)})).rejects.toThrow(/5 MiB/);
   await f.client.sendFile(f.id,file);await vi.advanceTimersByTimeAsync(2500);expect(f.sent.find(x=>x.type==='wake').kind).toBe('file');
   await vi.advanceTimersByTimeAsync(60000);expect(f.client.getSnapshot().conversations[0]!.files[0]!.deliveryStatus).toBe('pending');expect(f.session.sendFile).not.toHaveBeenCalled();
  }finally{f.client.disconnect();}
 });
 it('sends each pending file origin as its own encrypted filename preview',async()=>{
  const f=await fixture();try{
   await f.client.sendFile(f.id,{name:'private-one.jpg',mime:'image/jpeg',data:new Uint8Array([73,74,75])});
   await f.client.sendFile(f.id,{name:'private-two.jpg',mime:'image/jpeg',data:new Uint8Array([76,77,78])});
   await vi.advanceTimersByTimeAsync(2500);const wakes=f.sent.filter(frame=>frame.type==='wake');expect(wakes).toHaveLength(2);
   const opened=wakes.map(frame=>decryptPushPreview(bob,alice.publicKey,frame.preview,{kind:frame.kind,intentId:frame.intentId,expiresAt:frame.expiresAt}));
   expect(opened.map(value=>value.text).sort()).toEqual(['Файл: private-one.jpg','Файл: private-two.jpg']);
   expect(new Set(opened.map(value=>value.messageId)).size).toBe(2);expect(opened.every(value=>value.kind==='file'&&value.conversationId===f.id)).toBe(true);
   expect(JSON.stringify(wakes)).not.toContain('private-');expect(JSON.stringify(wakes)).not.toContain('data');
   for(const frame of wakes)expect(directoryClientFrameSchema.safeParse(frame).success).toBe(true);
  }finally{f.client.disconnect();}
 });
 it('starts only after direct connection and disconnect cancels pending work',async()=>{
  const f=await fixture();try{
   const pending=f.client.sendFile(f.id,{name:'file',mime:'',data:new Uint8Array([1,2])});await vi.advanceTimersByTimeAsync(2000);f.snapshot.status='connected';f.internal.pairs.set(bob.userId,f.pair);await f.internal.flushPeer(bob.userId);await pending;expect(f.session.sendFile).toHaveBeenCalledTimes(1);expect(f.sent.filter(x=>x.type==='wake')).toHaveLength(0);
   f.snapshot.status='waiting';const call=f.client.startCall(f.id);const rejected=expect(call).rejects.toThrow(/cancelled/);f.client.disconnect();await rejected;f.snapshot.status='connected';await vi.advanceTimersByTimeAsync(60000);expect(f.session.startCall).not.toHaveBeenCalled();
  }finally{f.client.disconnect();}
 });
});
describe('a connected but background-suspended recipient still receives call wake',()=>{
 async function connected(){const f=await fixture();f.snapshot.status='connected';f.internal.pairs.set(bob.userId,f.pair);let call=0;f.session.startCall.mockImplementation(async(...args:any[])=>{f.snapshot.callId=args[1]?.callId??(++call).toString(16).padStart(32,'0');f.snapshot.callState='outgoing';});f.session.endCall.mockImplementation(()=>{f.snapshot.callState='idle';f.snapshot.callId=undefined;});return f;}
 it('tries encrypted invite first, then wakes a still-unanswered call despite connected RTC',async()=>{
  const f=await connected();try{await f.client.startCall(f.id);expect(f.session.startCall).toHaveBeenCalledTimes(1);await vi.advanceTimersByTimeAsync(2499);expect(f.sent.filter(x=>x.type==='wake')).toHaveLength(0);await vi.advanceTimersByTimeAsync(1);const wakes=f.sent.filter(x=>x.type==='wake');expect(wakes).toHaveLength(1);expect(wakes[0].kind).toBe('call');expect(wakes[0].expiresAt-Date.now()).toBeLessThanOrEqual(27500);await vi.advanceTimersByTimeAsync(60000);expect(f.sent.filter(x=>x.type==='wake')).toHaveLength(1);}finally{f.client.disconnect();}
 });
 it('does not wake an answered or cancelled call before fallback',async()=>{
  for(const answer of [true,false]){const f=await connected();try{await f.client.startCall(f.id);if(answer){f.snapshot.callState='active';f.internal.pairChanged(bob.userId,f.snapshot);}else f.client.endCall();await vi.advanceTimersByTimeAsync(3000);expect(f.sent.filter(x=>x.type==='wake')).toHaveLength(0);}finally{f.client.disconnect();}}
 });
 it('rechecks cancellation after asynchronous push capability lookup',async()=>{
  const f=await connected();let release!:(v:any)=>void;try{f.internal.getServices=()=>new Promise(resolve=>{release=resolve;});await f.client.startCall(f.id);await vi.advanceTimersByTimeAsync(2500);expect(release).toBeDefined();f.client.endCall();release({push:true});await vi.advanceTimersByTimeAsync(1);expect(f.sent.filter(x=>x.type==='wake')).toHaveLength(0);}finally{f.client.disconnect();}
 });
 it('an old lookup cannot wake a new call; the new call owns its own grace and intent',async()=>{
  const f=await connected();let release!:(v:any)=>void;try{const normal=f.internal.getServices.bind(f.internal);f.internal.getServices=()=>new Promise(resolve=>{release=resolve;});await f.client.startCall(f.id);await vi.advanceTimersByTimeAsync(2500);f.client.endCall();f.internal.getServices=normal;await f.client.startCall(f.id);release({push:true});await vi.advanceTimersByTimeAsync(1);expect(f.sent.filter(x=>x.type==='wake')).toHaveLength(0);await vi.advanceTimersByTimeAsync(2499);expect(f.sent.filter(x=>x.type==='wake')).toHaveLength(1);}finally{f.client.disconnect();}
 });
 it('keeps the original cold-connect wake cooldown after the invite is sent',async()=>{
  const f=await fixture();try{f.session.startCall.mockImplementation(async(...args:any[])=>{f.snapshot.callId=args[1]?.callId??'ef'.repeat(16);f.snapshot.callState='outgoing';});const starting=f.client.startCall(f.id);await vi.advanceTimersByTimeAsync(2500);expect(f.sent.filter(x=>x.type==='wake')).toHaveLength(1);f.snapshot.status='connected';await vi.advanceTimersByTimeAsync(100);await starting;await vi.advanceTimersByTimeAsync(2500);expect(f.sent.filter(x=>x.type==='wake')).toHaveLength(1);}finally{f.client.disconnect();}
 });
});
