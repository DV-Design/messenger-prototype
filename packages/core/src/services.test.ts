import {describe,it,expect,vi} from 'vitest';
import {sha256} from '@noble/hashes/sha2.js';
import {bytesToHex} from './crypto.js';
import {createDeviceIdentity,directoryClientFrameSchema,directoryServerFrameSchema,type DirectoryUser} from './directory.js';
import {MessengerClient} from './messenger.js';
import {PeerSession} from './session.js';
import {normalizePhone,phoneLookupHash} from './services.js';
const identity=createDeviceIdentity(n=>new Uint8Array(n).fill(71));const remote=createDeviceIdentity(n=>new Uint8Array(n).fill(72));
const user:DirectoryUser={userId:identity.userId,publicKey:identity.publicKey,username:'alice',displayName:'Alice',online:true,lastSeen:1};
const other:DirectoryUser={userId:remote.userId,publicKey:remote.publicKey,username:'bob',displayName:'Bob',online:true,lastSeen:1};
function random(){let i=0;return(n:number)=>{const b=new Uint8Array(n);new DataView(b.buffer).setUint32(0,++i);return b;};}
async function fixture(pushCapability?:boolean){
 let socket!:Socket;const sent:any[]=[];
 class Socket {readyState=1;onmessage:((e:{data:string})=>void)|null=null;onclose:(()=>void)|null=null;onerror:(()=>void)|null=null;
  constructor(){socket=this;queueMicrotask(()=>this.push({type:'challenge',challenge:'ab'.repeat(32)}));}
  send(raw:string){const frame=JSON.parse(raw);sent.push(frame);if(frame.type==='authenticate')queueMicrotask(()=>this.push({type:'ready',self:user}));if(frame.type==='services'&&pushCapability!==undefined)queueMicrotask(()=>this.push({type:'services',requestId:frame.requestId,capabilities:{phoneVerification:false,push:pushCapability,relay:false,phoneVerified:false}}));}
  push(frame:unknown){this.onmessage?.({data:JSON.stringify(frame)});}
  close(){this.readyState=3;queueMicrotask(()=>this.onclose?.());}
 }
 vi.stubGlobal('WebSocket',Socket);const client=new MessengerClient({serverUrl:'https://example.com/messenger',identity,username:'alice',displayName:'Alice',randomBytes:random()});await client.connect();
 return {client,socket,sent,close:()=>{client.disconnect();vi.unstubAllGlobals();}};
}
describe('canonical phone lookup',()=>{
 it('normalizes whole RU inputs and hashes exactly the frozen domain-separated E164 payload',()=>{
  const e164='+79991234567';expect(normalizePhone('8 (999) 123-45-67','RU')).toBe(e164);expect(normalizePhone(e164)).toBe(e164);
  expect(phoneLookupHash(e164)).toBe(bytesToHex(sha256(new TextEncoder().encode(JSON.stringify(['lastcall/phone-lookup/v1',e164])))));
  for(const input of ['contact +79991234567','+79991234567 ext 123','112','+0','not a number'])expect(()=>normalizePhone(input,'RU')).toThrow(/Invalid/);
  expect(()=>phoneLookupHash('8 (999) 123-45-67')).toThrow();
 });
 it('strictly bounds service frames and forbids content in wake/control requests',()=>{
  expect(directoryClientFrameSchema.safeParse({type:'wake',to:remote.userId,text:'secret'}).success).toBe(false);
  expect(directoryClientFrameSchema.safeParse({type:'phone-discover',requestId:'ab'.repeat(16),hashes:Array(101).fill('cd'.repeat(32))}).success).toBe(false);
  expect(directoryClientFrameSchema.safeParse({type:'push-register',requestId:'ab'.repeat(16),token:'x'.repeat(4097)}).success).toBe(false);
  expect(directoryServerFrameSchema.safeParse({type:'services',requestId:'ab'.repeat(16),capabilities:{phoneVerification:false,push:false,relay:false}}).success).toBe(false);
  expect(directoryServerFrameSchema.safeParse({type:'ice',requestId:'ab'.repeat(16),iceServers:Array(21).fill({urls:'turn:relay.example:3478'})}).success).toBe(false);
 });
});
describe('authenticated correlated service requests',()=>{
 it('sends no new service frames spontaneously and resolves only the matching response type/id',async()=>{
  const f=await fixture();try{
   expect(f.sent.map(x=>x.type)).toEqual(['authenticate','watch']);
   const capabilities=f.client.getServices();const push=f.client.registerPushToken('device-token');const rejected=expect(push).rejects.toThrow(/response type/);
   const serviceFrame=f.sent.find(x=>x.type==='services');const pushFrame=f.sent.find(x=>x.type==='push-register');
   f.socket.push({type:'services',requestId:pushFrame.requestId,capabilities:{phoneVerification:false,push:false,relay:false,phoneVerified:false}});await rejected;
   f.socket.push({type:'services',requestId:'ef'.repeat(16),capabilities:{phoneVerification:true,push:true,relay:true,phoneVerified:true}});
   f.socket.push({type:'services',requestId:serviceFrame.requestId,capabilities:{phoneVerification:false,push:false,relay:false,phoneVerified:false}});
   expect(await capabilities).toEqual({phoneVerification:false,push:false,relay:false,phoneVerified:false});
  }finally{f.close();}
 });
 it('maps phone challenge/verify/discovery and provider errors without inventing success',async()=>{
  const f=await fixture();try{
   const challenge=f.client.startPhoneVerification('8 (999) 123-45-67');const start=f.sent.find(x=>x.type==='phone-start');expect(start.phone).toBe('+79991234567');
   f.socket.push({type:'phone-challenge',requestId:start.requestId,challenge:{challengeId:'ab'.repeat(16),expiresAt:100000,retryAt:60000}});expect((await challenge).challengeId).toBe('ab'.repeat(16));
   const verify=f.client.verifyPhone('ab'.repeat(16),'123456');f.socket.push({type:'phone-verified',requestId:f.sent.at(-1).requestId});await verify;
   const matches=f.client.discoverPhones([phoneLookupHash('+79991234567')]);f.socket.push({type:'phone-matches',requestId:f.sent.at(-1).requestId,matches:[{hash:phoneLookupHash('+79991234567'),user:other}]});expect((await matches)[0]?.user.userId).toBe(remote.userId);
   const rejected=f.client.registerPushToken('device-token');const error=expect(rejected).rejects.toThrow('Service unavailable');f.socket.push({type:'error',requestId:f.sent.at(-1).requestId,code:'service-unavailable',message:'Service unavailable'});await error;
  }finally{f.close();}
 });
 it('coalesces concurrent authenticated ICE requests and isolates callers from native config mutation',async()=>{
  const f=await fixture();try{
   const a=f.client.getIceServers();const b=f.client.getIceServers();expect(f.sent.filter(x=>x.type==='ice')).toHaveLength(1);
   f.socket.push({type:'ice',requestId:f.sent.at(-1).requestId,iceServers:[{urls:['turn:relay.example:3478'],username:'temporary-user',credential:'temporary-password'}]});
   const [first,second]=await Promise.all([a,b]);(first[0]!.urls as string[])[0]='stun:changed.invalid';expect(second[0]!.urls).toEqual(['turn:relay.example:3478']);
  }finally{f.close();}
 });
 it('bounds outstanding requests and clears timeout/disconnect state',async()=>{
  const f=await fixture();vi.useFakeTimers();try{
   const pending=Array.from({length:32},(_,index)=>f.client.registerPushToken('token-'+index));const results=Promise.allSettled(pending);await expect(f.client.getServices()).rejects.toThrow(/Too many/);
   await vi.advanceTimersByTimeAsync(10001);expect((await results).every(r=>r.status==='rejected')).toBe(true);
   const cancelled=f.client.getServices();const rejected=expect(cancelled).rejects.toThrow(/Disconnected/);f.client.disconnect();await rejected;expect((f.client as any).requests.size).toBe(0);
  }finally{f.close();vi.useRealTimers();}
 });
 it('creates one RTC instance when concurrent connects await an asynchronous ICE provider',async()=>{
  let release!:(servers:RTCIceServer[])=>void;const configuration=new Promise<RTCIceServer[]>(resolve=>{release=resolve;});const provider=vi.fn(()=>configuration);
  class Socket {readyState=1;onopen:any;onmessage:any;onclose:any;onerror:any;constructor(){queueMicrotask(()=>this.onopen?.());}send(raw:string){const frame=JSON.parse(raw);if(frame.type==='join')queueMicrotask(()=>this.onmessage?.({data:JSON.stringify({type:'joined',roomId:frame.roomId,peerId:frame.peerId,role:'initiator',peerPresent:false})}));}close(){this.readyState=3;}}
  const pc:any={createDataChannel:()=>({readyState:'connecting',close:()=>{}}),getSenders:()=>[],close:()=>{}};const factory=vi.fn(()=>pc);vi.stubGlobal('WebSocket',Socket);
  const peer=new PeerSession({serverUrl:'https://example.com/messenger',invite:'ab'.repeat(32),randomBytes:random(),rtcFactory:factory,getIceServers:provider});
  try{const first=peer.connect();await peer.connect();expect(factory).not.toHaveBeenCalled();release([]);await first;expect(provider).toHaveBeenCalledTimes(1);expect(factory).toHaveBeenCalledTimes(1);}finally{peer.disconnect();vi.unstubAllGlobals();}
 });
 it('does not bypass a failed authenticated provider through legacy public GET',async()=>{
  const fetch=vi.fn();vi.stubGlobal('fetch',fetch);const factory=vi.fn();
  const peer=new PeerSession({serverUrl:'https://example.com/messenger',invite:'ab'.repeat(32),randomBytes:random(),rtcFactory:factory,getIceServers:async()=>{throw new Error('Authenticated ICE unavailable');}});
  try{await expect(peer.connect()).rejects.toThrow('Authenticated ICE unavailable');expect(fetch).not.toHaveBeenCalled();expect(factory).not.toHaveBeenCalled();}finally{peer.disconnect();vi.unstubAllGlobals();}
 });
});
describe('bounded content-free pending wake intents',()=>{
 it('wakes offline or directory-online suspended recipients only while awaiting real ACK, at most once per30s',async()=>{
  const f=await fixture(true);vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-28T08:00:00Z'));
  try{
   // Treat online presence as distinct from a responding P2P transport.
   const id=await f.client.addContact({...other,online:false});(f.client as any).contacts.set(other.userId,{...other,online:true});(f.client as any).ensurePair=async()=>({session:{getSnapshot:()=>({status:'waiting'})}});
   expect(f.sent.filter(x=>x.type==='wake')).toHaveLength(0);await f.client.sendText(id,'private content stays local');await vi.advanceTimersByTimeAsync(0);
   expect(f.sent.filter(x=>x.type==='wake')).toEqual([{type:'wake',to:other.userId}]);expect(JSON.stringify(f.sent.filter(x=>x.type==='wake'))).not.toContain('private');
   await f.client.sendText(id,'second private text');await vi.advanceTimersByTimeAsync(29999);expect(f.sent.filter(x=>x.type==='wake')).toHaveLength(1);
   await vi.advanceTimersByTimeAsync(1);expect(f.sent.filter(x=>x.type==='wake')).toHaveLength(2);expect(f.client.getSnapshot().conversations[0]?.messages.every(x=>x.status==='pending')).toBe(true);
   for(const message of f.client.getSnapshot().conversations[0]!.messages)(f.client as any).receiveMessage(other.userId,{id:message.id,text:message.text,from:'self',timestamp:message.timestamp,status:'delivered',conversationId:id});
   expect(f.client.getSnapshot().conversations[0]?.messages.every(x=>x.status==='delivered')).toBe(true);await vi.advanceTimersByTimeAsync(60000);expect(f.sent.filter(x=>x.type==='wake')).toHaveLength(2);
  }finally{f.close();vi.useRealTimers();}
 });
});

