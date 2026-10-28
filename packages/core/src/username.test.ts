import {describe,it,expect,vi} from 'vitest';
import {createDeviceIdentity,profileResolvePayload,signProfileResolve,verifyProfileResolve,signAuthentication,verifyAuthentication,resolveDeviceProfile,directoryClientFrameSchema,directoryServerFrameSchema,type DirectoryUser} from './directory.js';
import {MessengerClient} from './messenger.js';
const identity=createDeviceIdentity(n=>new Uint8Array(n).fill(81));const otherIdentity=createDeviceIdentity(n=>new Uint8Array(n).fill(82));const challenge='ab'.repeat(32);
const self:DirectoryUser={userId:identity.userId,publicKey:identity.publicKey,username:'alice',displayName:'Каноническое имя',online:false,lastSeen:1};
const other:DirectoryUser={userId:otherIdentity.userId,publicKey:otherIdentity.publicKey,username:'bob',displayName:'Боб',online:false,lastSeen:1};
function random(){let count=0;return(n:number)=>{const result=new Uint8Array(n);new DataView(result.buffer).setUint32(0,++count);return result;};}
function resolverSocket(onOpen:(socket:any)=>void,onSend?:(frame:any,socket:any)=>void){
 const instances:any[]=[];
 class Socket {readyState=1;onopen:any;onmessage:any;onerror:any;onclose:any;closed=false;sent:any[]=[];url:string;
  constructor(url:string){this.url=url;instances.push(this);queueMicrotask(()=>onOpen(this));}
  push(frame:unknown){this.onmessage?.({data:JSON.stringify(frame)});}
  send(raw:string){const frame=JSON.parse(raw);this.sent.push(frame);onSend?.(frame,this);}
  close(){this.closed=true;this.readyState=3;queueMicrotask(()=>this.onclose?.());}
 }
 vi.stubGlobal('WebSocket',Socket);return instances;
}
describe('profile resolution signature purpose',()=>{
 it('signs exactly its own domain and rejects tampering, different challenges and login signatures',()=>{
  expect(new TextDecoder().decode(profileResolvePayload(challenge,identity.publicKey))).toBe(JSON.stringify(['lastcall/profile-resolve/v1',challenge,identity.publicKey]));
  const signature=signProfileResolve(identity,challenge);expect(verifyProfileResolve(identity.publicKey,challenge,signature)).toBe(true);
  expect(verifyProfileResolve(identity.publicKey,'cd'.repeat(32),signature)).toBe(false);expect(verifyProfileResolve(otherIdentity.publicKey,challenge,signature)).toBe(false);
  expect(verifyProfileResolve(identity.publicKey,challenge,signAuthentication(identity,challenge,'alice','Alice'))).toBe(false);
  expect(verifyAuthentication(identity.publicKey,challenge,'alice','Alice',signature)).toBe(false);
  expect(verifyProfileResolve(identity.publicKey,challenge,'invalid')).toBe(false);expect(()=>signProfileResolve({...identity,publicKey:otherIdentity.publicKey},challenge)).toThrow();
 });
});
describe('bounded standalone profile resolver',()=>{
 for(const result of [self,null])it(`returns ${result?'canonical profile':'null for an actually unregistered key'} and closes without authenticating/registering`,async()=>{
  const instances=resolverSocket(socket=>socket.push({type:'challenge',challenge}),(frame,socket)=>{expect(frame.type).toBe('resolve-profile');expect(verifyProfileResolve(frame.publicKey,challenge,frame.signature)).toBe(true);socket.push({type:'profile',user:result});});
  try{expect(await resolveDeviceProfile('https://example.com/messenger',identity)).toEqual(result);expect(instances[0].url).toBe('wss://example.com/messenger/directory');expect(instances[0].sent).toHaveLength(1);expect(instances[0].sent[0]).not.toHaveProperty('username');expect(instances[0].closed).toBe(true);expect(instances[0].onmessage).toBeNull();expect(instances[0].url).not.toContain(identity.publicKey);}finally{vi.unstubAllGlobals();}
 });
 it('rejects a validly shaped profile for another key and closes',async()=>{
  const instances=resolverSocket(socket=>socket.push({type:'challenge',challenge}),(_frame,socket)=>socket.push({type:'profile',user:other}));
  try{await expect(resolveDeviceProfile('https://example.com/messenger',identity)).rejects.toThrow(/identity mismatch/);expect(instances[0].closed).toBe(true);}finally{vi.unstubAllGlobals();}
 });
 it('does not interpret network failure, premature null or oversized frames as unregistered',async()=>{
  for(const event of ['error','premature','oversized'] as const){const instances=resolverSocket(socket=>{if(event==='error')socket.onerror?.();else if(event==='premature')socket.push({type:'profile',user:null});else socket.onmessage?.({data:'x'.repeat(16*1024+1)});});
   try{await expect(resolveDeviceProfile('https://example.com/messenger',identity)).rejects.toThrow();expect(instances[0].closed).toBe(true);}finally{vi.unstubAllGlobals();}
  }
 });
 it('rejects duplicate challenges rather than reusing a resolution connection',async()=>{
  const instances=resolverSocket(socket=>{socket.push({type:'challenge',challenge});socket.push({type:'challenge',challenge});});
  try{await expect(resolveDeviceProfile('https://example.com/messenger',identity)).rejects.toThrow(/Repeated/);expect(instances[0].sent).toHaveLength(1);expect(instances[0].closed).toBe(true);}finally{vi.unstubAllGlobals();}
 });
 it('times out with complete handler/timer cleanup',async()=>{
  vi.useFakeTimers();const instances=resolverSocket(()=>{});
  try{const rejected=expect(resolveDeviceProfile('https://example.com/messenger',identity)).rejects.toThrow(/timed out/);await vi.advanceTimersByTimeAsync(15000);await rejected;expect(instances[0].closed).toBe(true);expect(instances[0].onmessage).toBeNull();expect(instances[0].onclose).toBeNull();expect(vi.getTimerCount()).toBe(0);}finally{vi.unstubAllGlobals();vi.useRealTimers();}
 });
});
async function catalogFixture(){
 const sent:any[]=[];const instances=resolverSocket(socket=>socket.push({type:'challenge',challenge}),(frame,socket)=>{sent.push(frame);if(frame.type==='authenticate')queueMicrotask(()=>socket.push({type:'ready',self:{...self,online:true}}));});
 const client=new MessengerClient({serverUrl:'https://example.com/messenger',identity,username:'alice',displayName:'Stale local name',randomBytes:random()});await client.connect();return {client,sent,socket:instances[0],close:()=>{client.disconnect();vi.unstubAllGlobals();}};
}
describe('paginated directory API',()=>{
 it('validates exact bounded pages/cursors and leaves legacy ready unchanged',()=>{
  const requestId='ab'.repeat(16);expect(directoryClientFrameSchema.safeParse({type:'list-users',requestId,cursor:'alice'}).success).toBe(true);
  expect(directoryClientFrameSchema.safeParse({type:'list-users',requestId,cursor:'@ALICE'}).success).toBe(false);
  expect(directoryServerFrameSchema.safeParse({type:'users-page',requestId,users:Array(101).fill(other)}).success).toBe(false);
  expect(directoryServerFrameSchema.safeParse({type:'profile',user:null,requestId}).success).toBe(false);
  expect(directoryServerFrameSchema.safeParse({type:'ready',self,phoneVerified:false}).success).toBe(false);
 });
 it('correlates catalog pages without adding their entries as contacts/chats',async()=>{
  const f=await catalogFixture();try{
   const first=f.client.listUsers();const request=f.sent.at(-1);expect(request.type).toBe('list-users');expect(request).not.toHaveProperty('cursor');
   f.socket.push({type:'users-page',requestId:'ef'.repeat(16),users:[]});f.socket.push({type:'users-page',requestId:request.requestId,users:[other],nextCursor:'bob'});
   expect(await first).toEqual({users:[other],nextCursor:'bob'});expect(f.client.getSnapshot().contacts).toHaveLength(0);expect(f.client.getSnapshot().conversations).toHaveLength(0);expect(f.client.getSnapshot().self?.displayName).toBe(self.displayName);
   const next=f.client.listUsers('bob');expect(f.sent.at(-1).cursor).toBe('bob');f.socket.push({type:'users-page',requestId:f.sent.at(-1).requestId,users:[]});expect(await next).toEqual({users:[]});
  }finally{f.close();}
 });
 it('normalizes @/whitespace/NFKC/Cyrillic case and supports a 48-character display-name query',async()=>{
  const f=await catalogFixture();try{
   const search=f.client.search('  @ИВАН ИвАнОв  ');expect(f.sent.at(-1).query).toBe('иван иванов');f.socket.push({type:'results',requestId:f.sent.at(-1).requestId,users:[other]});await search;
   const wide=f.client.search(' ＡＬＩＣＥ ');expect(f.sent.at(-1).query).toBe('alice');f.socket.push({type:'results',requestId:f.sent.at(-1).requestId,users:[]});await wide;
   const full=f.client.search('Я'.repeat(48));expect(f.sent.at(-1).query).toBe('я'.repeat(48));f.socket.push({type:'results',requestId:f.sent.at(-1).requestId,users:[]});await full;await expect(f.client.search('я'.repeat(49))).rejects.toThrow();
  }finally{f.close();}
 });
 it('treats immutable device registration conflict as terminal instead of reconnecting forever',async()=>{
  vi.useFakeTimers();const instances=resolverSocket(socket=>socket.push({type:'challenge',challenge}),(frame,socket)=>{if(frame.type==='authenticate')socket.push({type:'error',code:'device-already-registered',message:'Device already has a server profile'});});
  const client=new MessengerClient({serverUrl:'https://example.com/messenger',identity,username:'renamed',displayName:'Alice'});
  try{const rejected=expect(client.connect()).rejects.toThrow('device-already-registered');await vi.advanceTimersByTimeAsync(1);await rejected;await vi.advanceTimersByTimeAsync(60000);expect(client.getSnapshot().status).toBe('error');expect(instances).toHaveLength(1);}finally{client.disconnect();vi.unstubAllGlobals();vi.useRealTimers();}
 });
});
