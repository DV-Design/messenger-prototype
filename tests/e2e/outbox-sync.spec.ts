import {expect,test,type Page} from '@playwright/test';
import type {DirectoryUser,MessengerClient,MessengerOptions,createDeviceIdentity} from '../../packages/core/src/index.js';
type Device={identity:ReturnType<typeof createDeviceIdentity>;username:string;sealed:string|null;blobs:Map<string,string>;generation:number;};
type ClientWindow=Window&{__messenger:MessengerClient;__createMessenger:(options:MessengerOptions)=>MessengerClient;__createIdentity:typeof createDeviceIdentity;__device:Device;};
const serverUrl=process.env.PW_SIGNALING_URL??`http://127.0.0.1:${process.env.PW_SERVER_PORT||'8799'}`;
async function boot(page:Page,index:number){
 await page.goto('/');return page.evaluate(async({serverUrl,index})=>{
  const w=window as ClientWindow;const d=w.__device={identity:w.__createIdentity(),username:`dur_${Date.now().toString(36)}_${index}`,sealed:null,blobs:new Map(),generation:1};
  w.__messenger=w.__createMessenger({serverUrl,identity:d.identity,username:d.username,displayName:d.username,loadState:async()=>d.sealed,saveState:async sealed=>{d.sealed=sealed;},saveAttachment:async(key,sealed)=>{d.blobs.set(key,sealed);},loadAttachment:async key=>d.blobs.get(key)??null,deleteAttachment:async key=>{d.blobs.delete(key);}});await w.__messenger.connect();return w.__messenger.getSnapshot().self!;
 },{serverUrl,index});
}
async function restart(page:Page){
 await page.evaluate(()=>{(window as ClientWindow).__messenger.disconnect();});
 return page.evaluate(async serverUrl=>{const w=window as ClientWindow,d=w.__device;d.generation++;w.__messenger=w.__createMessenger({serverUrl,identity:d.identity,username:d.username,displayName:d.username,loadState:async()=>d.sealed,saveState:async sealed=>{d.sealed=sealed;},saveAttachment:async(key,sealed)=>{d.blobs.set(key,sealed);},loadAttachment:async key=>d.blobs.get(key)??null,deleteAttachment:async key=>{d.blobs.delete(key);}});await w.__messenger.connect();return w.__messenger.getSnapshot();},serverUrl);
}
async function snapshot(page:Page){return page.evaluate(()=>(window as ClientWindow).__messenger.getSnapshot());}
async function sendFile(page:Page,id:string,name:string,bytes:number[]){await page.evaluate(({id,name,bytes})=>(window as ClientWindow).__messenger.sendFile(id,{name,mime:'application/octet-stream',data:new Uint8Array(bytes)}),{id,name,bytes});}
async function readFile(page:Page,id:string,name:string){return page.evaluate(async({id,name})=>{const m=(window as ClientWindow).__messenger,f=m.getSnapshot().conversations.find(c=>c.id===id)?.files.find(f=>f.name===name);if(!f)return null;const bytes=await m.getFileData(id,f.id,f.senderId);return bytes?Array.from(bytes):null;},{id,name});}
async function sendText(page:Page,id:string,text:string){await page.evaluate(({id,text})=>(window as ClientWindow).__messenger.sendText(id,text),{id,text});}
async function stop(page:Page){await page.evaluate(()=>(window as ClientWindow).__messenger.disconnect());}

