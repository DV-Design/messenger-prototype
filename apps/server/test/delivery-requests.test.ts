import {DatabaseSync} from 'node:sqlite';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {directoryClientFrameSchema} from '@messenger/core';
import {DirectoryServices} from '../src/services.js';
import {buildFcmDeliveryMessage,InvalidPushToken} from '../src/providers.js';

const alice='aa'.repeat(32),bob='bb'.repeat(32),carol='cc'.repeat(32);
const HOUR=3_600_000;
const open:Array<()=>Promise<void>>=[];
afterEach(async()=>{for(const close of open.splice(0))await close();});
function fixture(online:Set<string>=new Set()){
  const db=new DatabaseSync(':memory:');let now=10*HOUR;
  db.exec('CREATE TABLE directory_users(user_id TEXT PRIMARY KEY) STRICT;');
  for(const id of [alice,bob,carol])db.prepare('INSERT INTO directory_users VALUES (?)').run(id);
  const sendDelivery=vi.fn(async(_token:string,_role:string,_id:string,_expiresAt:number)=>{});
  const services=new DirectoryServices(db,{serviceNow:()=>now,pushProvider:{sendWake:async()=>{},sendDelivery}},()=>undefined,()=>[]);
  open.push(async()=>{await services.close();db.close();});
  services.registerPush(alice,'token-a',true,false,false,true);services.registerPush(bob,'token-b',true,false,false,true);
  services.replaceWatchConsent(bob,[alice]);
  const isOnline=(id:string)=>online.has(id);
  const rows=()=>db.prepare('SELECT * FROM delivery_requests').all() as Array<Record<string,number|string>>;
  return {db,services,sendDelivery,isOnline,rows,online,advance:(ms:number)=>{now+=ms;},now:()=>now};
}
const until=(f:{now:()=>number},ms=7*24*HOUR)=>f.now()+ms;

describe('delivery request storage',()=>{
  it('keeps one row per pair, without content, and only what the latest list says',async()=>{
    const f=fixture();
    await f.services.syncDelivery(alice,[{to:bob,expiresAt:until(f)}],f.isOnline);
    await f.services.syncDelivery(alice,[{to:bob,expiresAt:until(f)+1000}],f.isOnline);
    expect(f.rows()).toHaveLength(1);
    expect(Object.keys(f.rows()[0]!).sort()).toEqual(['expires_at','recipient_attempts','recipient_id','recipient_pushed_at','sender_id','sender_pushed_at']);
    await f.services.syncDelivery(alice,[],f.isOnline);
    expect(f.rows()).toHaveLength(0);
  });
  it('stores nothing for a recipient who has not allowed this sender',async()=>{
    const f=fixture();await f.services.syncDelivery(alice,[{to:carol,expiresAt:until(f)}],f.isOnline);
    expect(f.rows()).toHaveLength(0);expect(f.sendDelivery).not.toHaveBeenCalled();
  });
  it('caps a far-future deadline at seven days and removes expired rows',async()=>{
    const f=fixture();await f.services.syncDelivery(alice,[{to:bob,expiresAt:until(f,365*24*HOUR)}],f.isOnline);
    expect(f.rows()[0]!.expires_at).toBe(f.now()+7*24*HOUR);
    f.advance(7*24*HOUR);f.services.expire();expect(f.rows()).toHaveLength(0);
  });
  it('disappears with either account',async()=>{
    const f=fixture();await f.services.syncDelivery(alice,[{to:bob,expiresAt:until(f)}],f.isOnline);
    f.services.deleteAccount(bob);expect(f.rows()).toHaveLength(0);
  });
});

