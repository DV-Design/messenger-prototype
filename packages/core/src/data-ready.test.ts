import {afterEach,describe,expect,it,vi} from 'vitest';
import {PeerSession,type PeerSessionOptions} from './session.js';
import {SignalingCipher} from './crypto.js';
import {dataFrameSchema,type DataFrame} from './protocol.js';

const sessions:PeerSession[]=[];
afterEach(()=>{for(const session of sessions.splice(0))session.disconnect();vi.useRealTimers();});
function endpoint(options:Partial<PeerSessionOptions>={},capable=true){
  let seed=sessions.length*20;
  const session=new PeerSession({serverUrl:'https://example.com',invite:'ab'.repeat(32),randomBytes:n=>new Uint8Array(n).fill(++seed),...options});sessions.push(session);
  const internal=session as any;internal.remoteDataReady=capable;internal.localDataReady=capable;
  internal.state.status='connecting';
  internal.pc={iceConnectionState:'connected',connectionState:'connected',getSenders:()=>[],close:vi.fn()};
  const sent:DataFrame[]=[];let destination:any;
  const channel:any={readyState:'open',bufferedAmount:0,send:(raw:string)=>{sent.push(JSON.parse(raw));destination?.onmessage?.({data:raw});},close:()=>{channel.readyState='closed';}};
  return {session,internal,channel,sent,attach:()=>internal.attachChannel(channel),route:(other:any)=>{destination=other.channel;},drain:()=>internal.receiveQueue as Promise<void>};
}
const marker='a=x-lastcall-data-ready:1';
const sdp='v=0\r\no=- 1 1 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\n';

describe('negotiated application data readiness',()=>{
  it('recovers dropped pre-listener frames and delivers the initial text plus exact file without content retries',async()=>{
    vi.useFakeTimers();let textWrites=0;let fileBytes:Uint8Array|undefined;
    const a=endpoint();const b=endpoint({onMessage:message=>{if(message.from==='peer')textWrites++;},onFile:file=>{fileBytes=file.data;}});a.route(b);b.route(a);
    // Match RN: native channel is open while the remote JS wrapper does not yet exist.
    a.attach();expect(a.sent.map(frame=>frame.kind)).toEqual(['ready']);expect(a.session.getSnapshot().status).toBe('connecting');
    await expect(a.session.sendText('must wait')).rejects.toThrow(/application-ready/);
    await expect(a.session.sendFile({name:'x',mime:'',data:new Uint8Array([9])})).rejects.toThrow(/application-ready/);
    b.attach();await vi.advanceTimersByTimeAsync(250);
    expect(a.session.getSnapshot().status).toBe('connected');expect(b.session.getSnapshot().status).toBe('connected');
    await a.session.sendText('first text');const bytes=new Uint8Array([0,1,127,128,255]);
    const transfer=a.session.sendFile({name:'first.bin',mime:'application/octet-stream',data:bytes});
    await vi.advanceTimersByTimeAsync(0);await b.drain();await a.drain();await transfer;
    expect(textWrites).toBe(1);expect(fileBytes).toEqual(bytes);expect(a.session.getSnapshot().messages[0]?.status).toBe('delivered');
    expect(a.sent.filter(frame=>frame.kind==='text')).toHaveLength(1);expect(a.sent.filter(frame=>frame.kind==='file-start')).toHaveLength(1);
    const count=a.sent.length+b.sent.length;await vi.advanceTimersByTimeAsync(1000);expect(a.sent.length+b.sent.length).toBe(count);
  });
  it('waits for a matching nonce ACK, keeps recovery gated, and expires readiness in bounded time',async()=>{
    vi.useFakeTimers();const h=endpoint();h.attach();const nonce=h.internal.readyNonce;
    h.channel.onmessage({data:JSON.stringify({kind:'ready-ack',nonce:'ff'.repeat(16)})});h.internal.recovered();
    expect(h.session.getSnapshot().status).toBe('connecting');expect(h.internal.dataReady).toBe(false);
    await vi.advanceTimersByTimeAsync(4999);expect(h.sent.length).toBeLessThanOrEqual(20);expect(h.internal.readyNonce).toBe(nonce);
    await vi.advanceTimersByTimeAsync(1);expect(h.session.getSnapshot().status).toBe('error');expect(h.session.getSnapshot().error).toMatch(/readiness timed out/);expect(h.channel.readyState).toBe('closed');
  });
  it('installs message listener before sending hello and handles an already-open channel exactly once',()=>{
    vi.useFakeTimers();const h=endpoint();h.channel.send=(raw:string)=>{expect(typeof h.channel.onmessage).toBe('function');const frame=JSON.parse(raw);h.sent.push(frame);if(frame.kind==='ready')h.channel.onmessage({data:JSON.stringify({kind:'ready-ack',nonce:frame.nonce})});};
    h.attach();expect(h.session.getSnapshot().status).toBe('connected');h.channel.onopen();expect(h.sent.map(frame=>frame.kind)).toEqual(['ready']);
  });
  it('does not announce readiness before its own capability has been sent',()=>{
    const h=endpoint();h.internal.localDataReady=false;h.attach();expect(h.sent).toEqual([]);expect(h.session.getSnapshot().status).toBe('connecting');
  });
  it('preserves established readiness across same-channel ICE recovery and bounds control floods',async()=>{
    vi.useFakeTimers();const h=endpoint();h.attach();h.channel.onmessage({data:JSON.stringify({kind:'ready-ack',nonce:h.internal.readyNonce})});
    h.internal.pc.iceConnectionState='disconnected';h.internal.socket={readyState:1};h.internal.socketJoined=true;h.internal.remoteId='ab'.repeat(16);h.internal.negotiate=async()=>{};h.internal.beginRecovery();
    expect(h.session.getSnapshot().recovering).toBe(true);
    // Duplicate protocol/control events during ICE restart cannot fake a recovered route.
    h.internal.channelOpened(h.channel);expect(h.session.getSnapshot().status).toBe('connecting');
    h.internal.pc.iceConnectionState='connected';h.internal.recovered();expect(h.session.getSnapshot().status).toBe('connected');expect(h.sent).toHaveLength(1);
    for(let n=0;n<65&&h.channel.onmessage;n++)h.channel.onmessage({data:JSON.stringify({kind:'ready',nonce:'cd'.repeat(16)})});
    expect(h.session.getSnapshot().error).toMatch(/readiness rate/);expect(h.channel.readyState).toBe('closed');
  });
  it('cancels timers and ignores old channel ACKs after teardown and replacement',async()=>{
    vi.useFakeTimers();const h=endpoint();h.attach();const oldMessage=h.channel.onmessage;const oldNonce=h.internal.readyNonce;h.internal.cleanupPeer();
    const newer:any={readyState:'open',bufferedAmount:0,send:vi.fn(),close:vi.fn()};h.internal.remoteDataReady=true;h.internal.localDataReady=true;h.internal.attachChannel(newer);
    oldMessage({data:JSON.stringify({kind:'ready-ack',nonce:oldNonce})});expect(h.internal.dataReady).toBe(false);expect(h.internal.readyNonce).not.toBe(oldNonce);
    h.session.disconnect();const count=newer.send.mock.calls.length;await vi.advanceTimersByTimeAsync(6000);expect(newer.send).toHaveBeenCalledTimes(count);
  });
  it('keeps legacy receive and send usable without sending any new control frame',async()=>{
    const a=endpoint({},false);const b=endpoint({},false);a.route(b);b.route(a);a.attach();b.attach();expect(a.sent).toEqual([]);expect(b.sent).toEqual([]);
    await a.session.sendText('new to old');await b.drain();await a.drain();await b.session.sendText('old to new');await a.drain();await b.drain();
    expect(a.session.getSnapshot().messages.filter(m=>m.status==='delivered')).toHaveLength(1);expect(b.session.getSnapshot().messages.filter(m=>m.status==='delivered')).toHaveLength(1);
    expect([...a.sent,...b.sent].some(frame=>frame.kind==='ready'||frame.kind==='ready-ack')).toBe(false);
  });
  it('strictly validates bounded control frames and rejects unnegotiated readiness',()=>{
    expect(()=>dataFrameSchema.parse({kind:'ready',nonce:'x'})).toThrow();expect(()=>dataFrameSchema.parse({kind:'ready-ack',nonce:'ab'.repeat(16),body:'secret'})).toThrow();
    const h=endpoint({},false);h.attach();h.channel.onmessage({data:JSON.stringify({kind:'ready',nonce:'cd'.repeat(16)})});expect(h.sent).toEqual([]);expect(h.session.getSnapshot().error).toMatch(/Unnegotiated/);
  });
});

