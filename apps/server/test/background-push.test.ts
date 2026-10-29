import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {afterEach,describe,expect,it} from 'vitest';
import {directoryClientFrameSchema,type WakeIntent} from '@messenger/core';
import {DirectoryServices} from '../src/services.js';
import {buildFcmWakeMessage} from '../src/providers.js';
const paths:string[]=[];afterEach(()=>{for(const p of paths.splice(0))rmSync(p,{recursive:true,force:true});});
const sender='aa'.repeat(32),recipient='bb'.repeat(32),intentId='cc'.repeat(16);
describe('per-token background wake capability',()=>{
 it('migrates old token rows as legacy, persists opt-in over reopen and resets on omitted/false re-registration',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'lastcall-background-push-'));paths.push(dir);const path=join(dir,'directory.sqlite');let db=new DatabaseSync(path);let now=1000000;const seen:Array<{token:string;backgroundSync?:boolean}>=[];
  db.exec('CREATE TABLE directory_users(user_id TEXT PRIMARY KEY) STRICT; CREATE TABLE push_tokens(user_id TEXT PRIMARY KEY REFERENCES directory_users(user_id),token TEXT NOT NULL UNIQUE,updated_at INTEGER NOT NULL) STRICT;');db.prepare('INSERT INTO directory_users VALUES (?)').run(sender);db.prepare('INSERT INTO directory_users VALUES (?)').run(recipient);db.prepare('INSERT INTO push_tokens VALUES (?,?,?)').run(recipient,'old-token',now);
  const options={serviceNow:()=>now,pushProvider:{async sendWake(token:string,_intent?:WakeIntent,backgroundSync?:boolean){seen.push({token,backgroundSync});}}};const lookup=()=>undefined;
  let services=new DirectoryServices(db,options,lookup,()=>[]);services.replaceWatchConsent(recipient,[sender]);await services.wake(sender,recipient);expect(seen.at(-1)).toEqual({token:'old-token',backgroundSync:false});
  services.registerPush(recipient,'old-token',true);await services.close();db.close();db=new DatabaseSync(path);services=new DirectoryServices(db,options,lookup,()=>[]);now+=30001;await services.wake(sender,recipient);expect(seen.at(-1)).toEqual({token:'old-token',backgroundSync:true});
  services.registerPush(recipient,'rotated-token');now+=30001;await services.wake(sender,recipient);expect(seen.at(-1)).toEqual({token:'rotated-token',backgroundSync:false});services.registerPush(recipient,'rotated-token',true);services.registerPush(recipient,'rotated-token',false);expect(db.prepare('SELECT background_sync FROM push_tokens').get()).toEqual({background_sync:0});
  expect(()=>services.registerPush(recipient,'rotated-token','true' as unknown as boolean)).toThrow(/mode/);await services.close();db.close();
 });
 it('strictly validates the new optional flag and rejects content or alternate modes',()=>{
  const frame={type:'push-register',requestId:intentId,token:'device-token'};for(const backgroundSync of [undefined,false,true])expect(directoryClientFrameSchema.safeParse({...frame,...(backgroundSync===undefined?{}:{backgroundSync})}).success).toBe(true);
  for(const backgroundSync of ['true',1,null,{},'headless'])expect(directoryClientFrameSchema.safeParse({...frame,backgroundSync}).success).toBe(false);
  expect(directoryClientFrameSchema.safeParse({...frame,backgroundSync:true,message:'private content'}).success).toBe(false);
 });
});
describe('legacy versus opt-in FCM wire privacy and deadline',()=>{
 it('preserves old APK notification+data and uses only generic data for opted-in tokens',()=>{
  const now=1000000;for(const kind of ['message','file','call'] as const){
   const intent={kind,intentId,expiresAt:now+3600000};const legacy=buildFcmWakeMessage('token',intent,now)!;const headless=buildFcmWakeMessage('token',intent,now,true)!;
   expect(legacy.notification?.title).toBe('LastCall');expect(legacy.android?.notification?.channelId).toBe('lastcall-messages');expect(legacy.data).not.toHaveProperty('title');expect(headless).not.toHaveProperty('notification');expect(headless.android).not.toHaveProperty('notification');
   expect(headless.data).toEqual({kind:'lastcall-wake',intentKind:kind,intentId,expiresAt:String(now+(kind==='call'?30000:60000)),title:'LastCall',message:legacy.notification!.body,channelId:'lastcall-messages',tag:kind==='call'?'lastcall-call':'lastcall-wake'});expect(headless.android?.priority).toBe('high');expect(headless.android?.ttl).toBe(kind==='call'?30000:60000);
   expect(JSON.stringify(headless)).not.toMatch(/sender|userId|phone|filename|conversation|sdp|chatText/);expect(buildFcmWakeMessage('token',{...intent,expiresAt:now},now,true)).toBeUndefined();expect(buildFcmWakeMessage('token',{...intent,expiresAt:now+1234},now,true)?.android?.ttl).toBe(1234);
  }
  expect(buildFcmWakeMessage('old-token',undefined,now)?.data).toEqual({kind:'lastcall-wake'});
 });
});
