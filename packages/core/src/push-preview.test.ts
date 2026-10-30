import {afterEach,describe,expect,it,vi} from 'vitest';
import {createDeviceIdentity,directConversationId,directoryClientFrameSchema,type DirectoryUser,type WakeIntent,MAX_PUSH_PREVIEW_BYTES,pushPreviewSchema} from './directory.js';
import {encryptPushPreview,decryptPushPreview,MAX_PUSH_PREVIEW_TEXT_BYTES} from './push-preview.js';
import {MessengerClient} from './messenger.js';
import {sealLocalState} from './persistence.js';
const alice=createDeviceIdentity(n=>new Uint8Array(n).fill(81)),bob=createDeviceIdentity(n=>new Uint8Array(n).fill(82)),charlie=createDeviceIdentity(n=>new Uint8Array(n).fill(83));
const conversationId=directConversationId(alice.userId,bob.userId),messageId='ab'.repeat(16);
const aliceUser:DirectoryUser={userId:alice.userId,publicKey:alice.publicKey,username:'alice',displayName:'Алиса',online:false,lastSeen:0};
const intent=():WakeIntent=>({kind:'message',intentId:'cd'.repeat(16),expiresAt:Date.now()+60000});
const input=(text='Привет 👋'): {conversationId:string;messageId:string;text:string}=>({conversationId,messageId,text});
const seal=(text='Привет 👋',wake=intent())=>encryptPushPreview(alice,bob.publicKey,wake,input(text));
const clients:MessengerClient[]=[];afterEach(()=>{for(const c of clients.splice(0))c.disconnect();vi.useRealTimers();});
it('file label previews bind the file kind and origin without carrying file bytes',()=>{
 const wake:WakeIntent={...intent(),kind:'file'};
 const sealed=encryptPushPreview(alice,bob.publicKey,wake,input('Файл: photo.jpg'));
 expect(sealed).not.toContain('photo.jpg');
 expect(decryptPushPreview(bob,alice.publicKey,sealed,wake)).toMatchObject({kind:'file',conversationId,messageId,text:'Файл: photo.jpg'});
 expect(()=>decryptPushPreview(bob,alice.publicKey,sealed,{...wake,kind:'message'})).toThrow();
 expect(directoryClientFrameSchema.safeParse({type:'wake',to:bob.userId,...wake,preview:sealed}).success).toBe(true);
 expect(directoryClientFrameSchema.safeParse({type:'wake',to:bob.userId,...wake,kind:'message',preview:sealed}).success).toBe(false);
});

describe('bounded pair-authenticated push preview',()=>{
 it('rejects malformed preview JSON through safeParse without throwing',()=>{
  const frame={type:'wake',to:bob.userId,...intent()};
  for(const preview of ['not-json','{',JSON.stringify({kind:'message'})])expect(directoryClientFrameSchema.safeParse({...frame,preview}).success).toBe(false);
 });
 it('roundtrips short Unicode text without plaintext in ciphertext, randomizes nonces and rejects tampering',()=>{
  const wake=intent();const first=seal('Секретное сообщение 👋',wake);const second=seal('Секретное сообщение 👋',wake);
  expect(first).not.toContain('Секретное');expect(first).not.toBe(second);expect(decryptPushPreview(bob,alice.publicKey,first,wake)).toEqual({kind:'message',senderId:alice.userId,...input('Секретное сообщение 👋'),truncated:false});
  const envelope=JSON.parse(first);envelope.ciphertext=(envelope.ciphertext[0]==='0'?'1':'0')+envelope.ciphertext.slice(1);expect(()=>decryptPushPreview(bob,alice.publicKey,JSON.stringify(envelope),wake)).toThrow();
  expect(()=>decryptPushPreview(charlie,alice.publicKey,first,wake)).toThrow();expect(()=>decryptPushPreview(bob,charlie.publicKey,first,wake)).toThrow();
 });
 it('binds exact sender/recipient, kind, intent ID and original expiry and refuses expired replay',()=>{
  const wake=intent(),sealed=seal('message',wake);
  for(const wrong of [{...wake,kind:'file' as const},{...wake,intentId:'ee'.repeat(16)},{...wake,expiresAt:wake.expiresAt-1}])expect(()=>decryptPushPreview(bob,alice.publicKey,sealed,wrong)).toThrow();
  expect(()=>decryptPushPreview(bob,alice.publicKey,sealed,wake,wake.expiresAt)).toThrow();
  expect(()=>decryptPushPreview(bob,alice.publicKey,sealed,wake,NaN)).toThrow();expect(()=>decryptPushPreview(bob,alice.publicKey,sealed,wake,wake.expiresAt-65001)).toThrow();
  for(const change of [{senderId:charlie.userId},{recipientId:charlie.userId},{kind:'call'},{intentId:'ef'.repeat(16)},{expiresAt:wake.expiresAt+1}])expect(()=>decryptPushPreview(bob,alice.publicKey,JSON.stringify({...JSON.parse(sealed),...change}),wake)).toThrow();
 });
 it.each(['😀'.repeat(2000),'я'.repeat(4000),'x'.repeat(4000),'\u0000"\\\n'.repeat(1000),'é'.repeat(2000)])('bounds escaped and UTF8 payloads and never splits code points',text=>{
  const wake=intent();const sealed=seal(text,wake);const opened=decryptPushPreview(bob,alice.publicKey,sealed,wake);
  expect(new TextEncoder().encode(sealed).length).toBeLessThanOrEqual(MAX_PUSH_PREVIEW_BYTES);expect(new TextEncoder().encode(opened.text).length).toBeLessThanOrEqual(MAX_PUSH_PREVIEW_TEXT_BYTES);expect(text.startsWith(opened.text)).toBe(true);expect(opened.truncated).toBe(true);expect(opened.text).not.toContain('\ufffd');
 });
 it('validates envelope and wake strictly; previews cannot accompany file/call or legacy intents',()=>{
  const wake=intent(),preview=seal('message',wake);expect(directoryClientFrameSchema.safeParse({type:'wake',to:bob.userId,...wake,preview}).success).toBe(true);
  for(const kind of [undefined,'file','call'])expect(directoryClientFrameSchema.safeParse({type:'wake',to:bob.userId,...(kind?{...wake,kind}:{}),preview}).success).toBe(false);
  for(const value of ['x'.repeat(3001),JSON.stringify({...JSON.parse(preview),plaintext:'message'}),JSON.stringify({...JSON.parse(preview),nonce:'bad'})])expect(pushPreviewSchema.safeParse(value).success).toBe(false);
  expect(()=>seal('x'.repeat(4001))).toThrow(/limit/);
 });
});

