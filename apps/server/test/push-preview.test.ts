import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {afterEach,describe,expect,it} from 'vitest';
import {createDeviceIdentity,directConversationId,encryptPushPreview,decryptPushPreview,type WakeIntent,directoryClientFrameSchema} from '@messenger/core';
import {DirectoryServices} from '../src/services.js';
import {buildFcmWakeMessage} from '../src/providers.js';
const alice=createDeviceIdentity(n=>new Uint8Array(n).fill(61)),bob=createDeviceIdentity(n=>new Uint8Array(n).fill(62));
const paths:string[]=[];const servicesList:DirectoryServices[]=[];const databases:DatabaseSync[]=[];
afterEach(async()=>{for(const s of servicesList.splice(0))await s.close();for(const db of databases.splice(0))db.close();for(const p of paths.splice(0))rmSync(p,{recursive:true,force:true});});
const intent=(now:number,id=1):WakeIntent=>({kind:'message',intentId:id.toString(16).padStart(32,'0'),expiresAt:now+60000});
const preview=(wake:WakeIntent,text='Private locked-screen message')=>encryptPushPreview(alice,bob.publicKey,wake,{conversationId:directConversationId(alice.userId,bob.userId),messageId:'dd'.repeat(16),text});
it('routes distinct encrypted file previews only to opted-in clients and hides filenames from FCM/DB',async()=>{
 const f=fixture();f.service.registerPush(bob.userId,'file-preview-token',true,true);f.service.replaceWatchConsent(bob.userId,[alice.userId]);
 const first:WakeIntent={...intent(f.now,90),kind:'file'},second:WakeIntent={...intent(f.now,91),kind:'file'};
 const sealed=preview(first,'Файл: private-photo.jpg');await f.service.wake(alice.userId,bob.userId,first,sealed);await f.service.wake(alice.userId,bob.userId,second,preview(second));
 expect(f.seen).toHaveLength(2);
 const message=buildFcmWakeMessage('file-preview-token',first,f.now,true,sealed)!;
 expect(message.data?.intentKind).toBe('file');expect(message.notification).toBeUndefined();expect(JSON.stringify(message)).not.toContain('private-photo');
 expect(()=>buildFcmWakeMessage('token',{...first,kind:'message'},f.now,true,sealed)).toThrow();
 expect(JSON.stringify(f.db.prepare('SELECT * FROM push_tokens').all())).not.toContain(sealed);
});
function fixture(path=':memory:'){
 let now=1000000;const seen:Array<{token:string;intent?:WakeIntent;backgroundSync?:boolean;preview?:string}>=[];const db=new DatabaseSync(path);databases.push(db);
 db.exec('CREATE TABLE IF NOT EXISTS directory_users(user_id TEXT PRIMARY KEY) STRICT');for(const user of [alice,bob])db.prepare('INSERT OR IGNORE INTO directory_users VALUES (?)').run(user.userId);
 const service=new DirectoryServices(db,{serviceNow:()=>now,pushProvider:{async sendWake(token,wake,backgroundSync,sealed){seen.push({token,intent:wake,backgroundSync,preview:sealed});}}},()=>undefined,()=>[]);servicesList.push(service);
 return {db,service,seen,get now(){return now;},advance:(amount:number)=>{now+=amount;}};
}
describe('encrypted preview token compatibility and metadata-only persistence',()=>{
 it('migrates/persists the separate capability and resets it on omitted, false or non-background registration',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'lastcall-preview-'));paths.push(dir);const path=join(dir,'directory.sqlite');const old=new DatabaseSync(path);old.exec('CREATE TABLE directory_users(user_id TEXT PRIMARY KEY) STRICT; CREATE TABLE push_tokens(user_id TEXT PRIMARY KEY,token TEXT NOT NULL UNIQUE,updated_at INTEGER NOT NULL,background_sync INTEGER NOT NULL DEFAULT 0) STRICT;');old.prepare('INSERT INTO push_tokens VALUES (?,?,?,?)').run(bob.userId,'old-051-token',1,1);old.close();
  const f=fixture(path);expect(f.db.prepare('SELECT background_sync,message_preview FROM push_tokens').get()).toEqual({background_sync:1,message_preview:0});f.service.registerPush(bob.userId,'new-token',true,true);await f.service.close();f.db.close();databases.splice(databases.indexOf(f.db),1);
  const reopened=fixture(path);expect(reopened.db.prepare('SELECT message_preview FROM push_tokens').get()).toEqual({message_preview:1});reopened.service.registerPush(bob.userId,'new-token',true);expect(reopened.db.prepare('SELECT message_preview FROM push_tokens').get()).toEqual({message_preview:0});
  reopened.service.registerPush(bob.userId,'new-token',true,true);reopened.service.registerPush(bob.userId,'new-token',true,false);expect(reopened.db.prepare('SELECT message_preview FROM push_tokens').get()).toEqual({message_preview:0});reopened.service.registerPush(bob.userId,'new-token',false,true);expect(reopened.db.prepare('SELECT message_preview FROM push_tokens').get()).toEqual({message_preview:0});
  expect(()=>reopened.service.registerPush(bob.userId,'new-token',true,'true' as unknown as boolean)).toThrow(/mode/);
  expect(directoryClientFrameSchema.safeParse({type:'push-register',requestId:'ee'.repeat(16),token:'token',backgroundSync:true,messagePreview:true}).success).toBe(true);expect(directoryClientFrameSchema.safeParse({type:'push-register',requestId:'ee'.repeat(16),token:'token',messagePreview:'true'}).success).toBe(false);
 });
 it('delivers distinct new encrypted messages immediately, deduplicates intent retries and never persists payload',async()=>{
  const f=fixture();f.service.registerPush(bob.userId,'preview-token',true,true);f.service.replaceWatchConsent(bob.userId,[alice.userId]);
  const first=intent(f.now,1),second=intent(f.now,2);const sealed=preview(first);await f.service.wake(alice.userId,bob.userId,first,sealed);await f.service.wake(alice.userId,bob.userId,second,preview(second));await f.service.wake(alice.userId,bob.userId,first,sealed);
  expect(f.seen).toHaveLength(2);expect(f.seen[0]).toEqual({token:'preview-token',intent:first,backgroundSync:true,preview:sealed});
  const tables=f.db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{name:string}>;for(const {name} of tables){const rows=f.db.prepare(`SELECT * FROM ${name}`).all();const stored=JSON.stringify(rows);expect(stored).not.toContain(sealed);expect(stored).not.toContain('Private locked-screen message');}
 });
 it('preserves 0.5 and 0.5.1 generic delivery and 30s cooldown unless both capabilities are true',async()=>{
  for(const backgroundSync of [false,true]){
   const f=fixture();f.service.registerPush(bob.userId,'legacy-token',backgroundSync);f.service.replaceWatchConsent(bob.userId,[alice.userId]);const first=intent(f.now,1),second=intent(f.now,2);
   await f.service.wake(alice.userId,bob.userId,first,preview(first));await f.service.wake(alice.userId,bob.userId,second,preview(second));expect(f.seen).toHaveLength(1);expect(f.seen[0]?.preview).toBeUndefined();expect(f.seen[0]?.backgroundSync).toBe(backgroundSync);
  }
 });
 it('enforces consent, exact authenticated request routing/deadline and recipient hourly quota',async()=>{
  const f=fixture();f.service.registerPush(bob.userId,'preview-token',true,true);const wake=intent(f.now),sealed=preview(wake);
  await expect(f.service.wake(alice.userId,bob.userId,wake,sealed)).rejects.toMatchObject({code:'wake-not-allowed'});f.service.replaceWatchConsent(bob.userId,[alice.userId]);
  for(const wrong of [{...wake,intentId:'aa'.repeat(16)},{...wake,kind:'file' as const},{...wake,expiresAt:wake.expiresAt-1}])await expect(f.service.wake(alice.userId,bob.userId,wrong,sealed)).rejects.toMatchObject({code:'invalid-preview'});
  await expect(f.service.wake(bob.userId,bob.userId,wake,sealed)).rejects.toMatchObject({code:'invalid-preview'});await expect(f.service.wake(alice.userId,alice.userId,wake,sealed)).rejects.toMatchObject({code:'invalid-preview'});
  const tooLong={...wake,expiresAt:f.now+65001};await expect(f.service.wake(alice.userId,bob.userId,tooLong,preview(tooLong))).rejects.toMatchObject({code:'invalid-preview'});
  f.db.prepare('INSERT INTO service_quotas VALUES (?,?,?,?)').run('wake-preview-recipient',bob.userId,Math.floor(f.now/3600000),240);await expect(f.service.wake(alice.userId,bob.userId,wake,sealed)).rejects.toMatchObject({code:'service-rate-limit'});expect(f.seen).toEqual([]);
 });
});

