/** Public HTTPS/WSS smoke check. Logs outcomes, never invitation or signaling contents. */
import { randomBytes } from 'node:crypto';
import { lookup as dnsLookup } from 'node:dns';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { createInvite, roomIdFromInvite, SignalingCipher, serverFrameSchema, type ServerFrame } from '../../packages/core/src/index.js';
const base=new URL(process.env.PUBLIC_URL??'https://p2p.lienad.ru');
const resolved=process.env.PUBLIC_RESOLVED_IP;
const url=new URL('/signal',base);url.protocol=base.protocol==='https:'?'wss:':'ws:';
const invite=createInvite(randomBytes);const roomId=roomIdFromInvite(invite);
const peerA=randomBytes(16).toString('hex');const peerB=randomBytes(16).toString('hex');
const cipherA=new SignalingCipher(invite,peerA,randomBytes);const cipherB=new SignalingCipher(invite,peerB,randomBytes);
function connect(peerId:string){
  const frames:ServerFrame[]=[];const waiters=new Set<()=>void>();
  const socket=new WebSocket(url,{origin:base.origin,lookup:resolved?((hostname,options,callback)=>{
    if(typeof options==='object'&&options?.all)callback(null,[{address:resolved,family:4}] as never);
    else callback(null,resolved,4);
  }):dnsLookup});
  socket.on('message',data=>{frames.push(serverFrameSchema.parse(JSON.parse(data.toString())));for(const notify of waiters)notify();});
  socket.on('error',()=>{for(const notify of waiters)notify();});
  const ready=new Promise<void>((resolve,reject)=>{socket.once('open',()=>{socket.send(JSON.stringify({type:'join',roomId,peerId}));resolve();});socket.once('error',reject);});
  async function next(type:ServerFrame['type']){
    for(;;){const index=frames.findIndex(frame=>frame.type===type||frame.type==='error');if(index>=0){const frame=frames.splice(index,1)[0]!;if(frame.type==='error')throw new Error(`Public signaling error: ${frame.code}`);return frame;}
      await new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>{waiters.delete(wake);reject(new Error(`Timed out waiting for ${type}`));},10000);const wake=()=>{clearTimeout(timer);waiters.delete(wake);resolve();};waiters.add(wake);});
    }
  }
  return {socket,ready,next};
}
const first=connect(peerA);let second:ReturnType<typeof connect>|undefined;
const timeout=setTimeout(()=>{console.error('Public WSS smoke check exceeded deadline');first.socket.terminate();second?.socket.terminate();process.exitCode=1;},25000);
try{
  await first.ready;const joinedA=await first.next('joined');assert.equal(joinedA.type,'joined');
  second=connect(peerB);await second.ready;const joinedB=await second.next('joined');assert.equal(joinedB.type,'joined');
  first.socket.send(JSON.stringify({type:'signal',payload:cipherA.seal({kind:'renegotiate'},peerB)}));
  const relayed=await second.next('signal');assert.equal(relayed.type,'signal');
  if(relayed.type==='signal'){assert.equal(relayed.from,peerA);assert.deepEqual(cipherB.open(relayed.from,relayed.payload),{kind:'renegotiate'});}
  first.socket.close();const left=await second.next('peer-left');assert.equal(left.type,'peer-left');
  console.log('PASS: public TLS WSS, two peer joins, authenticated encrypted exchange, disconnect presence');
}finally{clearTimeout(timeout);first.socket.close();second?.socket.close();}