describe('authenticated SDP capability compatibility',()=>{
  it('advertises once at session level on initial and resent descriptions without altering native SDP',()=>{
    const h=endpoint({},false);const remote='cc'.repeat(16);h.internal.remoteId=remote;const wire:any[]=[];
    h.internal.socket={readyState:1,send:(raw:string)=>wire.push(JSON.parse(raw))};
    h.internal.signal({kind:'description',description:{type:'offer',sdp}});h.internal.signal({kind:'description',description:{type:'offer',sdp:sdp.replace('m=application',marker+'\r\nm=application')}});
    const decoder=new SignalingCipher('ab'.repeat(32),remote);for(const frame of wire){const body:any=decoder.open(h.internal.peerId,frame.payload);expect(body.description.sdp.split(marker)).toHaveLength(2);expect(body.description.sdp.indexOf(marker)).toBeLessThan(body.description.sdp.indexOf('m='));}
    expect(sdp).not.toContain(marker);
  });
  it.each([[true,'initiator'],[false,'initiator'],[true,'responder'],[false,'responder']] as const)('parses remote capability before native SDP can expose a channel (capable=%s, role=%s)',async(capable,role)=>{
    const h=endpoint({},false);h.internal.role=role;h.internal.pc.signalingState=role==='initiator'?'have-local-offer':'stable';h.internal.localDataReady=role==='initiator';
    h.internal.remoteId='cc'.repeat(16);h.internal.socket={readyState:1,send:vi.fn()};
    h.internal.pc.createAnswer=async()=>({type:'answer',sdp});h.internal.pc.setLocalDescription=async(description:any)=>{h.internal.pc.localDescription=description;};
    h.internal.pc.setRemoteDescription=async(description:any)=>{expect(description.sdp).not.toContain(marker);h.internal.pc.remoteDescription=description;h.attach();expect(h.internal.remoteDataReady).toBe(capable);};
    await h.internal.handleSignal({kind:'description',description:{type:role==='initiator'?'answer':'offer',sdp:capable?sdp.replace('m=application',marker+'\r\nm=application'):sdp}});
    expect(h.sent.map(frame=>frame.kind)).toEqual(capable?['ready']:[]);expect(h.session.getSnapshot().status).toBe(capable?'connecting':'connected');
  });
});
