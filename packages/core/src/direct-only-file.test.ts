import {describe,expect,it,vi} from 'vitest';
import {createDeviceIdentity,type DirectoryUser} from './directory.js';
import {MessengerClient} from './messenger.js';
const alice=createDeviceIdentity(n=>new Uint8Array(n).fill(71));const bob=createDeviceIdentity(n=>new Uint8Array(n).fill(72));
const bobUser:DirectoryUser={userId:bob.userId,publicKey:bob.publicKey,username:'bob',displayName:'Bob',online:true,lastSeen:1};
describe('small files go phone to phone only',()=>{
 it('waits while the only path is a TURN relay and sends once the path is direct',async()=>{
  const client=new MessengerClient({serverUrl:'https://example.com',identity:alice,username:'alice',displayName:'Alice'});const internal=client as any;
  let route:'direct'|'relay'='relay';const sendFile=vi.fn(async()=>{});
  const session={getSnapshot:()=>({status:'connected',callState:'idle',files:[]}),currentRoute:async()=>route,sendFile,sendText:vi.fn(async()=>{}),sendApplication:vi.fn(async()=>{}),supportsMessageChanges:()=>false,supportsReactions:()=>false,supportsBulk:()=>false,disconnect:()=>{}};
  const pair={session,attempt:0,flushing:false,notified:true,lastUsed:Date.now(),lastSent:new Map(),definitions:new Set()};
  try{
   const id=await client.addContact(bobUser);internal.pairs.set(bob.userId,pair);internal.ensurePair=async()=>pair;
   await client.sendFile(id,{name:'voice.m4a',mime:'audio/mp4',data:new Uint8Array([1,2,3])});
   await internal.flushPeer(bob.userId);expect(sendFile).not.toHaveBeenCalled();
   route='direct';await internal.flushPeer(bob.userId);expect(sendFile).toHaveBeenCalledTimes(1);
  }finally{client.disconnect();}
 });
});