describe('disabled push capability',()=>{
 it('coalesces capabilities, protects cached values and refreshes them on directory reconnect',async()=>{
  const f=await fixture(true);try{
   const [a,b]=await Promise.all([f.client.getServices(),f.client.getServices()]);expect(f.sent.filter(frame=>frame.type==='services')).toHaveLength(1);a.push=false;expect(b.push).toBe(true);expect((await f.client.getServices()).push).toBe(true);
   f.socket.close();await Promise.resolve();await f.client.connect();expect((await f.client.getServices()).push).toBe(true);expect(f.sent.filter(frame=>frame.type==='services')).toHaveLength(2);
  }finally{f.close();}
 });
 it('keeps ordinary pending texts free of false service errors when the preview has no push provider',async()=>{
  const f=await fixture();const send=f.socket.send.bind(f.socket);
  f.socket.send=(raw:string)=>{send(raw);const frame=JSON.parse(raw);if(frame.type==='services')f.socket.push({type:'services',requestId:frame.requestId,capabilities:{phoneVerification:false,push:false,relay:false,phoneVerified:false}});if(frame.type==='wake')f.socket.push({type:'error',code:'service-unavailable',message:'Push service unavailable'});};
  try{const id=await f.client.addContact({...other,online:false});await f.client.sendText(id,'ordinary pending text');await Promise.resolve();await Promise.resolve();expect(f.sent.filter(frame=>frame.type==='wake')).toHaveLength(0);expect(f.client.getSnapshot().error).toBeUndefined();expect(f.client.getSnapshot().conversations[0]?.messages[0]?.status).toBe('pending');}finally{f.close();}
 });
});
