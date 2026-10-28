import {afterEach,describe,expect,it,vi} from 'vitest';
import {PeerSession} from './session.js';
const sessions:PeerSession[]=[];
afterEach(()=>{for(const s of sessions.splice(0))s.disconnect();vi.useRealTimers();vi.unstubAllGlobals();});
async function harness(){
 vi.useFakeTimers();let random=0;const sockets:any[]=[];const channels:any[]=[];let stops=0;
 class Socket {readyState=1;onopen:any;onmessage:any;onclose:any;onerror:any;sent:any[]=[];constructor(){sockets.push(this);queueMicrotask(()=>this.onopen?.());}send(raw:string){const f=JSON.parse(raw);this.sent.push(f);if(f.type==='join')queueMicrotask(()=>this.onmessage?.({data:JSON.stringify({type:'joined',roomId:f.roomId,peerId:f.peerId,role:'initiator',peerPresent:sockets.length>1,...(sockets.length>1?{resumed:true}:{})})}));}close(){this.readyState=3;this.onclose?.();}}
 vi.stubGlobal('WebSocket',Socket);
 const pc:any={signalingState:'stable',connectionState:'connected',iceConnectionState:'connected',localDescription:null,
  createDataChannel:()=>{const c={readyState:'open',bufferedAmount:0,send:vi.fn(),close:vi.fn()};channels.push(c);return c;},
  createOffer:vi.fn(async()=>({type:'offer',sdp:'v=0\r\na=ice-ufrag:restarted\r\n'})),setLocalDescription:async(d:any)=>{pc.localDescription=d;pc.signalingState='have-local-offer';},
  setRemoteDescription:async()=>{pc.signalingState='stable';},getSenders:()=>[],getStats:async()=>new Map(),close:vi.fn()};
 const session=new PeerSession({serverUrl:'https://example.com',invite:'ab'.repeat(32),iceServers:[],randomBytes:n=>new Uint8Array(n).fill(++random),rtcFactory:()=>pc});sessions.push(session);
 const connecting=session.connect();await vi.advanceTimersByTimeAsync(1);await connecting;const internal=session as any;channels[0].onopen();internal.remoteId='bb'.repeat(16);internal.callId='cc'.repeat(16);internal.state.callState='active';internal.state.localStream={getTracks:()=>[{stop:()=>{stops++;}}]};
 return {session,internal,pc,sockets,channels,stops:()=>stops};
}
describe('bounded network handover with existing call media',()=>{
 it('keeps call tracks through a ten-second grace and requests an ICE restart offer',async()=>{
  const h=await harness();h.pc.connectionState='disconnected';h.pc.iceConnectionState='disconnected';h.pc.onconnectionstatechange();await vi.advanceTimersByTimeAsync(9000);
  expect(h.session.getSnapshot().recovering).toBe(true);expect(h.session.getSnapshot().callState).toBe('active');expect(h.stops()).toBe(0);expect(h.pc.createOffer).toHaveBeenCalledWith({iceRestart:true});
  h.pc.connectionState='connected';h.pc.iceConnectionState='connected';h.pc.onconnectionstatechange();await vi.advanceTimersByTimeAsync(2000);expect(h.session.getSnapshot().recovering).toBe(false);expect(h.session.getSnapshot().status).toBe('connected');expect(h.stops()).toBe(0);
 });
 it('does not extend the grace on repeated failure events and releases media at ten seconds',async()=>{
  const h=await harness();h.pc.iceConnectionState='disconnected';h.pc.connectionState='disconnected';h.pc.oniceconnectionstatechange();await vi.advanceTimersByTimeAsync(6000);h.pc.onconnectionstatechange();await vi.advanceTimersByTimeAsync(3999);expect(h.stops()).toBe(0);
  await vi.advanceTimersByTimeAsync(1);expect(h.stops()).toBe(1);expect(h.session.getSnapshot().callState).toBe('idle');expect(h.session.getSnapshot().error).toMatch(/10 seconds/);
 });
 it('reopens signaling with the same peer identity and secret without replacing the peer connection',async()=>{
  const h=await harness();const first=h.sockets[0].sent.find((x:any)=>x.type==='join');h.session.networkChanged();await vi.advanceTimersByTimeAsync(5);
  expect(h.sockets).toHaveLength(2);const second=h.sockets[1].sent.find((x:any)=>x.type==='join');expect(second).toEqual(first);expect(second.resumeToken).toMatch(/^[0-9a-f]{64}$/);expect(h.internal.pc).toBe(h.pc);expect(h.stops()).toBe(0);expect(h.session.getSnapshot().callState).toBe('active');expect(h.pc.createOffer).toHaveBeenCalledWith({iceRestart:true});
 });
 it('does not destroy a healthy direct call just because its signaling socket closes',async()=>{
  const h=await harness();h.sockets[0].close();expect(h.stops()).toBe(0);expect(h.session.getSnapshot().callState).toBe('active');await vi.advanceTimersByTimeAsync(300);expect(h.sockets).toHaveLength(2);expect(h.internal.pc).toBe(h.pc);
 });
 it('a responding peer requests ICE restart from the single offerer',async()=>{
  const h=await harness();h.internal.role='responder';h.pc.iceConnectionState='disconnected';h.pc.oniceconnectionstatechange();await vi.advanceTimersByTimeAsync(1);expect(h.pc.createOffer).not.toHaveBeenCalled();
  const signal=h.sockets[0].sent.find((x:any)=>x.type==='signal');expect(signal).toBeDefined();expect(h.internal.restartPending).toBe(true);
 });
 it('explicit remote leave ends the old call and waits for a fresh connection immediately',async()=>{
  const h=await harness();h.sockets[0].onmessage({data:JSON.stringify({type:'peer-left',peerId:h.internal.remoteId,reason:'left'})});expect(h.stops()).toBe(1);expect(h.session.getSnapshot().callState).toBe('idle');expect(h.session.getSnapshot().status).toBe('waiting');expect(h.session.getSnapshot().recovering).toBe(false);
 });
 it('an abrupt resumable remote loss retains call media during recovery',async()=>{
  const h=await harness();h.sockets[0].onmessage({data:JSON.stringify({type:'peer-left',peerId:h.internal.remoteId,reason:'disconnected'})});expect(h.stops()).toBe(0);expect(h.session.getSnapshot().callState).toBe('active');expect(h.session.getSnapshot().recovering).toBe(true);
 });
 it('explicit disconnect cancels recovery and prevents late timers reopening signaling',async()=>{
  const h=await harness();h.session.networkChanged();h.session.disconnect();await vi.advanceTimersByTimeAsync(12000);expect(h.sockets).toHaveLength(1);expect(h.stops()).toBe(1);expect(h.session.getSnapshot().callState).toBe('idle');
 });
});
