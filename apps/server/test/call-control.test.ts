import {DatabaseSync} from 'node:sqlite';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {WebSocket} from 'ws';
import {createDeviceIdentity,directConversationId,encryptCallPush,decryptCallPush,directoryServerFrameSchema,signAuthentication,type DeviceIdentity,type DirectoryUser,type DirectoryServerFrame,type CallState} from '@messenger/core';
import {CallRegistry} from '../src/call-registry.js';
import {DirectoryServices} from '../src/services.js';
import {buildFcmWakeMessage,type PushProvider} from '../src/providers.js';
import {createSignalingServer} from '../src/server.js';

const alice=createDeviceIdentity(n=>new Uint8Array(n).fill(151)),bob=createDeviceIdentity(n=>new Uint8Array(n).fill(152)),other=createDeviceIdentity(n=>new Uint8Array(n).fill(153));
const profile=(identity:DeviceIdentity,name:string):DirectoryUser=>({userId:identity.userId,publicKey:identity.publicKey,username:name,displayName:name,online:false,lastSeen:1});
const users=[profile(alice,'alice'),profile(bob,'bob'),profile(other,'other')];
let sequence=0;const id=()=> (++sequence).toString(16).padStart(32,'0');
const disposals:Array<()=>Promise<void>>=[];
afterEach(async()=>{for(const dispose of disposals.splice(0))await dispose();});
function fixture(sendWake=vi.fn<PushProvider['sendWake']>(async()=>{})){
 let now=1800000000000;const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE directory_users(user_id TEXT PRIMARY KEY)');for(const user of users)db.prepare('INSERT INTO directory_users VALUES (?)').run(user.userId);
 const events:CallState[]=[],invites:string[]=[];
 const services=new DirectoryServices(db,{serviceNow:()=>now,pushProvider:{sendWake},providerTimeoutMs:100},value=>users.find(user=>user.userId===value),()=>[],value=>events.push(value),(_recipient,invite)=>invites.push(invite));
 disposals.push(async()=>{await services.close();db.close();});
 services.replaceWatchConsent(bob.userId,[alice.userId]);services.replaceWatchConsent(alice.userId,[bob.userId]);
 services.registerPush(bob.userId,'bob-token',true,false,true);services.registerPush(alice.userId,'alice-token',true,false,true);
 const epoch=services.capabilities(alice.userId,true).serverEpoch!;
 const offer=()=>{const timing={callId:id(),issuedAt:now,expiresAt:now+30000,serverEpoch:epoch};return {timing,invite:encryptCallPush(alice,bob.publicKey,timing,epoch,{conversationId:directConversationId(alice.userId,bob.userId),video:true})};};
 return {db,services,events,invites,sendWake,epoch,offer,get now(){return now;},advance:(ms:number)=>{now+=ms;}};
}

