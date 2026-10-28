import {describe,it,expect,vi} from 'vitest';
import {createDeviceIdentity,type DirectoryUser} from './directory.js';
import {MessengerClient} from './messenger.js';
import {PeerSession} from './session.js';
const alice=createDeviceIdentity(n=>new Uint8Array(n).fill(21));const bob=createDeviceIdentity(n=>new Uint8Array(n).fill(22));
const bobUser:DirectoryUser={userId:bob.userId,publicKey:bob.publicKey,username:'bob',displayName:'Bob',online:false,lastSeen:1};
function random(){let i=0;return (n:number)=>{const result=new Uint8Array(n);new DataView(result.buffer).setUint32(0,++i);return result;};}
describe('outbox independent of optional RTC diagnostics',()=>{
 it('sends a text queued during an active flush even if no stats/presence event ever occurs',async()=>{
  vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-27T12:00:00Z'));
  const client=new MessengerClient({serverUrl:'https://lienad.ru/messenger',identity:alice,username:'alice',displayName:'Alice',randomBytes:random()});
  const internal=client as any;let release!:()=>void;const first=new Promise<void>(resolve=>{release=resolve;});const sent:string[]=[];
  const session={getSnapshot:()=>({status:'connected',callState:'idle',files:[]}),sendText:async(text:string)=>{sent.push(text);if(sent.length===1)await first;},disconnect:()=>{}};
  try{
   const id=await client.addContact(bobUser);await client.sendText(id,'first');
   internal.status='online';internal.stopped=false;internal.contacts.set(bob.userId,{...bobUser,online:true});
   const pair={session,attempt:0,flushing:false,notified:true,lastUsed:Date.now(),lastSent:new Map(),definitions:new Set()};internal.pairs.set(bob.userId,pair);internal.ensurePair=async()=>pair;
   const flushing=internal.flushPeer(bob.userId);await Promise.resolve();expect(sent).toEqual(['first']);
   await client.sendText(id,'second');await Promise.resolve();release();await flushing;
   await vi.advanceTimersByTimeAsync(6000);
   expect(sent).toContain('second');
  }finally{release?.();client.disconnect();vi.useRealTimers();}
 });
});
describe('bounded transport stages',()=>{
 it('reports an unanswered SDP offer instead of leaving pending texts in waiting forever',async()=>{
  vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-27T12:00:00Z'));
  const peerId='bb'.repeat(16);
  class Socket {readyState=1;onopen:any;onmessage:any;onclose:any;onerror:any;constructor(){queueMicrotask(()=>this.onopen?.());}send(raw:string){const frame=JSON.parse(raw);if(frame.type==='join')queueMicrotask(()=>{this.onmessage?.({data:JSON.stringify({type:'joined',roomId:frame.roomId,peerId:frame.peerId,role:'initiator',peerPresent:true})});this.onmessage?.({data:JSON.stringify({type:'peer-joined',peerId})});});}close(){this.readyState=3;}}
  const pc:any={signalingState:'stable',connectionState:'new',iceConnectionState:'new',localDescription:null,createDataChannel:()=>({readyState:'connecting',bufferedAmount:0,close:()=>{}}),createOffer:async()=>({type:'offer',sdp:'v=0\r\n'}),setLocalDescription:async(description:any)=>{pc.localDescription=description;pc.signalingState='have-local-offer';},getSenders:()=>[],getStats:async()=>{throw new Error('optional stats unavailable');},close:()=>{}};
  vi.stubGlobal('WebSocket',Socket);const session=new PeerSession({serverUrl:'https://lienad.ru/messenger',invite:'ab'.repeat(32),iceServers:[],randomBytes:random(),rtcFactory:()=>pc});
  try{const connection=session.connect();await vi.advanceTimersByTimeAsync(1);await connection;await vi.advanceTimersByTimeAsync(35000);expect(session.getSnapshot().status).toBe('error');expect(session.getSnapshot().error).toMatch(/answer|SDP|negotiation/i);}
  finally{session.disconnect();vi.unstubAllGlobals();vi.useRealTimers();}
 });
});

describe('automatic coordinator peer join',()=>{
 it('reports an online peer that never joins its private room and keeps the text pending',async()=>{
  const {WebSocketServer}=await import('ws');
  const server=new WebSocketServer({host:'127.0.0.1',port:0});await new Promise<void>(resolve=>server.once('listening',resolve));const address=server.address();if(typeof address==='string'||!address)throw new Error('Missing test listener');
  server.on('connection',(socket,request)=>{
    if(request.url==='/directory'){
      socket.send(JSON.stringify({type:'challenge',challenge:'ab'.repeat(32)}));
      socket.on('message',raw=>{const frame=JSON.parse(raw.toString());if(frame.type==='authenticate')socket.send(JSON.stringify({type:'ready',self:{userId:alice.userId,publicKey:alice.publicKey,username:'alice',displayName:'Alice',online:true,lastSeen:1}}));if(frame.type==='ice')socket.send(JSON.stringify({type:'ice',requestId:frame.requestId,iceServers:[]}));});
    }else if(request.url==='/signal')socket.on('message',raw=>{const frame=JSON.parse(raw.toString());if(frame.type==='join')socket.send(JSON.stringify({type:'joined',roomId:frame.roomId,peerId:frame.peerId,role:'initiator',peerPresent:false}));});
  });
  vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-27T12:00:00Z'));vi.stubGlobal('fetch',async()=>({ok:true,json:async()=>({iceServers:[]})}));
  const pc:any={signalingState:'stable',connectionState:'new',iceConnectionState:'new',createDataChannel:()=>({readyState:'connecting',bufferedAmount:0,close:()=>{}}),getSenders:()=>[],getStats:async()=>{throw new Error('optional stats unavailable');},close:()=>{}};
  const client=new MessengerClient({serverUrl:`http://127.0.0.1:${address.port}`,identity:alice,username:'alice',displayName:'Alice',randomBytes:random(),rtcFactory:()=>pc});
  try{
    await client.connect();const id=await client.addContact({...bobUser,online:true});await client.sendText(id,'queued for online peer');
    await vi.waitFor(()=>expect(client.getSnapshot().conversations.find(c=>c.id===id)?.session?.status).toBe('waiting'));
    await vi.advanceTimersByTimeAsync(30500);
    expect(client.getSnapshot().error).toMatch(/peer.*join|room.*join/i);expect(client.getSnapshot().conversations.find(c=>c.id===id)?.messages[0]?.status).toBe('pending');
  }finally{client.disconnect();for(const socket of server.clients)socket.terminate();vi.unstubAllGlobals();vi.useRealTimers();await new Promise<void>(resolve=>server.close(()=>resolve()));}
 });
});
