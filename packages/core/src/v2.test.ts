import { describe,it,expect,vi } from 'vitest';
import { createDeviceIdentity,userIdFromPublicKey,signAuthentication,verifyAuthentication,authenticationPayload,conversationInvite,directConversationId,endpointUrl,directoryClientFrameSchema,directoryServerFrameSchema,type DeviceIdentity,type DirectoryUser } from './directory.js';
import { sealLocalState,openLocalState,MAX_LOCAL_STATE_BYTES } from './persistence.js';
import { signGroupDefinition } from './group-sync.js';
import { MessengerClient,MAX_PENDING_MESSAGES } from './messenger.js';
import { PeerSession,type ChatMessage } from './session.js';
import { type DataFrame } from './protocol.js';
const alice=createDeviceIdentity(n=>new Uint8Array(n).fill(31));
const bob=createDeviceIdentity(n=>new Uint8Array(n).fill(47));
const charlie=createDeviceIdentity(n=>new Uint8Array(n).fill(53));
function user(identity:DeviceIdentity,username:string):DirectoryUser{return {userId:identity.userId,publicKey:identity.publicKey,username,displayName:username,online:false,lastSeen:1};}
function random(){let n=0;return (length:number)=>{const result=new Uint8Array(length);new DataView(result.buffer).setUint32(0,++n);return result;};}
describe('device identity and directory authentication',()=>{
  it('derives a stable SHA256 identity from a strict Ed25519 key',()=>{
    expect(userIdFromPublicKey(alice.publicKey)).toBe(alice.userId);expect(alice.privateKey).toHaveLength(64);
    expect(()=>userIdFromPublicKey('00'.repeat(32))).toThrow();expect(()=>userIdFromPublicKey('01'+'00'.repeat(31))).toThrow();
  });
  it('uses the exact domain-separated challenge payload and rejects every changed field',()=>{
    const challenge='ab'.repeat(32);const signature=signAuthentication(alice,challenge,'alice','Alice');
    expect(new TextDecoder().decode(authenticationPayload(challenge,alice.publicKey,'alice','Alice'))).toBe(JSON.stringify(['messenger-directory/v1',challenge,alice.publicKey,'alice','Alice']));
    expect(verifyAuthentication(alice.publicKey,challenge,'alice','Alice',signature)).toBe(true);
    expect(verifyAuthentication(alice.publicKey,'cd'.repeat(32),'alice','Alice',signature)).toBe(false);
    expect(verifyAuthentication(alice.publicKey,challenge,'mallory','Alice',signature)).toBe(false);
    expect(verifyAuthentication(alice.publicKey,challenge,'alice','Changed',signature)).toBe(false);
    expect(verifyAuthentication(bob.publicKey,challenge,'alice','Alice',signature)).toBe(false);
    expect(verifyAuthentication(alice.publicKey,challenge,'alice','Alice','00'.repeat(64))).toBe(false);
    expect(()=>signAuthentication({...alice,publicKey:bob.publicKey},challenge,'alice','Alice')).toThrow();
  });
  it('derives symmetric pair invitations but different secrets for different contacts',()=>{
    expect(conversationInvite(alice,bob.publicKey)).toBe(conversationInvite(bob,alice.publicKey));
    expect(conversationInvite(alice,bob.publicKey)).not.toBe(conversationInvite(alice,charlie.publicKey));
    expect(directConversationId(alice.userId,bob.userId)).toBe(directConversationId(bob.userId,alice.userId));
    expect(()=>conversationInvite(alice,alice.publicKey)).toThrow();
  });
  it('validates exact bounded directory frames and public key identity binding',()=>{
    expect(directoryClientFrameSchema.safeParse({type:'watch',userIds:Array(201).fill(alice.userId)}).success).toBe(false);
    expect(directoryClientFrameSchema.safeParse({type:'search',query:'@alice',requestId:'ab'.repeat(16)}).success).toBe(true);
    expect(directoryClientFrameSchema.safeParse({type:'connect',to:bob.userId,text:'plaintext'}).success).toBe(false);
    expect(directoryServerFrameSchema.safeParse({type:'ready',self:{...user(alice,'alice'),userId:bob.userId}}).success).toBe(false);
  });
});
describe('gateway namespaces',()=>{
  it('preserves base prefixes across all endpoints and accepts legacy root URLs',()=>{
    for(const endpoint of ['ice','signal','directory']){
      expect(endpointUrl('https://lienad.ru/messenger',endpoint).href).toBe('https://lienad.ru/messenger/'+endpoint);
      expect(endpointUrl('https://lienad.ru/messenger/','/'+endpoint).href).toBe('https://lienad.ru/messenger/'+endpoint);
      expect(endpointUrl('https://p2p.lienad.ru',endpoint).href).toBe('https://p2p.lienad.ru/'+endpoint);
    }
    expect(()=>endpointUrl('https://user:secret@example.com/x','ice')).toThrow();expect(()=>endpointUrl('https://example.com/x','../ice')).toThrow();
  });
});
describe('bounded encrypted state',()=>{
  it('roundtrips only for the device identity and rejects tampering/oversized input',()=>{
    const state={contacts:[user(bob,'bob')],text:'personal-message'};const sealed=sealLocalState(alice,state,random());
    expect(sealed).not.toContain('personal-message');expect(sealed).not.toContain(alice.privateKey);expect(openLocalState(alice,sealed)).toEqual(state);
    expect(()=>openLocalState(bob,sealed)).toThrow();const changed=JSON.parse(sealed);changed.ciphertext='ff'+changed.ciphertext.slice(2);expect(()=>openLocalState(alice,JSON.stringify(changed))).toThrow();
    expect(()=>sealLocalState(alice,'x'.repeat(MAX_LOCAL_STATE_BYTES))).toThrow(/limit/);expect(()=>openLocalState(alice,'x'.repeat(MAX_LOCAL_STATE_BYTES*2+1025))).toThrow(/limit/);
  });
  it('persists pending texts without identity seed/file bytes and restores the outbox',async()=>{
    let sealed:string|null=null;const saved:string[]=[];
    const client=new MessengerClient({serverUrl:'https://lienad.ru/messenger',identity:alice,username:'alice',displayName:'Alice',randomBytes:random(),saveState:async value=>{sealed=value;saved.push(value);}});
    const id=await client.addContact(user(bob,'bob'));await client.sendText(id,'pending while offline');
    expect(saved.length).toBeGreaterThan(0);expect(sealed).not.toContain('pending while offline');
    const state=openLocalState(alice,sealed!) as any;expect(state.pending[0].remaining).toEqual([bob.userId]);expect(JSON.stringify(state)).not.toContain(alice.privateKey);expect(state.conversations[0].files).toEqual([]);
    const restored=new MessengerClient({serverUrl:'https://lienad.ru/messenger',identity:alice,username:'alice',displayName:'Alice',loadState:async()=>sealed});
    await restored.addContact(user(bob,'bob'));const snapshot=restored.getSnapshot();expect(snapshot.conversations[0]?.messages[0]?.status).toBe('pending');expect(snapshot.contacts[0]?.online).toBe(false);
    client.disconnect();restored.disconnect();
  });
  it('fails closed on corrupted local storage and does not overwrite it',async()=>{
    const save=vi.fn(async()=>{});const client=new MessengerClient({serverUrl:'https://lienad.ru/messenger',identity:alice,username:'alice',displayName:'Alice',loadState:async()=>'{bad',saveState:save});
    await expect(client.connect()).rejects.toThrow();expect(client.getSnapshot().status).toBe('error');expect(save).not.toHaveBeenCalled();client.disconnect();
  });
  it('bounds the pending outbox and serializes overlapping adapter writes',async()=>{
    let active=0;let overlap=false;const client=new MessengerClient({serverUrl:'https://lienad.ru/messenger',identity:alice,username:'alice',displayName:'Alice',randomBytes:random(),saveState:async()=>{active++;if(active>1)overlap=true;await new Promise(resolve=>setTimeout(resolve,1));active--;}});
    const id=await client.addContact(user(bob,'bob'));await Promise.all([client.sendText(id,'one'),client.sendText(id,'two')]);expect(overlap).toBe(false);
    for(let i=2;i<MAX_PENDING_MESSAGES;i++)await client.sendText(id,'pending');await expect(client.sendText(id,'overflow')).rejects.toThrow(/full/);client.disconnect();
  });
});
describe('receiver text acknowledgements',()=>{
  it('does not mark a local send delivered before the real peer receives/acknowledges it',async()=>{
    const a=new PeerSession({serverUrl:'https://lienad.ru/messenger',invite:'ab'.repeat(32),randomBytes:random()});const b=new PeerSession({serverUrl:'https://lienad.ru/messenger',invite:'ab'.repeat(32),randomBytes:random()});
    const channelA:DataFrame[]=[];const channelB:DataFrame[]=[];
    const ai=a as unknown as {channel:RTCDataChannel;handleData:(frame:DataFrame)=>void};const bi=b as unknown as {channel:RTCDataChannel;handleData:(frame:DataFrame)=>void};
    ai.channel={readyState:'open',bufferedAmount:0,send:(frame:string)=>channelA.push(JSON.parse(frame))} as unknown as RTCDataChannel;
    bi.channel={readyState:'open',bufferedAmount:0,send:(frame:string)=>channelB.push(JSON.parse(frame))} as unknown as RTCDataChannel;
    const conversationId=directConversationId(alice.userId,bob.userId);await a.sendText('hello',{messageId:'cd'.repeat(16),conversationId});expect(a.getSnapshot().messages[0]?.status).toBe('sent');
    await bi.handleData(channelA[0]!);expect(b.getSnapshot().messages[0]?.text).toBe('hello');expect(channelB[0]?.kind).toBe('text-ack');await ai.handleData(channelB[0]!);expect(a.getSnapshot().messages[0]?.status).toBe('delivered');
    await bi.handleData(channelA[0]!);expect(b.getSnapshot().messages).toHaveLength(1);expect(channelB).toHaveLength(2);
  });
  it('only marks group text delivered after acknowledgements from every recipient',async()=>{
    const client=new MessengerClient({serverUrl:'https://lienad.ru/messenger',identity:alice,username:'alice',displayName:'Alice',randomBytes:random()});await client.addContact(user(bob,'bob'));await client.addContact(user(charlie,'charlie'));
    const id='group:'+'ef'.repeat(16);const internal=client as unknown as {conversations:Map<string,any>;receiveMessage:(peer:string,message:ChatMessage)=>boolean};
    internal.conversations.set(id,{id,kind:'group',title:'Three',creatorId:alice.userId,memberIds:[alice.userId,bob.userId,charlie.userId],messages:[],files:[],unread:0,updatedAt:0});await client.sendText(id,'all peers');
    const message=client.getSnapshot().conversations.find(c=>c.id===id)!.messages[0]!;
    await internal.receiveMessage(bob.userId,{id:message.id,text:message.text,from:'self',timestamp:1,status:'delivered',conversationId:id});expect(client.getSnapshot().conversations.find(c=>c.id===id)?.messages[0]?.status).toBe('sent');
    await internal.receiveMessage(charlie.userId,{id:message.id,text:message.text,from:'self',timestamp:1,status:'delivered',conversationId:id});expect(client.getSnapshot().conversations.find(c=>c.id===id)?.messages[0]?.status).toBe('delivered');client.disconnect();
  });
  it('rejects text for a group the authenticated peer does not belong to',async()=>{
    const client=new MessengerClient({serverUrl:'https://lienad.ru/messenger',identity:alice,username:'alice',displayName:'Alice'});const id=await client.addContact(user(bob,'bob'));const internal=client as unknown as {receiveMessage:(peer:string,message:ChatMessage)=>boolean};
    expect(await internal.receiveMessage(charlie.userId,{id:'ab'.repeat(16),text:'spoof',from:'peer',timestamp:1,conversationId:id})).toBe(false);expect(client.getSnapshot().conversations[0]?.messages).toHaveLength(0);client.disconnect();
  });
});

