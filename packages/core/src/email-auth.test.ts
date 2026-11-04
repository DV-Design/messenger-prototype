import {describe,it,expect,vi} from 'vitest';
import {createDeviceIdentity,directoryClientFrameSchema,directoryServerFrameSchema,normalizeEmail,signAuthentication,signProfileResolve,verifyAuthentication,verifyProfileResolve,type DirectoryUser} from './directory.js';
import {EmailAuthError,signEmailStart,signEmailVerify,startEmailChallenge,verifyEmailChallenge,verifyEmailStart,verifyEmailVerify} from './email-auth.js';
const identity=createDeviceIdentity(n=>new Uint8Array(n).fill(91));const other=createDeviceIdentity(n=>new Uint8Array(n).fill(92));
const challenge='ab'.repeat(32),challengeId='cd'.repeat(16),email='user@example.com';
const self:DirectoryUser={userId:identity.userId,publicKey:identity.publicKey,username:'alice',displayName:'Alice',online:false,lastSeen:1};
const foreign:DirectoryUser={...self,userId:other.userId,publicKey:other.publicKey};
function fakeSocket(onOpen:(socket:any)=>void,onSend?:(frame:any,socket:any)=>void){
 const instances:any[]=[];
 class Socket {readyState=1;onopen:any;onmessage:any;onerror:any;onclose:any;closed=false;sent:any[]=[];url:string;
  constructor(url:string){this.url=url;instances.push(this);queueMicrotask(()=>onOpen(this));}
  push(frame:unknown){this.onmessage?.({data:JSON.stringify(frame)});}
  send(raw:string){const frame=JSON.parse(raw);this.sent.push(frame);onSend?.(frame,this);}
  close(){this.closed=true;}
 }
 vi.stubGlobal('WebSocket',Socket);return instances;
}
describe('email signature purposes',()=>{
 it('verifies only its own purpose, challenge, key and fields',()=>{
  const start=signEmailStart(identity,challenge,'recover',email,'ru');
  expect(verifyEmailStart(identity.publicKey,challenge,'recover',email,'ru',start)).toBe(true);
  expect(verifyEmailStart(identity.publicKey,'ef'.repeat(32),'recover',email,'ru',start)).toBe(false);
  expect(verifyEmailStart(other.publicKey,challenge,'recover',email,'ru',start)).toBe(false);
  expect(verifyEmailStart(identity.publicKey,challenge,'register',email,'ru',start)).toBe(false);
  expect(verifyEmailStart(identity.publicKey,challenge,'recover','evil@example.com','ru',start)).toBe(false);
  expect(verifyEmailStart(identity.publicKey,challenge,'recover',email,'en',start)).toBe(false);
  const verify=signEmailVerify(identity,challenge,challengeId,'123456');
  expect(verifyEmailVerify(identity.publicKey,challenge,challengeId,'123456',verify)).toBe(true);
  expect(verifyEmailVerify(identity.publicKey,challenge,challengeId,'123457',verify)).toBe(false);
  expect(verifyEmailVerify(identity.publicKey,challenge,'ef'.repeat(16),'123456',verify)).toBe(false);
  for(const crossed of [start,verify,signProfileResolve(identity,challenge),signAuthentication(identity,challenge,'alice','Alice')]){
   if(crossed!==verify)expect(verifyEmailVerify(identity.publicKey,challenge,challengeId,'123456',crossed)).toBe(false);
   if(crossed!==start)expect(verifyEmailStart(identity.publicKey,challenge,'recover',email,'ru',crossed)).toBe(false);
  }
  expect(verifyProfileResolve(identity.publicKey,challenge,start)).toBe(false);expect(verifyAuthentication(identity.publicKey,challenge,'alice','Alice',verify)).toBe(false);
  expect(verifyEmailStart(identity.publicKey,challenge,'recover',email,'ru','invalid')).toBe(false);
 });
});
describe('email frames',()=>{
 const sig='0'.repeat(128);
 const start=(address:string)=>directoryClientFrameSchema.safeParse({type:'email-start',purpose:'register',email:address,locale:'en',publicKey:identity.publicKey,signature:sig}).success;
 it('accepts a normalized single address and refuses anything else',()=>{
  expect(start(email)).toBe(true);expect(start('first.last+tag@sub.example.co')).toBe(true);
  for(const bad of ['User@example.com',' user@example.com','a@b','a,b@example.com','a@example.com,b@example.com','Name <a@example.com>','a b@example.com','a@example.com\nBcc: b@example.com','a'.repeat(250)+'@example.com'])expect(start(bad),bad).toBe(false);
  expect(normalizeEmail('  User@Example.COM ')).toBe(email);
 });
 it('keeps old frames valid and new fields strict',()=>{
  expect(directoryClientFrameSchema.safeParse({type:'authenticate',publicKey:identity.publicKey,username:'alice',displayName:'A',signature:sig}).success).toBe(true);
  expect(directoryClientFrameSchema.safeParse({type:'authenticate',publicKey:identity.publicKey,username:'alice',displayName:'A',signature:sig,emailProof:'ab'.repeat(32)}).success).toBe(true);
  expect(directoryClientFrameSchema.safeParse({type:'authenticate',publicKey:identity.publicKey,username:'alice',displayName:'A',signature:sig,emailProof:'short'}).success).toBe(false);
  expect(directoryClientFrameSchema.safeParse({type:'watch',userIds:[]}).success).toBe(true);
  expect(directoryClientFrameSchema.safeParse({type:'watch',userIds:[],identityMovedV1:false}).success).toBe(false);
  expect(directoryClientFrameSchema.safeParse({type:'email-verify',challengeId,code:'12345',publicKey:identity.publicKey,signature:sig}).success).toBe(false);
  expect(directoryServerFrameSchema.safeParse({type:'ready',self,emailBound:true}).success).toBe(false);
  expect(directoryServerFrameSchema.safeParse({type:'identity-moved',oldUserId:other.userId,user:self}).success).toBe(true);
 });
});
describe('bounded email helpers',()=>{
 it('normalizes, signs and closes after email-started',async()=>{
  const instances=fakeSocket(socket=>socket.push({type:'challenge',challenge}),(frame,socket)=>{expect(frame.email).toBe(email);expect(verifyEmailStart(frame.publicKey,challenge,'register',email,'ru',frame.signature)).toBe(true);socket.push({type:'email-started',challengeId});});
  try{expect(await startEmailChallenge('https://example.com/messenger',identity,{purpose:'register',email:' User@Example.com ',locale:'ru'})).toBe(challengeId);expect(instances[0].url).toBe('wss://example.com/messenger/directory');expect(instances[0].closed).toBe(true);}finally{vi.unstubAllGlobals();}
 });
 it('refuses an invalid address without opening a connection',()=>{
  const instances=fakeSocket(()=>{});
  try{expect(()=>startEmailChallenge('https://example.com',identity,{purpose:'register',email:'a,b@example.com',locale:'en'})).toThrow();expect(instances).toHaveLength(0);}finally{vi.unstubAllGlobals();}
 });
 it('returns proof or the canonical user and rejects a user for another key',async()=>{
  for(const [reply,expected] of [[{proof:'ab'.repeat(32)},{proof:'ab'.repeat(32)}],[{user:self},{user:self}],[{},{}]] as const){
   const instances=fakeSocket(socket=>socket.push({type:'challenge',challenge}),(frame,socket)=>{expect(verifyEmailVerify(frame.publicKey,challenge,challengeId,'123456',frame.signature)).toBe(true);socket.push({type:'email-verified',...reply});});
   try{expect(await verifyEmailChallenge('https://example.com',identity,challengeId,'123456')).toEqual(expected);expect(instances[0].closed).toBe(true);}finally{vi.unstubAllGlobals();}
  }
  const instances=fakeSocket(socket=>socket.push({type:'challenge',challenge}),(_frame,socket)=>socket.push({type:'email-verified',user:foreign}));
  try{await expect(verifyEmailChallenge('https://example.com',identity,challengeId,'123456')).rejects.toThrow(/identity mismatch/);expect(instances[0].closed).toBe(true);}finally{vi.unstubAllGlobals();}
 });
 it('separates server refusals from network failures',async()=>{
  const refused=fakeSocket(socket=>socket.push({type:'challenge',challenge}),(_frame,socket)=>socket.push({type:'error',code:'email-code-invalid',message:'no'}));
  try{const error=await verifyEmailChallenge('https://example.com',identity,challengeId,'123456').catch(e=>e);expect(error).toBeInstanceOf(EmailAuthError);expect(error.code).toBe('email-code-invalid');expect(refused[0].closed).toBe(true);}finally{vi.unstubAllGlobals();}
  for(const event of ['error','close','premature','oversized','wrong','repeat'] as const){
   const instances=fakeSocket(socket=>{if(event==='error')socket.onerror?.();else if(event==='close')socket.onclose?.();else if(event==='premature')socket.push({type:'email-started',challengeId});else if(event==='oversized')socket.onmessage?.({data:'x'.repeat(16*1024+1)});else if(event==='repeat'){socket.push({type:'challenge',challenge});socket.push({type:'challenge',challenge});}else{socket.push({type:'challenge',challenge});socket.push({type:'profile',user:null});}});
   try{const error=await startEmailChallenge('https://example.com',identity,{purpose:'recover',email,locale:'en'}).catch(e=>e);expect(error,event).toBeInstanceOf(Error);expect(error,event).not.toBeInstanceOf(EmailAuthError);expect(instances[0].closed,event).toBe(true);}finally{vi.unstubAllGlobals();}
  }
 });
 it('times out with complete handler and timer cleanup',async()=>{
  vi.useFakeTimers();const instances=fakeSocket(()=>{});
  try{const rejected=expect(startEmailChallenge('https://example.com',identity,{purpose:'recover',email,locale:'en'})).rejects.toThrow(/timed out/);await vi.advanceTimersByTimeAsync(15000);await rejected;expect(instances[0].closed).toBe(true);expect(instances[0].onmessage).toBeNull();expect(vi.getTimerCount()).toBe(0);}finally{vi.useRealTimers();vi.unstubAllGlobals();}
 });
});