test('sender restarts with encrypted text and attachment outbox before an offline recipient returns',async({browser})=>{
 const contexts=await Promise.all([0,1].map(()=>browser.newContext()));const [a,b]=await Promise.all(contexts.map(c=>c.newPage())) as [Page,Page];
 try{
  const [ua,ub]=await Promise.all([boot(a,0),boot(b,1)]);await stop(b);const id=await a.evaluate(u=>(window as ClientWindow).__messenger.addContact(u),{...ub,online:false});
  await expect.poll(async()=>(await snapshot(a)).contacts.find(c=>c.userId===ub.userId)?.online).toBe(false);
  const bytes=Array.from({length:40033},(_,i)=>(i*31)%256);await sendText(a,id,'Сохраняется до возвращения адресата');await sendFile(a,id,'sender-restart.bin',bytes);
  const before=(await snapshot(a)).conversations.find(c=>c.id===id)!;expect(before.messages[0]?.status).toBe('pending');expect(before.files[0]?.deliveryStatus).toBe('pending');expect(before.messages[0]!.expiresAt!-before.messages[0]!.timestamp).toBe(7*24*60*60*1000);
  const restored=await restart(a),queued=restored.conversations.find(c=>c.id===id)!;expect(queued.messages[0]?.id).toBe(before.messages[0]?.id);expect(queued.messages[0]?.expiresAt).toBe(before.messages[0]?.expiresAt);expect(queued.files[0]?.id).toBe(before.files[0]?.id);expect(queued.files[0]?.deliveryStatus).toBe('pending');expect(await readFile(a,id,'sender-restart.bin')).toEqual(bytes);
  await restart(b);await expect.poll(async()=>(await snapshot(b)).conversations.find(c=>c.id===id)?.messages.map(m=>m.text)).toContain('Сохраняется до возвращения адресата');await expect.poll(()=>readFile(b,id,'sender-restart.bin')).toEqual(bytes);
  await expect.poll(async()=>(await snapshot(a)).conversations.find(c=>c.id===id)?.messages[0]?.status).toBe('delivered');await expect.poll(async()=>(await snapshot(a)).conversations.find(c=>c.id===id)?.files[0]?.deliveryStatus).toBe('delivered');
  // Received ciphertext and bytes also survive reconstruction of the recipient manager.
  await restart(b);expect(await readFile(b,id,'sender-restart.bin')).toEqual(bytes);expect((await snapshot(b)).conversations.find(c=>c.id===id)?.messages[0]?.from).toBe(ua.userId);
 }finally{await Promise.all([a,b].map(p=>stop(p).catch(()=>{})));await Promise.all(contexts.map(c=>c.close()));}
});

test('durable text and file delivery stays unread until chat reading, then signed reads survive both manager restarts',async({browser})=>{
 const contexts=await Promise.all([0,1].map(()=>browser.newContext()));const [a,b]=await Promise.all(contexts.map(c=>c.newPage())) as [Page,Page];
 try{
  const [ua,ub]=await Promise.all([boot(a,7),boot(b,8)]);const id=await a.evaluate(u=>(window as unknown as ClientWindow).__messenger.addContact(u),ub);
  const text='Доставка ещё не означает прочтение',name='read-receipt.bin';const bytes=Array.from({length:2049},(_,i)=>(i*37+11)%256);
  await sendText(a,id,text);await sendFile(a,id,name,bytes);
  await expect.poll(async()=>(await snapshot(a)).conversations.find(c=>c.id===id)?.messages[0]?.status).toBe('delivered');
  await expect.poll(async()=>(await snapshot(a)).conversations.find(c=>c.id===id)?.files[0]?.deliveryStatus).toBe('delivered');
  expect(await readFile(b,id,name)).toEqual(bytes);const delivered=(await snapshot(a)).conversations.find(c=>c.id===id)!;
  expect(delivered.messages[0]?.readBy??[]).toEqual([]);expect(delivered.files[0]?.readBy??[]).toEqual([]);
  const received=(await snapshot(b)).conversations.find(c=>c.id===id)!;
  expect(received.messages[0]).toMatchObject({id:delivered.messages[0]!.id,text,from:ua.userId,status:'received'});
  expect(received.files[0]).toMatchObject({id:delivered.files[0]!.id,senderId:ua.userId,status:'complete',deliveryStatus:'received'});

  // Stop the author before the explicit chat action. Receipt generation must be
  // durable locally, rather than relying on an online author's transport ACK.
  await a.evaluate(()=>(window as unknown as ClientWindow).__messenger.disconnectAndFlush());
  await expect.poll(async()=>(await snapshot(b)).contacts.find(c=>c.userId===ua.userId)?.online).toBe(false);
  await b.evaluate(id=>(window as unknown as ClientWindow).__messenger.markRead(id),id);
  expect((await snapshot(b)).conversations.find(c=>c.id===id)?.unread).toBe(0);
  await b.evaluate(()=>(window as unknown as ClientWindow).__messenger.disconnectAndFlush());await restart(b);
  expect(await readFile(b,id,name)).toEqual(bytes);
  expect((await snapshot(a)).conversations.find(c=>c.id===id)?.messages[0]?.readBy??[]).toEqual([]);

  // Only a real authenticated WebRTC application receipt can update this newly
  // restored author: the test never injects a receipt or edits persisted state.
  await restart(a);
  await expect.poll(async()=>(await snapshot(a)).conversations.find(c=>c.id===id)?.messages[0]?.readBy??[]).toEqual([ub.userId]);
  await expect.poll(async()=>(await snapshot(a)).conversations.find(c=>c.id===id)?.files[0]?.readBy??[]).toEqual([ub.userId]);
  const read=(await snapshot(a)).conversations.find(c=>c.id===id)!;
  expect(read.messages[0]).toMatchObject({id:delivered.messages[0]!.id,status:'delivered',deliveredTo:[ub.userId],readBy:[ub.userId]});
  expect(read.files[0]).toMatchObject({id:delivered.files[0]!.id,deliveryStatus:'delivered',deliveredTo:[ub.userId],readBy:[ub.userId]});
 }finally{await Promise.all([a,b].map(p=>stop(p).catch(()=>{})));await Promise.all(contexts.map(c=>c.close()));}
});

