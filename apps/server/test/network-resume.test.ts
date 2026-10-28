import {afterEach,describe,expect,it,vi} from 'vitest';
import {WebSocket} from 'ws';
import {createSignalingServer} from '../src/server.js';
const roomId='aa'.repeat(32),a='aa'.repeat(16),b='bb'.repeat(16),token='cc'.repeat(32);
const servers:ReturnType<typeof createSignalingServer>[]=[];const clients:WebSocket[]=[];
afterEach(async()=>{vi.restoreAllMocks();for(const c of clients.splice(0))c.terminate();await Promise.all(servers.splice(0).map(s=>s.close()));});
async function start(){const s=createSignalingServer({port:0,maxConnectionsPerIp:16});servers.push(s);return (await s.listen()).url;}
async function connect(url:string){const c=new WebSocket(url.replace('http','ws')+'/signal');clients.push(c);await new Promise<void>((yes,no)=>{c.once('open',yes);c.once('error',no);});return c;}
function next(c:WebSocket):Promise<any>{return new Promise((yes,no)=>{const t=setTimeout(()=>no(new Error('No frame')),1500);c.once('message',data=>{clearTimeout(t);yes(JSON.parse(data.toString()));});});}
async function join(c:WebSocket,peerId:string,resumeToken?:string){const reply=next(c);c.send(JSON.stringify({type:'join',roomId,peerId,resumeToken}));return reply;}
async function untilClosed(c:WebSocket){if(c.readyState===WebSocket.CLOSED)return;await new Promise<void>(yes=>c.once('close',()=>yes()));}
describe('bounded authenticated signaling resume',()=>{
 it('replaces an old socket only with the secret token, preserves its role and emits no false peer-left',async()=>{
  const url=await start(),old=await connect(url),other=await connect(url);await join(old,a,token);await join(other,b);const events:any[]=[];other.on('message',data=>events.push(JSON.parse(data.toString())));
  const attacker=await connect(url);expect(await join(attacker,a,'dd'.repeat(32))).toMatchObject({type:'error',code:'duplicate-peer'});const replacement=await connect(url);
  expect(await join(replacement,a,token)).toMatchObject({type:'joined',role:'initiator',resumed:true,peerPresent:true});await untilClosed(old);
  expect(events.filter(x=>x.type==='peer-left')).toEqual([]);expect(events.filter(x=>x.type==='peer-joined')).toEqual([{type:'peer-joined',peerId:a}]);
  const reply=next(other);replacement.send(JSON.stringify({type:'signal',payload:{version:1,nonce:'ee'.repeat(24),ciphertext:'ff'.repeat(32)}}));expect(await reply).toMatchObject({type:'signal',from:a});
 });
 it('restores both original roles from ten-second tombstones even when reconnect order reverses',async()=>{
  const url=await start(),first=await connect(url),second=await connect(url);await join(first,a,token);await join(second,b,'dd'.repeat(32));const firstClosed=untilClosed(first),secondClosed=untilClosed(second);first.terminate();second.terminate();await Promise.all([firstClosed,secondClosed]);
  const resumedB=await connect(url);expect(await join(resumedB,b,'dd'.repeat(32))).toMatchObject({type:'joined',role:'responder',resumed:true,peerPresent:false});
  const resumedA=await connect(url);expect(await join(resumedA,a,token)).toMatchObject({type:'joined',role:'initiator',resumed:true,peerPresent:true});
 });
 it('rejects wrong tokens for tombstones and forgets an expired resume instead of claiming success',async()=>{
  const url=await start(),first=await connect(url);await join(first,a,token);const end=untilClosed(first);first.terminate();await end;
  const bad=await connect(url);expect(await join(bad,a,'dd'.repeat(32))).toMatchObject({type:'error',code:'invalid-resume'});
  const now=Date.now();vi.spyOn(Date,'now').mockReturnValue(now+10001);const expired=await connect(url);const reply=await join(expired,a,token);expect(reply).toMatchObject({type:'joined'});expect(reply.resumed).toBeUndefined();
 });
 it('distinguishes explicit leave, abrupt resumable loss and legacy loss for opt-in peers',async()=>{
  const url=await start(),first=await connect(url),other=await connect(url);await join(first,a,token);await join(other,b,'dd'.repeat(32));
  let left=next(other);first.send(JSON.stringify({type:'leave'}));expect(await left).toEqual({type:'peer-left',peerId:a,reason:'left'});
  const rejoined=next(other);await join(first,a,token);await rejoined;left=next(other);first.terminate();expect(await left).toEqual({type:'peer-left',peerId:a,reason:'disconnected'});
  const fresh=await connect(url);const legacyJoined=next(other);await join(fresh,'ee'.repeat(16));await legacyJoined;left=next(other);fresh.terminate();expect(await left).toEqual({type:'peer-left',peerId:'ee'.repeat(16),reason:'left'});
 });
 it('explicit leave revokes the resume token and retains legacy join behavior',async()=>{
  const url=await start(),first=await connect(url);await join(first,a,token);first.send(JSON.stringify({type:'leave'}));const reply=await join(first,a,token);expect(reply).toMatchObject({type:'joined',role:'initiator'});expect(reply.resumed).toBeUndefined();
 });
});
