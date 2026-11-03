import {afterEach,describe,expect,it,vi} from 'vitest';
import {createDeviceIdentity,type DeviceIdentity,type DirectoryUser} from './directory.js';
import {MessengerClient} from './messenger.js';
import {openLocalState} from './persistence.js';
const alice=createDeviceIdentity(n=>new Uint8Array(n).fill(111)),bob=createDeviceIdentity(n=>new Uint8Array(n).fill(112));
const user=(i:DeviceIdentity,name:string):DirectoryUser=>({userId:i.userId,publicKey:i.publicKey,username:name,displayName:name,online:false,lastSeen:1});
function random(){let counter=0;return(n:number)=>{const b=new Uint8Array(n);new DataView(b.buffer).setUint32(0,++counter);return b;};}
function storage(){let sealed:string|null=null;return {get sealed(){return sealed;},loadState:async()=>sealed,saveState:vi.fn(async(value:string)=>{sealed=value;}),saveAttachment:vi.fn(async()=>{}),loadAttachment:async()=>null,deleteAttachment:vi.fn(async()=>{})};}
function tracked(store=storage()){const client=new MessengerClient({serverUrl:'https://example.com',identity:alice,username:'alice',displayName:'Alice',randomBytes:random(),...store});all.push(client);return {client,store};}
const all:MessengerClient[]=[];
afterEach(()=>{for(const c of all.splice(0))c.disconnect();});
describe('local contact blocking',()=>{
 it('persists blocks across restart and blocks outgoing calls',async()=>{
  const a=tracked();const id=await a.client.addContact(user(bob,'bob'));
  await a.client.blockContact(bob.userId);await a.client.flushState();
  expect(a.client.getSnapshot().blockedContacts).toEqual([bob.userId]);
  expect((openLocalState(alice,a.store.sealed!) as any).blocked).toEqual([bob.userId]);
  await expect(a.client.startCall(id)).rejects.toThrow('Contact is blocked');
  a.client.disconnect();
  const restored=tracked(a.store);await restored.client.addContact(user(bob,'bob'));
  expect(restored.client.getSnapshot().blockedContacts).toEqual([bob.userId]);
  await restored.client.unblockContact(bob.userId);await restored.client.flushState();
  expect(restored.client.getSnapshot().blockedContacts).toEqual([]);
  expect((openLocalState(alice,restored.store.sealed!) as any).blocked).toEqual([]);
 });
 it('rejects unknown and duplicate block identifiers without changing state',async()=>{
  const a=tracked();await a.client.addContact(user(bob,'bob'));
  await expect(a.client.blockContact('aa'.repeat(16))).rejects.toThrow('Unknown contact');
  await a.client.blockContact(bob.userId);await a.client.blockContact(bob.userId);
  expect(a.client.getSnapshot().blockedContacts).toEqual([bob.userId]);
 });
});