describe('bounded metadata-only call coordination',()=>{
 it('separates callee ringing/accept intent from media and enforces roles/idempotence',async()=>{
  const f=fixture(),call=f.offer();const pending=await f.services.callOffer(alice.userId,bob.userId,call.timing,call.invite);expect(pending).toMatchObject({state:'pending',revision:1});expect(f.sendWake.mock.calls[0]?.[4]).toBe(call.invite);
  expect(()=>f.services.callReceived(alice.userId,bob.userId,call.timing.callId,f.epoch)).toThrow(/callee/);
  const ringing=f.services.callReceived(bob.userId,alice.userId,call.timing.callId,f.epoch);expect(ringing).toMatchObject({state:'ringing',revision:2});
  await expect(f.services.callAction(alice.userId,bob.userId,'accept',call.timing)).rejects.toThrow(/participant/);
  const accepted=await f.services.callAction(bob.userId,alice.userId,'accept',call.timing);expect(accepted).toMatchObject({state:'accepted',revision:3});expect((accepted as any).mediaConnected).toBeUndefined();
  expect(await f.services.callAction(bob.userId,alice.userId,'accept',call.timing)).toEqual(accepted);
  await expect(f.services.callAction(bob.userId,alice.userId,'cancel',call.timing)).rejects.toThrow(/participant/);
  const ended=await f.services.callAction(alice.userId,bob.userId,'end',call.timing);expect(ended).toMatchObject({state:'ended',revision:4});const count=f.sendWake.mock.calls.length;
  expect(await f.services.callAction(alice.userId,bob.userId,'end',call.timing)).toEqual(ended);expect(f.sendWake.mock.calls.length).toBe(count);
  expect(f.services.callReceived(bob.userId,alice.userId,call.timing.callId,f.epoch).state).toBe('ended');
 });
 it('does not store envelope/request fields even when RPC objects contain them',async()=>{
  const f=fixture(),call=f.offer();await f.services.callOffer(alice.userId,bob.userId,{...call.timing,invite:call.invite,requestId:id()} as typeof call.timing,call.invite);
  const state=f.services.callState(alice.userId,bob.userId,call.timing.callId,f.epoch);expect(Object.keys(state).sort()).toEqual(['callId','calleeId','callerId','expiresAt','issuedAt','revision','serverEpoch','state'].sort());
  const registry=(f.services as any).calls;expect(JSON.stringify([...registry.calls.values()])).not.toContain('ciphertext');expect(f.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%call%'").all()).toEqual([{name:'wake_call_last_attempt'}]);
 });
 it('retains a cancel-before-offer tombstone until exactly the original expiry',async()=>{
  const f=fixture(),call=f.offer();expect((await f.services.callAction(alice.userId,bob.userId,'cancel',call.timing)).state).toBe('ended');
  expect((await f.services.callOffer(alice.userId,bob.userId,call.timing,call.invite)).state).toBe('ended');expect(f.invites).toEqual([]);expect(f.sendWake.mock.calls.every(args=>args[4]===undefined)).toBe(true);
  f.advance(29999);expect(f.services.callState(alice.userId,bob.userId,call.timing.callId,f.epoch).state).toBe('ended');f.advance(1);expect(f.services.callState(alice.userId,bob.userId,call.timing.callId,f.epoch).state).toBe('unknown');
  await expect(f.services.callOffer(alice.userId,bob.userId,call.timing,call.invite)).rejects.toThrow(/expired/);
 });
 it('rechecks pending state before an asynchronous provider task starts',async()=>{
  const f=fixture(),call=f.offer();const offering=f.services.callOffer(alice.userId,bob.userId,call.timing,call.invite);await f.services.callAction(alice.userId,bob.userId,'cancel',call.timing);expect((await offering).state).toBe('ended');expect(f.sendWake.mock.calls.filter(args=>args[4]!==undefined)).toHaveLength(0);
 });
 it('freshness stays ended when an already in-flight invitation completes after cancellation',async()=>{
  let release!:()=>void;const send=vi.fn<PushProvider['sendWake']>(async(_token,_intent,_background,_preview,invite)=>{if(invite)await new Promise<void>(resolve=>{release=resolve;});});const f=fixture(send),call=f.offer();
  const offering=f.services.callOffer(alice.userId,bob.userId,call.timing,call.invite);while(!release)await Promise.resolve();await f.services.callAction(alice.userId,bob.userId,'cancel',call.timing);release();expect((await offering).state).toBe('ended');expect(f.services.callReceived(bob.userId,alice.userId,call.timing.callId,f.epoch).state).toBe('ended');expect(send.mock.calls.some(args=>args[5]?.state==='ended')).toBe(true);
 });
 it('rechecks token capability and consent before a queued terminal hint is sent',async()=>{
  const f=fixture(),call=f.offer();await f.services.callOffer(alice.userId,bob.userId,call.timing,call.invite);const ending=f.services.callAction(alice.userId,bob.userId,'cancel',call.timing);f.services.registerPush(bob.userId,'rotated-token',true,false,false);f.services.replaceWatchConsent(bob.userId,[]);await ending;expect(f.sendWake.mock.calls.filter(args=>args[5]!==undefined)).toHaveLength(0);expect(f.services.callState(alice.userId,bob.userId,call.timing.callId,f.epoch).state).toBe('ended');
 });
 it('rejects wrong participants/headers, denies missing consent and hides other callers state',async()=>{
  const f=fixture(),call=f.offer();await expect(f.services.callOffer(other.userId,bob.userId,call.timing,call.invite)).rejects.toThrow(/match/);f.services.replaceWatchConsent(bob.userId,[]);await expect(f.services.callOffer(alice.userId,bob.userId,call.timing,call.invite)).rejects.toThrow(/authorized/);f.services.replaceWatchConsent(bob.userId,[alice.userId]);await f.services.callOffer(alice.userId,bob.userId,call.timing,call.invite);
  expect(f.services.callState(other.userId,bob.userId,call.timing.callId,f.epoch).state).toBe('unknown');await expect(f.services.callAction(other.userId,bob.userId,'end',call.timing)).rejects.toThrow(/mismatch/);
  await expect(f.services.callAction(alice.userId,bob.userId,'cancel',{...call.timing,expiresAt:call.timing.expiresAt+1})).rejects.toThrow(/mismatch/);
 });
 it('skips expired provider work and old epochs fail closed without renewing the deadline',async()=>{
  const f=fixture(),call=f.offer();const offering=f.services.callOffer(alice.userId,bob.userId,call.timing,call.invite);f.advance(30000);expect((await offering).state).toBe('unknown');expect(f.sendWake).not.toHaveBeenCalled();
  const first=new CallRegistry(()=>f.now),second=new CallRegistry(()=>f.now);const timing={callId:id(),serverEpoch:first.epoch,issuedAt:f.now,expiresAt:f.now+30000};first.offer(alice.userId,bob.userId,timing);expect(second.state(bob.userId,alice.userId,timing.callId,first.epoch).state).toBe('unknown');expect(()=>second.offer(alice.userId,bob.userId,timing)).toThrow(/epoch/);
 });
 it('bounds global and per-user tombstones without evicting live calls',()=>{
  let now=1800000000000;const registry=new CallRegistry(()=>now,2,1);const timing=()=>({callId:id(),serverEpoch:registry.epoch,issuedAt:now,expiresAt:now+30000});const first=timing();registry.offer(alice.userId,bob.userId,first);expect(()=>registry.offer(alice.userId,other.userId,timing())).toThrow(/capacity/);registry.offer('a','b',timing());expect(()=>registry.offer('c','d',timing())).toThrow(/capacity/);expect(registry.state(alice.userId,bob.userId,first.callId,registry.epoch).state).toBe('pending');now+=30000;expect(()=>registry.offer(alice.userId,bob.userId,timing())).not.toThrow();
 });
 it('requires separate token capability and preserves legacy services and wake arguments',async()=>{
  const f=fixture();expect(Object.keys(f.services.capabilities(alice.userId)).sort()).toEqual(['phoneVerification','phoneVerified','push','relay'].sort());expect(f.services.capabilities(alice.userId,true)).toMatchObject({callInviteV1:true,serverEpoch:f.epoch});
  f.services.registerPush(bob.userId,'bob-token',true,true);const call=f.offer();await f.services.callOffer(alice.userId,bob.userId,call.timing,call.invite);expect(f.sendWake.mock.calls[0]).toHaveLength(4);expect(f.sendWake.mock.calls[0]?.[4]).toBeUndefined();expect((f.db.prepare('SELECT call_invite_v1 FROM push_tokens WHERE user_id=?').get(bob.userId) as any).call_invite_v1).toBe(0);
 });
 it('builds data-only bounded invitation/terminal FCM payloads without media or plaintext names',()=>{
  const f=fixture(),call=f.offer(),intent={kind:'call' as const,intentId:call.timing.callId,expiresAt:call.timing.expiresAt};const message=buildFcmWakeMessage('token',intent,f.now,true,undefined,call.invite)!;
  expect(message).not.toHaveProperty('notification');expect(message.data?.kind).toBe('lastcall-call');expect(message.android?.priority).toBe('high');expect(message.android?.ttl).toBe(30000);expect(Buffer.byteLength(JSON.stringify(message.data))).toBeLessThanOrEqual(4096);
  expect(decryptCallPush(bob,alice.publicKey,message.data!.callInvite!,intent,f.now).video).toBe(true);expect(JSON.stringify(message)).not.toContain('conversationId');
  const terminal:CallState={...call.timing,callerId:alice.userId,calleeId:bob.userId,state:'ended',revision:2};expect(buildFcmWakeMessage('token',intent,f.now,true,undefined,undefined,terminal)?.data).toMatchObject({kind:'lastcall-call-state',callId:call.timing.callId});
  expect(()=>buildFcmWakeMessage('token',intent,f.now,false,undefined,call.invite)).toThrow();expect(buildFcmWakeMessage('token',intent,call.timing.expiresAt,true,undefined,call.invite)).toBeUndefined();
 });
});

it('authenticates real call RPCs and only negotiated connected recipients receive new control events',async()=>{
 const pushes:Parameters<PushProvider['sendWake']>[]=[];const server=createSignalingServer({port:0,pushProvider:{async sendWake(...args){pushes.push(args);}}});const {url}=await server.listen();const sockets:WebSocket[]=[];disposals.push(async()=>{for(const socket of sockets)socket.terminate();await server.close();});
 async function connect(identity:DeviceIdentity,name:string){const ws=new WebSocket(url.replace('http','ws')+'/directory');sockets.push(ws);const frames:DirectoryServerFrame[]=[];ws.on('message',raw=>frames.push(directoryServerFrameSchema.parse(JSON.parse(raw.toString()))));const next=async(predicate:(frame:DirectoryServerFrame)=>boolean)=>{let found:DirectoryServerFrame|undefined;await expect.poll(()=>{const index=frames.findIndex(predicate);if(index>=0)found=frames.splice(index,1)[0];return !!found;},{timeout:3000,interval:5}).toBe(true);return found!;};const challenge=await next(frame=>frame.type==='challenge');if(challenge.type!=='challenge')throw new Error('challenge');ws.send(JSON.stringify({type:'authenticate',publicKey:identity.publicKey,username:name,displayName:name,signature:signAuthentication(identity,challenge.challenge,name,name)}));await next(frame=>frame.type==='ready');return {ws,frames,next,rpc:async(type:string,fields:Record<string,unknown>={})=>{const requestId=id();ws.send(JSON.stringify({type,requestId,...fields}));return next(frame=>'requestId'in frame&&frame.requestId===requestId);}};}
 const a=await connect(alice,'call_alice'),b=await connect(bob,'call_bob'),c=await connect(other,'call_other');
 expect(await b.rpc('push-register',{token:'legacy-call-token',backgroundSync:true})).toMatchObject({type:'push-registered'});b.ws.send(JSON.stringify({type:'watch',userIds:[alice.userId]}));const legacy=await b.rpc('services');expect(legacy.type).toBe('services');if(legacy.type!=='services')throw new Error('services');expect(Object.keys(legacy.capabilities).sort()).toEqual(['phoneVerification','phoneVerified','push','relay'].sort());
 const capability=await a.rpc('services',{callInviteV1:true});if(capability.type!=='services')throw new Error('services');const epoch=capability.capabilities.serverEpoch!;const issuedAt=Date.now(),timing={callId:id(),issuedAt,expiresAt:issuedAt+30000,serverEpoch:epoch};const invite=encryptCallPush(alice,bob.publicKey,timing,epoch,{conversationId:directConversationId(alice.userId,bob.userId),video:false});expect(await a.rpc('call-offer',{...timing,to:bob.userId,invite})).toMatchObject({type:'call-state',state:'pending'});expect(b.frames.some(frame=>frame.type==='call-invitation'||frame.type==='call-state')).toBe(false);expect(pushes[0]?.[4]).toBeUndefined();
 expect(await c.rpc('call-state-get',{callId:timing.callId,otherId:bob.userId,serverEpoch:epoch})).toMatchObject({type:'call-state',state:'unknown'});
 expect(await a.rpc('call-received',{callId:timing.callId,callerId:bob.userId,serverEpoch:epoch})).toMatchObject({type:'error',code:'call-role'});
 expect(await a.rpc('call-action',{...timing,otherId:bob.userId,action:'cancel'})).toMatchObject({state:'ended'});
 await b.rpc('services',{callInviteV1:true});await b.rpc('push-register',{token:'new-call-token',backgroundSync:true,callInviteV1:true});const nextTiming={...timing,callId:id(),issuedAt:Date.now(),expiresAt:Date.now()+30000};nextTiming.expiresAt=nextTiming.issuedAt+30000;const nextInvite=encryptCallPush(alice,bob.publicKey,nextTiming,epoch,{conversationId:directConversationId(alice.userId,bob.userId),video:false});expect(await a.rpc('call-offer',{...nextTiming,to:bob.userId,invite:nextInvite})).toMatchObject({state:'pending'});expect(await b.next(frame=>frame.type==='call-invitation')).toMatchObject({invite:nextInvite});expect(await b.rpc('call-received',{callId:nextTiming.callId,callerId:alice.userId,serverEpoch:epoch})).toMatchObject({state:'ringing'});
});