test('a restarted group member supplies signed text and exact file bytes while the author is offline',async({browser})=>{
 const contexts=await Promise.all([0,1,2].map(()=>browser.newContext()));const [a,b,c]=await Promise.all(contexts.map(c=>c.newPage())) as [Page,Page,Page];
 try{
  const [ua,ub,uc]=await Promise.all([boot(a,2),boot(b,3),boot(c,4)]) as [DirectoryUser,DirectoryUser,DirectoryUser];await stop(c);
  const id=await a.evaluate(ids=>(window as ClientWindow).__messenger.createGroup('Синхронизация устройств',ids),[ub.userId,uc.userId]);await expect.poll(async()=>(await snapshot(b)).conversations.some(g=>g.id===id)).toBe(true);
  const bytes=Array.from({length:30019},(_,i)=>(i*17+91)%256);await sendText(a,id,'Автор выключен, участник синхронизирует');await sendFile(a,id,'peer-history.bin',bytes);await expect.poll(()=>readFile(b,id,'peer-history.bin')).toEqual(bytes);
  await expect.poll(async()=>(await snapshot(a)).conversations.find(g=>g.id===id)?.messages[0]?.deliveredTo).toContain(ub.userId);const original=(await snapshot(a)).conversations.find(g=>g.id===id)!;expect(original.messages[0]?.status).not.toBe('delivered');expect(original.messages[0]?.deliveredTo).not.toContain(uc.userId);
  await stop(a);await restart(b);expect(await readFile(b,id,'peer-history.bin')).toEqual(bytes);expect((await snapshot(b)).conversations.find(g=>g.id===id)?.messages[0]?.from).toBe(ua.userId);
  await restart(c);await expect.poll(async()=>(await snapshot(c)).conversations.find(g=>g.id===id)?.messages.map(m=>m.text)).toContain('Автор выключен, участник синхронизирует');await expect.poll(()=>readFile(c,id,'peer-history.bin')).toEqual(bytes);const received=(await snapshot(c)).conversations.find(g=>g.id===id)!;expect(received.messages[0]?.from).toBe(ua.userId);expect(received.files[0]?.senderId).toBe(ua.userId);expect(received.messages[0]?.id).toBe(original.messages[0]?.id);
  // Final recipient signs its own receipt; B's relay ACK cannot impersonate C.
  await restart(a);await expect.poll(async()=>(await snapshot(a)).conversations.find(g=>g.id===id)?.messages[0]?.status).toBe('delivered');await expect.poll(async()=>(await snapshot(a)).conversations.find(g=>g.id===id)?.files[0]?.deliveryStatus).toBe('delivered');
 }finally{await Promise.all([a,b,c].map(p=>stop(p).catch(()=>{})));await Promise.all(contexts.map(c=>c.close()));}
});