describe('who gets woken',()=>{
  it('nudges an offline recipient once, and not at all when the recipient is connected',async()=>{
    const f=fixture();await f.services.syncDelivery(alice,[{to:bob,expiresAt:until(f)}],f.isOnline);
    expect(f.sendDelivery).toHaveBeenCalledTimes(1);expect(f.sendDelivery.mock.calls[0]!.slice(0,2)).toEqual(['token-b','recipient']);
    await f.services.syncDelivery(alice,[{to:bob,expiresAt:until(f)+1}],f.isOnline);expect(f.sendDelivery).toHaveBeenCalledTimes(1);
    const g=fixture(new Set([bob]));await g.services.syncDelivery(alice,[{to:bob,expiresAt:until(g)}],g.isOnline);expect(g.sendDelivery).not.toHaveBeenCalled();
  });
  it('wakes a closed sender the moment the recipient appears, at most once a minute',async()=>{
    const f=fixture();await f.services.syncDelivery(alice,[{to:bob,expiresAt:until(f)}],f.isOnline);f.sendDelivery.mockClear();
    f.online.add(bob);await f.services.deliveryOnline(bob,f.isOnline);
    expect(f.sendDelivery.mock.calls.map(c=>c.slice(0,2))).toEqual([['token-a','sender']]);
    await f.services.deliveryOnline(bob,f.isOnline);expect(f.sendDelivery).toHaveBeenCalledTimes(1);
    f.advance(60_000);await f.services.deliveryOnline(bob,f.isOnline);expect(f.sendDelivery).toHaveBeenCalledTimes(2);
  });
  it('does not wake a sender who is already connected',async()=>{
    const f=fixture(new Set([alice]));await f.services.syncDelivery(alice,[{to:bob,expiresAt:until(f)}],f.isOnline);f.sendDelivery.mockClear();
    f.online.add(bob);await f.services.deliveryOnline(bob,f.isOnline);expect(f.sendDelivery).not.toHaveBeenCalled();
  });
  it('wakes the recipient the moment a returning sender connects',async()=>{
    const f=fixture();await f.services.syncDelivery(alice,[{to:bob,expiresAt:until(f)}],f.isOnline);f.sendDelivery.mockClear();f.advance(60_000);
    f.online.add(alice);await f.services.deliveryOnline(alice,f.isOnline);
    expect(f.sendDelivery.mock.calls.map(c=>c.slice(0,2))).toEqual([['token-b','recipient']]);
  });
  it('stops waking once the recipient withdraws consent',async()=>{
    const f=fixture();await f.services.syncDelivery(alice,[{to:bob,expiresAt:until(f)}],f.isOnline);f.sendDelivery.mockClear();
    f.services.replaceWatchConsent(bob,[]);f.advance(HOUR);f.online.add(bob);await f.services.deliveryOnline(bob,f.isOnline);
    f.online.delete(bob);await f.services.deliveryTick(f.isOnline);expect(f.sendDelivery).not.toHaveBeenCalled();
  });
  it('sends one push per recipient however many senders wait',async()=>{
    const f=fixture();f.services.replaceWatchConsent(bob,[alice,carol]);f.services.registerPush(carol,'token-c',true,false,false,true);
    await f.services.syncDelivery(alice,[{to:bob,expiresAt:until(f)}],f.isOnline);await f.services.syncDelivery(carol,[{to:bob,expiresAt:until(f)}],f.isOnline);f.sendDelivery.mockClear();
    f.advance(HOUR);await f.services.deliveryTick(f.isOnline);expect(f.sendDelivery).toHaveBeenCalledTimes(1);
  });
  it('retries with growing pauses and gives up after twelve attempts',async()=>{
    const f=fixture();await f.services.syncDelivery(alice,[{to:bob,expiresAt:until(f,60*24*HOUR)}],f.isOnline);f.sendDelivery.mockClear();
    f.advance(29*60_000);await f.services.deliveryTick(f.isOnline);expect(f.sendDelivery).not.toHaveBeenCalled();
    const stamps:number[]=[];
    f.db.exec('UPDATE delivery_requests SET expires_at=9007199254740000');
    for(let i=0;i<2000;i++){f.advance(5*60_000);const before=f.sendDelivery.mock.calls.length;await f.services.deliveryTick(f.isOnline);if(f.sendDelivery.mock.calls.length>before)stamps.push(f.now());f.services.reserveQuotas([]);}
    expect(f.sendDelivery.mock.calls.length).toBeLessThanOrEqual(11);
    const gaps=stamps.slice(1).map((value,index)=>value-stamps[index]!);
    expect(gaps.every((gap,index)=>index===0||gap>=gaps[index-1]!)).toBe(true);expect(Math.max(...gaps)).toBeLessThanOrEqual(24*HOUR+5*60_000);
  });
});

describe('compatibility and failure',()=>{
  it('never pushes a client that has not opted in',async()=>{
    const f=fixture();f.services.registerPush(bob,'token-b',true);await f.services.syncDelivery(alice,[{to:bob,expiresAt:until(f)}],f.isOnline);
    expect(f.rows()).toHaveLength(1);expect(f.sendDelivery).not.toHaveBeenCalled();
  });
  it('advertises the capability only to a client that asked for it',()=>{
    const f=fixture();expect(f.services.capabilities(alice,true)).not.toHaveProperty('deliveryV1');expect(f.services.capabilities(alice,true,true).deliveryV1).toBe(true);
  });
  it('drops a dead token and keeps the request',async()=>{
    const f=fixture();f.sendDelivery.mockRejectedValueOnce(new InvalidPushToken());
    await f.services.syncDelivery(alice,[{to:bob,expiresAt:until(f)}],f.isOnline);
    expect(f.db.prepare('SELECT 1 FROM push_tokens WHERE user_id=?').get(bob)).toBeUndefined();expect(f.rows()).toHaveLength(1);
  });
  it('accepts only recipient and deadline on the wire',()=>{
    const peer={to:bob,expiresAt:1_900_000_000_000};
    expect(directoryClientFrameSchema.safeParse({type:'delivery-sync',peers:[peer]}).success).toBe(true);
    expect(directoryClientFrameSchema.safeParse({type:'delivery-sync',peers:[]}).success).toBe(true);
    expect(directoryClientFrameSchema.safeParse({type:'delivery-sync',peers:[{...peer,text:'private'}]}).success).toBe(false);
    expect(directoryClientFrameSchema.safeParse({type:'delivery-sync',peers:Array(65).fill(peer)}).success).toBe(false);
  });
  it('puts no identity or content in the push and caps how long Google may hold it',()=>{
    const now=1_000_000;const message=buildFcmDeliveryMessage('token','sender','ab'.repeat(16),now+30*24*HOUR,now)!;
    expect(message.data).toEqual({kind:'lastcall-delivery',role:'sender',intentId:'ab'.repeat(16),expiresAt:String(now+30*24*HOUR)});
    expect(message.android).toEqual({priority:'high',ttl:7*24*HOUR,collapseKey:'lastcall-delivery'});expect(message).not.toHaveProperty('notification');
    expect(buildFcmDeliveryMessage('token','sender','ab'.repeat(16),now,now)).toBeUndefined();
  });
});
