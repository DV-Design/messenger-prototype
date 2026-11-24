import {afterEach,describe,expect,it,vi} from 'vitest';
import {conversationInvite,createDeviceIdentity,type DeviceIdentity} from './directory.js';
import {PeerSession,type PeerSessionOptions} from './session.js';
import type {BulkSink} from './bulk.js';

const alice=createDeviceIdentity(n=>new Uint8Array(n).fill(31));const bob=createDeviceIdentity(n=>new Uint8Array(n).fill(32));
const sessions:PeerSession[]=[];
afterEach(()=>{for(const session of sessions.splice(0))session.disconnect();vi.useRealTimers();});
function random(seed:number){let value=seed;return (length:number)=>{value++;const result=new Uint8Array(length);result[0]=value&0xff;result[1]=(value>>8)&0xff;result[2]=(value>>16)&0xff;return result;};}
type Endpoint={session:PeerSession;internal:any;channel:any;wire:string[];binary:number;attach:()=>void;route:(other:Endpoint)=>void};
function endpoint(identity:DeviceIdentity,peer:DeviceIdentity,options:Partial<PeerSessionOptions>={}):Endpoint{
  const session=new PeerSession({serverUrl:'https://example.com',invite:conversationInvite(alice,bob.publicKey),contentIdentity:identity,remoteIdentityPublicKey:peer.publicKey,randomBytes:random(sessions.length*100+1),...options});
  sessions.push(session);
  const internal=session as any;internal.remoteDataReady=true;internal.localDataReady=true;internal.remoteContentE2E=true;internal.remoteBulk=true;internal.state.status='connecting';
  internal.pc={iceConnectionState:'connected',connectionState:'connected',getSenders:()=>[],close:vi.fn()};
  let destination:any;const e:Endpoint={session,internal,channel:undefined,wire:[],binary:0,attach:()=>internal.attachChannel(e.channel),route:other=>destination=other.channel};
  e.channel={readyState:'open',bufferedAmount:0,close:()=>{e.channel.readyState='closed';},
    send:(raw:string|Uint8Array)=>{if(e.channel.readyState!=='open')throw new Error('closed');if(typeof raw==='string'){e.wire.push(raw);destination?.onmessage?.({data:raw});}else{e.binary++;const copy=raw.slice();destination?.onmessage?.({data:copy.buffer});}}};
  return e;
}
const pattern=(size:number)=>{const data=new Uint8Array(size);for(let i=0;i<size;i++)data[i]=(i*31+7)&0xff;return data;};
function memorySink(store:{bytes:number[];finished:boolean;aborted:boolean},start=0):BulkSink{
  store.bytes.length=start;
  return {offset:start,write:async chunk=>{for(const byte of chunk)store.bytes.push(byte);},finish:async()=>{store.finished=true;},abort:async()=>{store.aborted=true;}};
}
async function connected(receiverOptions:Partial<PeerSessionOptions>){
  const a=endpoint(alice,bob,{onBulkOffer:async()=>undefined});const b=endpoint(bob,alice,receiverOptions);
  a.route(b);b.route(a);a.attach();b.attach();
  await vi.advanceTimersByTimeAsync(300);
  expect(a.session.getSnapshot().contentE2E).toBe(true);
  return {a,b};
}
describe('large files over an end-to-end session',()=>{
  it('streams a file as encrypted binary chunks and resolves only on the receiver acknowledgement',async()=>{
    vi.useFakeTimers();
    const store={bytes:[] as number[],finished:false,aborted:false};const progress:number[]=[];
    const {a,b}=await connected({onBulkOffer:async offer=>{expect(offer.size).toBe(1_300_000);return memorySink(store);},onBulkProgress:(_id,bytes,dir)=>{if(dir==='in')progress.push(bytes);}});
    const data=pattern(1_300_000);let done=false;
    const sending=a.session.sendBulk({id:'ab'.repeat(16),name:'big.bin',mime:'application/octet-stream',size:data.length},async(offset,length)=>data.slice(offset,offset+length)).then(()=>{done=true;});
    for(let i=0;i<200&&!done;i++)await vi.advanceTimersByTimeAsync(25);
    await sending;
    expect(store.finished).toBe(true);expect(store.bytes.length).toBe(data.length);expect(Buffer.from(store.bytes).equals(Buffer.from(data))).toBe(true);
    expect(a.binary).toBe(Math.ceil(data.length/65536));
    expect(progress.at(-1)).toBe(data.length);
    expect(a.wire.join('')).not.toContain('big.bin'); // the offer itself is sealed
    void b;
  });
  it('resumes from what the receiver already wrote after a cut',async()=>{
    vi.useFakeTimers();
    const store={bytes:[] as number[],finished:false,aborted:false};const data=pattern(400_000);
    for(const byte of data.slice(0,200_000))store.bytes.push(byte);
    const reads:number[]=[];
    const {a}=await connected({onBulkOffer:async()=>memorySink(store,200_000)});
    let done=false;const sending=a.session.sendBulk({id:'cd'.repeat(16),name:'part.bin',mime:'',size:data.length},async(offset,length)=>{reads.push(offset);return data.slice(offset,offset+length);}).then(()=>{done=true;});
    for(let i=0;i<200&&!done;i++)await vi.advanceTimersByTimeAsync(25);
    await sending;
    expect(reads[0]).toBe(200_000);expect(Buffer.from(store.bytes).equals(Buffer.from(data))).toBe(true);
  });
  it('stops when the direct path is lost and resumes the same file from the received offset',async()=>{
    vi.useFakeTimers();
    const store={bytes:[] as number[],finished:false,aborted:false};const data=pattern(6_000_000);let offers=0;
    const {a}=await connected({onBulkOffer:async()=>{offers++;return memorySink(store,store.bytes.length);}});
    let direct=true;let first:unknown;
    const slow=async(offset:number,length:number)=>{await new Promise(resolve=>setTimeout(resolve,60));return data.slice(offset,offset+length);};
    const one=a.session.sendBulk({id:'aa'.repeat(16),name:'big.bin',mime:'',size:data.length},slow,async()=>direct).catch(error=>{first=error;});
    await vi.advanceTimersByTimeAsync(1000);direct=false;
    for(let i=0;i<400&&!first;i++)await vi.advanceTimersByTimeAsync(25);
    await one;expect(String(first)).toMatch(/direct path was lost/);
    const got=store.bytes.length;expect(got).toBeGreaterThan(0);expect(got).toBeLessThan(data.length);expect(store.aborted).toBe(false);
    direct=true;let done=false;const reads:number[]=[];
    const two=a.session.sendBulk({id:'aa'.repeat(16),name:'big.bin',mime:'',size:data.length},async(offset,length)=>{reads.push(offset);return data.slice(offset,offset+length);},async()=>direct).then(()=>{done=true;});
    for(let i=0;i<800&&!done;i++)await vi.advanceTimersByTimeAsync(25);
    await two;expect(offers).toBe(2);expect(reads[0]).toBe(got);expect(Buffer.from(store.bytes).equals(Buffer.from(data))).toBe(true);
  });
  it('rejects when the receiver refuses, and never sends to a peer without the capability',async()=>{
    vi.useFakeTimers();
    const {a}=await connected({onBulkOffer:async()=>{throw new Error('Not enough free space');}});
    const refused=a.session.sendBulk({id:'ef'.repeat(16),name:'x',mime:'',size:10},async()=>new Uint8Array(10));const check=expect(refused).rejects.toThrow(/free space/);
    for(let i=0;i<20;i++)await vi.advanceTimersByTimeAsync(25);
    await check;
    a.internal.remoteBulk=false;
    await expect(a.session.sendBulk({id:'01'.repeat(16),name:'x',mime:'',size:10},async()=>new Uint8Array(10))).rejects.toThrow(/update/);
  });
});