test('network recovery rotates real ICE credentials while retaining the peer connection and live call tracks',async({browser})=>{
 const contexts=await Promise.all([0,1].map(()=>browser.newContext({permissions:['microphone','camera']})));const [a,b]=await Promise.all(contexts.map(c=>c.newPage())) as [Page,Page];
 try{
  const [,ub]=await Promise.all([boot(a,5),boot(b,6)]);const id=await a.evaluate(u=>(window as ClientWindow).__messenger.addContact(u),ub);
  await expect.poll(async()=>(await snapshot(a)).conversations.find(c=>c.id===id)?.session?.status).toBe('connected');await a.evaluate(id=>(window as ClientWindow).__messenger.startCall(id),id);await expect.poll(async()=>(await snapshot(b)).activeCall?.session.callState).toBe('incoming');await b.evaluate(()=>(window as ClientWindow).__messenger.acceptCall());
  for(const page of [a,b])await expect.poll(()=>page.evaluate(()=>{const s=(window as ClientWindow).__messenger.getSnapshot().activeCall?.session;return s?.callState==='active'&&!!s.remoteStream?.getAudioTracks().some(t=>t.readyState==='live');})).toBe(true);
  await a.evaluate(()=>{const w=window as ClientWindow&{__networkProof?:any};const m=w.__messenger as any;const session=[...m.pairs.values()][0].session;const pc=session.pc as RTCPeerConnection;w.__networkProof={pc,tracks:session.getSnapshot().localStream.getTracks(),ufrag:pc.localDescription?.sdp.match(/a=ice-ufrag:([^\r\n]+)/)?.[1],offers:0};const create=pc.createOffer.bind(pc);pc.createOffer=async options=>{w.__networkProof.offers++;return create(options);};});
  const receivedBefore=await b.evaluate(async()=>{const session=[...((window as ClientWindow).__messenger as any).pairs.values()][0].session;const stats=await session.pc.getStats();let count=0;stats.forEach((s:any)=>{if(s.type==='inbound-rtp'&&s.kind==='audio')count+=s.packetsReceived??0;});return count;});
  await a.evaluate(()=>(window as ClientWindow).__messenger.networkChanged());
  await expect.poll(()=>a.evaluate(()=>{const w=window as ClientWindow&{__networkProof?:any};const p=w.__networkProof;const now=p.pc.localDescription?.sdp.match(/a=ice-ufrag:([^\r\n]+)/)?.[1];return !!now&&now!==p.ufrag;})).toBe(true);
  await expect.poll(async()=>(await snapshot(a)).conversations.find(c=>c.id===id)?.session?.status).toBe('connected');
  expect(await a.evaluate(()=>{const w=window as ClientWindow&{__networkProof?:any};const session=[...(w.__messenger as any).pairs.values()][0].session,p=w.__networkProof;const current=session.getSnapshot().localStream?.getTracks();return session.pc===p.pc&&p.tracks.length>0&&p.tracks.every((t:MediaStreamTrack)=>t.readyState==='live'&&current?.includes(t));})).toBe(true);
  await expect.poll(()=>a.evaluate(()=>(window as ClientWindow&{__networkProof?:any}).__networkProof.pc.signalingState)).toBe('stable');
  expect(await a.evaluate(()=>(window as ClientWindow&{__networkProof?:any}).__networkProof.offers)).toBeLessThanOrEqual(4);
  await expect.poll(()=>b.evaluate(async()=>{const session=[...((window as ClientWindow).__messenger as any).pairs.values()][0].session;const stats=await session.pc.getStats();let count=0;stats.forEach((s:any)=>{if(s.type==='inbound-rtp'&&s.kind==='audio')count+=s.packetsReceived??0;});return count;})).toBeGreaterThan(receivedBefore);
  expect((await snapshot(a)).activeCall?.session.callState).toBe('active');expect((await snapshot(b)).activeCall?.session.callState).toBe('active');await sendText(a,id,'После восстановления сигналинга и ICE');await expect.poll(async()=>(await snapshot(b)).conversations.find(c=>c.id===id)?.messages.map(m=>m.text)).toContain('После восстановления сигналинга и ICE');await expect.poll(async()=>(await snapshot(a)).conversations.find(c=>c.id===id)?.messages.at(-1)?.status).toBe('delivered');
 }finally{await Promise.all([a,b].map(p=>stop(p).catch(()=>{})));await Promise.all(contexts.map(c=>c.close()));}
});