describe('directory replacement and group ownership',()=>{
  it('stops automatic reconnect after server replaces an identity socket',async()=>{
    vi.useFakeTimers();let instances=0;let last:any;
    class Socket {
      readyState=1;onmessage:((event:{data:string})=>void)|null=null;onclose:(()=>void)|null=null;onerror:(()=>void)|null=null;
      constructor(){instances++;last=this;queueMicrotask(()=>this.push({type:'challenge',challenge:'ab'.repeat(32)}));}
      push(frame:unknown){this.onmessage?.({data:JSON.stringify(frame)});}
      send(raw:string){const frame=JSON.parse(raw);if(frame.type==='authenticate'){expect(verifyAuthentication(frame.publicKey,'ab'.repeat(32),frame.username,frame.displayName,frame.signature)).toBe(true);queueMicrotask(()=>this.push({type:'ready',self:{...user(alice,'alice'),online:true}}));}}
      close(){this.readyState=3;queueMicrotask(()=>this.onclose?.());}
    }
    vi.stubGlobal('WebSocket',Socket);
    const client=new MessengerClient({serverUrl:'https://lienad.ru/messenger',identity:alice,username:'alice',displayName:'Alice'});
    try{
      const opening=client.connect();await vi.advanceTimersByTimeAsync(1);await opening;expect(client.getSnapshot().status).toBe('online');
      last.push({type:'error',code:'session-replaced',message:'Identity connected elsewhere'});await vi.advanceTimersByTimeAsync(31000);
      expect(client.getSnapshot().status).toBe('error');expect(instances).toBe(1);
    }finally{client.disconnect();vi.unstubAllGlobals();vi.useRealTimers();}
  });
  it('rejects definitions from non-creators and modified membership',async()=>{
    const client=new MessengerClient({serverUrl:'https://lienad.ru/messenger',identity:alice,username:'alice',displayName:'Alice'});await client.addContact(user(bob,'bob'));
    const internal=client as unknown as {receiveApplication:(peerId:string,payload:unknown)=>void};const definition={kind:'group-definition',id:'group:'+'ab'.repeat(16),title:'Private',creatorId:bob.userId,members:[user(alice,'alice'),user(bob,'bob')]};
    await expect(internal.receiveApplication(charlie.userId,definition)).rejects.toThrow(/author/);await internal.receiveApplication(bob.userId,definition);
    await expect(internal.receiveApplication(bob.userId,{...definition,members:[...definition.members,user(charlie,'charlie')]})).rejects.toThrow(/immutable/);expect(client.getSnapshot().conversations.find(c=>c.id===definition.id)?.memberIds).toHaveLength(2);client.disconnect();
  });
});

