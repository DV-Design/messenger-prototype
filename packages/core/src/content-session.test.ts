import {afterEach,describe,expect,it,vi} from 'vitest';
import {conversationInvite,createDeviceIdentity,type DeviceIdentity} from './directory.js';
import {SignalingCipher} from './crypto.js';
import {PeerSession,type PeerSessionOptions} from './session.js';

const alice=createDeviceIdentity(n=>new Uint8Array(n).fill(31));const bob=createDeviceIdentity(n=>new Uint8Array(n).fill(32));
const sessions:PeerSession[]=[];
afterEach(()=>{for(const session of sessions.splice(0))session.disconnect();vi.useRealTimers();});
function random(seed:number){let value=seed;return (length:number)=>{value++;const result=new Uint8Array(length);result[0]=value&0xff;result[1]=(value>>8)&0xff;result[2]=(value>>16)&0xff;return result;};}
type Endpoint={session:PeerSession;internal:any;channel:any;sent:any[];attach:()=>void;route:(other:Endpoint)=>void;drain:()=>Promise<void>};
function endpoint(identity:DeviceIdentity,peer:DeviceIdentity,options:Partial<PeerSessionOptions>={}):Endpoint{
  const invite=conversationInvite(alice,bob.publicKey);
  const session=new PeerSession({serverUrl:'https://example.com',invite,contentIdentity:identity,remoteIdentityPublicKey:peer.publicKey,randomBytes:random(sessions.length*100+1),...options});
  sessions.push(session);
  const internal=session as any;internal.remoteDataReady=true;internal.localDataReady=true;internal.remoteContentE2E=true;internal.state.status='connecting';
  internal.pc={iceConnectionState:'connected',connectionState:'connected',getSenders:()=>[],close:vi.fn()};
  const sent:any[]=[];let destination:any;
  const channel:any={readyState:'open',bufferedAmount:0,send:(raw:string)=>{sent.push(JSON.parse(raw));destination?.onmessage?.({data:raw});},close:()=>{channel.readyState='closed';}};
  return {session,internal,channel,sent,attach:()=>internal.attachChannel(channel),route:(other:Endpoint)=>destination=other.channel,drain:()=>internal.receiveQueue as Promise<void>};
}
describe('session-level content encryption',()=>{
  it('performs the signed ephemeral handshake and sends text only as sealed frames',async()=>{
    vi.useFakeTimers();
    const received:string[]=[];const a=endpoint(alice,bob);const b=endpoint(bob,alice,{onMessage:message=>{if(message.from==='peer')received.push(message.text);}});
    a.route(b);b.route(a);a.attach();b.attach();
    await vi.advanceTimersByTimeAsync(300);await a.drain();await b.drain();
    expect(a.session.getSnapshot().contentE2E).toBe(true);expect(b.session.getSnapshot().contentE2E).toBe(true);
    await a.session.sendText('secret over e2e');await vi.advanceTimersByTimeAsync(0);await b.drain();await a.drain();
    expect(received).toContain('secret over e2e');
    const sealed=a.sent.filter((frame:any)=>frame.kind==='sealed');
    expect(sealed.length).toBeGreaterThan(0);
    expect(JSON.stringify(a.sent)).not.toContain('secret over e2e');
    expect(JSON.stringify(a.sent)).toContain('sealed');
  });
  it('sends call captions only as sealed frames, and only to a peer that advertised them',async()=>{
    vi.useFakeTimers();
    const received:unknown[]=[];const a=endpoint(alice,bob,{callCaptions:true});const b=endpoint(bob,alice,{callCaptions:true,onApplication:payload=>{received.push(payload);}});
    a.route(b);b.route(a);a.attach();b.attach();
    await vi.advanceTimersByTimeAsync(300);await a.drain();await b.drain();
    expect(a.session.supportsCallCaptions()).toBe(false);
    a.internal.remoteCallCaptions=true;
    expect(a.session.supportsCallCaptions()).toBe(true);
    const frame={kind:'call-caption',callId:'ab'.repeat(16),language:'ru',segment:0,revision:0,final:true,text:'тайные слова'};
    await a.session.sendApplication(frame);await vi.advanceTimersByTimeAsync(0);await b.drain();
    expect(received).toContainEqual(frame);
    expect(JSON.stringify(a.sent)).not.toContain('тайные');
    const off=endpoint(alice,bob);off.internal.remoteCallCaptions=true;off.internal.contentCipher={dispose(){}};off.internal.dataReady=true;off.attach();
    expect(off.session.supportsCallCaptions()).toBe(false);
  });
  it('advertises captions only when this client enables them, and strips the marker before native SDP',()=>{
    for(const [callCaptions,expected] of [[true,true],[false,false]] as const){
      const h=endpoint(alice,bob,{callCaptions});h.internal.role='responder';h.internal.remoteId='cc'.repeat(16);
      const wire:any[]=[];h.internal.socket={readyState:1,send:(raw:string)=>wire.push(JSON.parse(raw))};
      h.internal.signal({kind:'description',description:{type:'offer',sdp:'v=0\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\n'}});
      const body:any=new SignalingCipher(conversationInvite(alice,bob.publicKey),'cc'.repeat(16)).open(h.internal.peerId,wire[0].payload);
      expect(body.description.sdp.includes('a=x-lastcall-call-captions:1')).toBe(expected);
    }
  });
  it('refuses to send or accept plaintext content when E2E is configured',async()=>{
    vi.useFakeTimers();
    const a=endpoint(alice,bob);a.internal.remoteContentE2E=false;a.internal.dataReady=true;a.attach();
    await expect(a.session.sendText('must not leak')).rejects.toThrow(/end-to-end|application-ready/i);
    const plain={kind:'text',id:'ab'.repeat(16),text:'plaintext',timestamp:1};
    a.channel.onmessage({data:JSON.stringify(plain)});
    expect(a.session.getSnapshot().error).toMatch(/Unencrypted content rejected/);
  });
  it('advertises content capability and strips it before native SDP',async()=>{
    vi.useFakeTimers();
    const h=endpoint(alice,bob);h.internal.role='responder';h.internal.remoteId='cc'.repeat(16);
    const wire:any[]=[];h.internal.socket={readyState:1,send:(raw:string)=>wire.push(JSON.parse(raw))};
    h.internal.signal({kind:'description',description:{type:'offer',sdp:'v=0\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\n'}});
    const decoder=new SignalingCipher(conversationInvite(alice,bob.publicKey),'cc'.repeat(16));
    const body:any=decoder.open(h.internal.peerId,wire[0].payload);
    expect(body.description.sdp).toContain('a=x-lastcall-content-e2e:1');expect(body.description.sdp).toContain('a=x-lastcall-data-ready:1');
    const native:string[]=[];h.internal.pc={signalingState:'stable',remoteDescription:null,setRemoteDescription:async(value:any)=>{native.push(value.sdp);h.internal.pc.remoteDescription=value;},createAnswer:async()=>({type:'answer',sdp:'v=0'}),setLocalDescription:async()=>{},getSenders:()=>[],close:vi.fn()};
    await h.internal.handleSignal({kind:'description',description:{type:'offer',sdp:'v=0\r\na=x-lastcall-content-e2e:1\r\na=x-lastcall-data-ready:1\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\n'}});
    expect(h.internal.remoteContentE2E).toBe(true);expect(native[0]).not.toContain('x-lastcall-content-e2e');expect(native[0]).not.toContain('x-lastcall-data-ready');
  });
});