describe('encrypted preview FCM payload',()=>{
 it('keeps authenticated expiry intact while capping TTL, omits auto-banners/collapse and stays below 4096 UTF8 bytes',()=>{
  const now=1000000,wake={...intent(now),expiresAt:now+62000};const text='😀'.repeat(2000);const sealed=preview(wake,text);const message=buildFcmWakeMessage('x'.repeat(170),wake,now,true,sealed)!;
  expect(message).not.toHaveProperty('notification');expect(message.android).not.toHaveProperty('notification');expect(message.android).not.toHaveProperty('collapseKey');expect(message.data).toEqual({kind:'lastcall-wake',intentKind:'message',intentId:wake.intentId,expiresAt:String(wake.expiresAt),preview:sealed});expect(message.android?.ttl).toBe(60000);expect(Buffer.byteLength(JSON.stringify(message),'utf8')).toBeLessThan(4096);
  expect(decryptPushPreview(bob,alice.publicKey,message.data!.preview!,wake,now).truncated).toBe(true);expect(JSON.stringify(message)).not.toContain('😀');expect(JSON.stringify(message)).not.toContain('Private locked-screen');
 });
 it('drops expired messages and rejects preview in legacy/file/mismatched deadline modes',()=>{
  const now=1000000,wake=intent(now),sealed=preview(wake);expect(buildFcmWakeMessage('token',wake,wake.expiresAt,true,sealed)).toBeUndefined();
  expect(()=>buildFcmWakeMessage('token',wake,now,false,sealed)).toThrow(/mode/);expect(()=>buildFcmWakeMessage('token',{...wake,kind:'file'},now,true,sealed)).toThrow(/mode/);expect(()=>buildFcmWakeMessage('token',{...wake,expiresAt:wake.expiresAt-1},now,true,sealed)).toThrow(/mode/);
 });
});

it('permits consecutive typed calls without weakening intent replay, consent, TTL or recipient limits',async()=>{
 const f=fixture();f.service.registerPush(bob.userId,'call-token');const first={...intent(f.now,1),kind:'call' as const},second={...intent(f.now,2),kind:'call' as const};
 await expect(f.service.wake(alice.userId,bob.userId,first)).rejects.toMatchObject({code:'wake-not-allowed'});f.service.replaceWatchConsent(bob.userId,[alice.userId]);
 await f.service.wake(alice.userId,bob.userId,first);await f.service.wake(alice.userId,bob.userId,second);await f.service.wake(alice.userId,bob.userId,first);expect(f.seen).toHaveLength(2);expect(f.seen.every(seen=>seen.intent?.expiresAt===f.now+30000)).toBe(true);
 f.db.prepare('UPDATE service_quotas SET count=120 WHERE scope=? AND quota_key=?').run('wake-call-recipient',bob.userId);await expect(f.service.wake(alice.userId,bob.userId,{...intent(f.now,3),kind:'call'})).rejects.toMatchObject({code:'service-rate-limit'});expect(f.seen).toHaveLength(2);
});