describe('restored pinned-contact preview opening',()=>{
 function client(loadState?:()=>Promise<string|null>){const c=new MessengerClient({serverUrl:'https://example.com',identity:bob,username:'bob',displayName:'Боб',loadState});clients.push(c);return c;}
 it('uses the restored pinned contact name without mutating history, unread counts or delivery state',async()=>{
  const sealedState=sealLocalState(bob,{version:3,contacts:[aliceUser],conversations:[{id:conversationId,kind:'direct',title:'Алиса',memberIds:[alice.userId,bob.userId],messages:[],files:[],unread:0,updatedAt:0}],pending:[]});
  const c=client(async()=>sealedState),wake=intent();const opened=await c.openPushPreview(seal('on lock screen',wake),wake);
  expect(opened).toEqual({kind:'message',senderId:alice.userId,...input('on lock screen'),truncated:false,displayName:'Алиса'});expect(c.getSnapshot().conversations[0]).toMatchObject({unread:0,messages:[],files:[]});
 });
 it('rejects unknown contacts, unknown groups and a pinned contact who is not a group member',async()=>{
  const wake=intent();await expect(client().openPushPreview(seal('unknown',wake),wake)).rejects.toThrow(/sender/);
  const c=client();await c.addContact(aliceUser);const groupId='group:'+'aa'.repeat(16);const preview=encryptPushPreview(alice,bob.publicKey,wake,{conversationId:groupId,messageId,text:'group text'});
  await expect(c.openPushPreview(preview,wake)).rejects.toThrow(/membership/);
  (c as any).conversations.set(groupId,{id:groupId,kind:'group',title:'Other group',memberIds:[bob.userId,charlie.userId],messages:[],files:[],unread:0,updatedAt:0});await expect(c.openPushPreview(preview,wake)).rejects.toThrow(/membership/);
  (c as any).conversations.get(groupId).memberIds.push(alice.userId);expect((await c.openPushPreview(preview,wake)).text).toBe('group text');
 });
 it('exposes a nonterminal durable state flush and rejects storage failures',async()=>{
  let release!:()=>void;const write=new Promise<void>(yes=>{release=yes;});let completed=false;
  const c=new MessengerClient({serverUrl:'https://example.com',identity:bob,username:'bob',displayName:'Bob',saveState:async()=>write});clients.push(c);await c.addContact(aliceUser);const flushing=c.flushState().then(()=>{completed=true;});await Promise.resolve();expect(completed).toBe(false);release();await flushing;expect(completed).toBe(true);expect((c as any).closing).toBe(false);
  const bad=new MessengerClient({serverUrl:'https://example.com',identity:bob,username:'bob',displayName:'Bob',saveState:async()=>{throw new Error('disk failed');}});clients.push(bad);await bad.addContact(aliceUser);await expect(bad.flushState()).rejects.toThrow('disk failed');
 });
});
