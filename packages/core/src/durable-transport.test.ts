import {afterEach,describe,expect,it,vi} from 'vitest';
import {dataFrameSchema,type DataFrame} from './protocol.js';
import {PeerSession,type PeerSessionOptions} from './session.js';
const id='aa'.repeat(16);const secondId='bb'.repeat(16);
const text=(messageId=id):Extract<DataFrame,{kind:'text'}>=>({kind:'text',id:messageId,text:'durable',timestamp:123});
const sessions:PeerSession[]=[];
afterEach(()=>{for(const session of sessions.splice(0))session.disconnect();});
function deferred(){let resolve!:()=>void;let reject!:(error:Error)=>void;const promise=new Promise<void>((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
function harness(options:Partial<PeerSessionOptions>={}){
 let seed=0;const sent:DataFrame[]=[];
 const session=new PeerSession({invite:'ab'.repeat(32),serverUrl:'https://example.com',randomBytes:n=>new Uint8Array(n).fill(++seed),...options});sessions.push(session);
 const channel:any={readyState:'open',bufferedAmount:0,send:(raw:string)=>sent.push(JSON.parse(raw)),close:()=>{channel.readyState='closed';}};
 const internal=session as any;internal.attachChannel(channel);
 return {session,sent,channel,receive:(frame:DataFrame)=>channel.onmessage?.({data:JSON.stringify(frame)}),drain:()=>internal.receiveQueue as Promise<void>,internal};
}
function fileFrames(fileId=id):DataFrame[]{return [{kind:'file-start',id:fileId,name:'a',mime:'application/octet-stream',size:2,metadata:'signed-origin'},{kind:'file-chunk',id:fileId,offset:0,hex:'0102'},{kind:'file-end',id:fileId}];}
describe('durable receipt boundary',()=>{
 it('withholds text ACK until async storage completes, including metadata',async()=>{
  const write=deferred();const callback=vi.fn(async()=>write.promise);const h=harness({onMessage:callback});
  h.receive({...text(),metadata:'signed'});await Promise.resolve();expect(callback).toHaveBeenCalledWith(expect.objectContaining({metadata:'signed',timestamp:123}));expect(h.sent).toEqual([]);expect(h.session.getSnapshot().messages).toEqual([]);
  write.resolve();await h.drain();expect(h.sent).toEqual([{kind:'text-ack',id}]);expect(h.session.getSnapshot().messages).toHaveLength(1);
 });
 it('retries rejected persistence on identical replay without ACK or in-memory dedup loss',async()=>{
  const callback=vi.fn().mockRejectedValueOnce(new Error('disk full')).mockResolvedValue(undefined);const h=harness({onMessage:callback});
  h.receive(text());await h.drain();expect(h.sent).toEqual([]);expect(h.session.getSnapshot().messages).toEqual([]);
  h.receive(text());await h.drain();expect(callback).toHaveBeenCalledTimes(2);expect(h.sent).toEqual([{kind:'text-ack',id}]);
  h.receive(text());await h.drain();expect(callback).toHaveBeenCalledTimes(3);expect(h.session.getSnapshot().messages).toHaveLength(1);
 });
 it('awaits application persistence before following text and continues after a failed callback',async()=>{
  const write=deferred();const order:string[]=[];const h=harness({onApplication:async()=>{order.push('application');await write.promise;},onMessage:async()=>{order.push('text');}});
  h.receive({kind:'application',id,body:'{}'});h.receive(text());await Promise.resolve();expect(order).toEqual(['application']);expect(h.sent).toEqual([]);
  write.reject(new Error('roster write failed'));await h.drain();expect(order).toEqual(['application','text']);expect(h.sent).toEqual([{kind:'text-ack',id}]);
 });
 it('never ACKs an old async write after disconnect or channel replacement',async()=>{
  const write=deferred();const h=harness({onMessage:()=>write.promise});h.receive(text());await Promise.resolve();h.session.disconnect();write.resolve();await Promise.resolve();await Promise.resolve();
  expect(h.sent).toEqual([]);expect(h.session.getSnapshot().messages).toEqual([]);
 });
 it('never ACKs after a data channel closes during a pending durable write',async()=>{
  const write=deferred();const h=harness({onMessage:()=>write.promise});h.receive(text());await Promise.resolve();h.channel.readyState='closed';h.channel.onclose();write.resolve();await Promise.resolve();await Promise.resolve();expect(h.sent).toEqual([]);
 });
 it('bounds queued receive frames and closes the transport when a peer floods blocked storage',async()=>{
  const write=deferred();const callback=vi.fn(()=>write.promise);const h=harness({onMessage:callback});h.receive(text());await Promise.resolve();for(let n=0;n<512;n++)h.receive(text(secondId));
  expect(h.session.getSnapshot().status).toBe('error');expect(h.session.getSnapshot().error).toMatch(/capacity/);expect(h.channel.readyState).toBe('closed');write.resolve();await Promise.resolve();await Promise.resolve();expect(h.sent).toEqual([]);expect(callback).toHaveBeenCalledTimes(1);
 });
 it('bounds queued wire bytes independently of the number of frames',async()=>{
  const write=deferred();const h=harness({onApplication:()=>write.promise});h.receive({kind:'application',id,body:'{}'});await Promise.resolve();
  // JSON escaping keeps each frame below 32 KiB but fills the byte budget before 400 frames.
  for(let n=0;n<400&&h.channel.onmessage;n++)h.receive({kind:'text',id,text:'\\'.repeat(4000),metadata:'\\'.repeat(12000),timestamp:0});
  expect(h.session.getSnapshot().status).toBe('error');write.resolve();
 });
});
describe('durable file transfers and retries',()=>{
 it('withholds file ACK and complete status until bytes are saved',async()=>{
  const write=deferred();const callback=vi.fn(()=>write.promise);const h=harness({onFile:callback});for(const frame of fileFrames())h.receive(frame);
  await vi.waitFor(()=>expect(callback).toHaveBeenCalledTimes(1));expect(callback).toHaveBeenCalledWith(expect.objectContaining({status:'complete',data:new Uint8Array([1,2]),metadata:'signed-origin'}));expect(h.sent).toEqual([]);expect(h.session.getSnapshot().files[0]?.status).toBe('receiving');
  write.resolve();await h.drain();expect(h.sent).toEqual([{kind:'file-ack',id}]);expect(h.session.getSnapshot().files[0]?.status).toBe('complete');
 });
 it('does not ACK a failed file save and permits same-ID retry and completed replay',async()=>{
  const callback=vi.fn().mockRejectedValueOnce(new Error('disk full')).mockResolvedValue(undefined);const h=harness({onFile:callback});
  for(const frame of fileFrames())h.receive(frame);await h.drain();expect(h.sent).toEqual([]);expect(h.session.getSnapshot().files[0]?.status).toBe('error');
  for(let attempt=0;attempt<6;attempt++){for(const frame of fileFrames())h.receive(frame);await h.drain();}
  expect(callback).toHaveBeenCalledTimes(7);expect(h.sent).toHaveLength(6);expect(h.session.getSnapshot().files).toHaveLength(1);expect(h.session.getSnapshot().files[0]?.data).toEqual(new Uint8Array([1,2]));
 });
 it('does not ACK or resurrect a file when disconnect happens during its write',async()=>{
  const write=deferred();const callback=vi.fn(()=>write.promise);const h=harness({onFile:callback});for(const frame of fileFrames())h.receive(frame);await vi.waitFor(()=>expect(callback).toHaveBeenCalledTimes(1));h.session.disconnect();write.resolve();await Promise.resolve();await Promise.resolve();expect(h.sent).toEqual([]);expect(h.session.getSnapshot().files[0]?.status).toBe('error');
 });
 it('can resend an outgoing completed file ID without permanently consuming capacity',async()=>{
  const h=harness();for(let attempt=0;attempt<6;attempt++){
   const sending=h.session.sendFile({name:'a',mime:'',data:new Uint8Array([1,2])},{messageId:id,metadata:'signed'});await vi.waitFor(()=>expect(h.sent.filter(x=>x.kind==='file-end')).toHaveLength(attempt+1));h.receive({kind:'file-ack',id});await h.drain();await sending;
  }
  expect(h.session.getSnapshot().files).toHaveLength(1);expect(h.sent.find(x=>x.kind==='file-start')).toEqual(expect.objectContaining({metadata:'signed'}));
 });
 it('retries the same outgoing ID after a transfer failure',async()=>{
  const h=harness();const first=h.session.sendFile({name:'a',mime:'',data:new Uint8Array([1,2])},{messageId:id});const failure=expect(first).rejects.toThrow('network failed');
  await vi.waitFor(()=>expect(h.sent.filter(x=>x.kind==='file-end')).toHaveLength(1));h.internal.failOutgoing(new Error('network failed'));await failure;expect(h.session.getSnapshot().files[0]?.status).toBe('error');
  const retry=h.session.sendFile({name:'a',mime:'',data:new Uint8Array([1,2])},{messageId:id});await vi.waitFor(()=>expect(h.sent.filter(x=>x.kind==='file-end')).toHaveLength(2));h.receive({kind:'file-ack',id});await h.drain();await retry;expect(h.session.getSnapshot().files).toHaveLength(1);expect(h.session.getSnapshot().files[0]?.status).toBe('complete');
 });
 it('rejects callback false without ACK and permits replay',async()=>{
  const h=harness({onFile:()=>false,onMessage:()=>false});h.receive(text());for(const frame of fileFrames())h.receive(frame);await h.drain();expect(h.sent).toEqual([]);expect(h.session.getSnapshot().messages).toEqual([]);expect(h.session.getSnapshot().files[0]?.status).toBe('error');
 });
});
describe('optional origin metadata compatibility',()=>{
 it('accepts legacy frames and limits new metadata',async()=>{
  expect(dataFrameSchema.parse(text()).kind).toBe('text');expect(()=>dataFrameSchema.parse({...text(),metadata:'x'.repeat(12001)})).toThrow();expect(()=>dataFrameSchema.parse({...fileFrames()[0],metadata:'x'.repeat(12001)})).toThrow();
  const h=harness();await h.session.sendText('original',{messageId:id,timestamp:42,metadata:'signed'});expect(h.sent[0]).toEqual({kind:'text',id,text:'original',timestamp:42,metadata:'signed'});expect(h.session.getSnapshot().messages[0]?.metadata).toBe('signed');
 });
});