describe('group recipient file readiness',()=>{
  it('opens on-demand member pairs even when no direct chat exists for that member',async()=>{
    const client=new MessengerClient({serverUrl:'https://lienad.ru/messenger',identity:bob,username:'bob',displayName:'Bob'});
    await client.addContact(user(alice,'alice'));
    const internal=client as unknown as {status:string;contacts:Map<string,DirectoryUser>;pairs:Map<string,any>;receiveApplication:(peer:string,payload:unknown)=>void;ensurePair:(peer:string,notify:boolean)=>Promise<any>};
    const id='group:'+'ac'.repeat(16);await internal.receiveApplication(alice.userId,signGroupDefinition(alice,{kind:'group-definition',id,title:'Three',creatorId:alice.userId,members:[user(alice,'alice'),user(bob,'bob'),user(charlie,'charlie')]}));
    expect(client.getSnapshot().conversations.some(c=>c.id===directConversationId(bob.userId,charlie.userId))).toBe(false);
    (internal as any).stopped=false;internal.status='online';for(const [id,c] of internal.contacts)internal.contacts.set(id,{...c,online:true});
    const sends:string[]=[];const created:string[]=[];
    internal.ensurePair=async peerId=>{created.push(peerId);const pair={flushing:false,attempt:0,lastSent:new Map(),definitions:new Set(),session:{sendApplication:async()=>{},getSnapshot:()=>({status:'connected'}),sendFile:async(_file:unknown,meta:{conversationId:string})=>{expect(meta.conversationId).toBe(id);sends.push(peerId);},disconnect:()=>{}}};internal.pairs.set(peerId,pair);return pair;};
    await client.sendFile(id,{name:'group.txt',mime:'text/plain',data:new Uint8Array([1,2,3])});
    await vi.waitFor(()=>expect(sends).toHaveLength(2));expect(created.sort()).toEqual([alice.userId,charlie.userId].sort());expect(sends.sort()).toEqual([alice.userId,charlie.userId].sort());client.disconnect();
  });
});
