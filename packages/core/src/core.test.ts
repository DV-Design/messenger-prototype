import {describe,it,expect} from 'vitest';
import {audioPolicy} from './audio.js';
import {createInvite,roomIdFromInvite,SignalingCipher} from './crypto.js';
import {clientFrameSchema,serverFrameSchema,dataFrameSchema,MAX_FILE_BYTES,FILE_CHUNK_BYTES} from './protocol.js';
import {PeerSession} from './session.js';
const invite='ab'.repeat(32);const alice='aa'.repeat(16);const bob='bb'.repeat(16);
function random(){let n=0;return (length:number)=>{const bytes=new Uint8Array(length);bytes[0]=++n;return bytes;};}
const body={kind:'renegotiate'} as const;
describe('invitation and authenticated signaling',()=>{
  it('requires 32 bytes from a secure random source, validates exact lowercase secret',()=>{
    expect(createInvite(()=>new Uint8Array(32).fill(9))).toBe('09'.repeat(32));
    expect(()=>createInvite(()=>new Uint8Array(31))).toThrow();
    expect(roomIdFromInvite(invite)).toMatch(/^[0-9a-f]{64}$/);
    expect(()=>roomIdFromInvite('password')).toThrow();expect(()=>roomIdFromInvite('AB'.repeat(32))).toThrow();
  });
  it('roundtrips, randomizes nonces and rejects replay and reordering',()=>{
    const a=new SignalingCipher(invite,alice,random());const b=new SignalingCipher(invite,bob,random());
    const first=a.seal(body,bob);const second=a.seal(body,bob);
    expect(first.nonce).not.toBe(second.nonce);expect(b.open(alice,second)).toEqual(body);
    expect(()=>b.open(alice,first)).toThrow(/Replay/i);expect(()=>b.open(alice,second)).toThrow(/Replay/i);
  });
  it('rejects wrong secret, sender, room and recipient; rejection does not consume sequence',()=>{
    const a=new SignalingCipher(invite,alice,random());const b=new SignalingCipher(invite,bob,random());const envelope=a.seal(body,bob);
    expect(()=>new SignalingCipher('bc'.repeat(32),bob).open(alice,envelope)).toThrow();
    expect(()=>b.open('cc'.repeat(16),envelope)).toThrow();
    expect(()=>new SignalingCipher(invite,'dd'.repeat(16)).open(alice,envelope)).toThrow(/recipient/);
    expect(()=>a.open(alice,envelope)).toThrow(/Reflected/);
    expect(b.open(alice,envelope)).toEqual(body);
  });
  it('rejects ciphertext and nonce tampering and malformed authenticated bodies',()=>{
    const a=new SignalingCipher(invite,alice,random());const b=new SignalingCipher(invite,bob);const envelope=a.seal(body,bob);
    const tampered={...envelope,ciphertext:(envelope.ciphertext[0]==='0'?'1':'0')+envelope.ciphertext.slice(1)};
    expect(()=>b.open(alice,tampered)).toThrow();expect(()=>b.open(alice,{...envelope,nonce:'ff'.repeat(24)})).toThrow();
    expect(b.open(alice,envelope)).toEqual(body);
  });
  it('bounds sender replay state without evicting usable replay protection',()=>{
    const b=new SignalingCipher(invite,bob);
    for(let i=0;i<16;i++){const sender=i.toString(16).padStart(32,'0');const a=new SignalingCipher(invite,sender,random());expect(b.open(sender,a.seal(body,bob))).toEqual(body);}
    const sender='ef'.repeat(16);const a=new SignalingCipher(invite,sender,random());expect(()=>b.open(sender,a.seal(body,bob))).toThrow(/capacity/);
  });
});
describe('wire and resource boundaries',()=>{
  it('accepts exact contract frames and rejects extra secrets and malformed identifiers',()=>{
    expect(clientFrameSchema.parse({type:'join',roomId:'00'.repeat(32),peerId:alice}).type).toBe('join');
    expect(()=>clientFrameSchema.parse({type:'join',roomId:'00'.repeat(32),peerId:alice,invite})).toThrow();
    expect(()=>clientFrameSchema.parse({type:'join',roomId:'wrong',peerId:alice})).toThrow();
    expect(serverFrameSchema.parse({type:'joined',roomId:'00'.repeat(32),peerId:alice,role:'initiator',peerPresent:false}).type).toBe('joined');
  });
  it('caps text, chunks, file declarations and source buffers before sending',async()=>{
    expect(()=>dataFrameSchema.parse({kind:'text',id:alice,text:'x'.repeat(4001),timestamp:0})).toThrow();
    expect(()=>dataFrameSchema.parse({kind:'file-start',id:alice,name:'x',mime:'',size:MAX_FILE_BYTES+1})).toThrow();
    expect(dataFrameSchema.parse({kind:'file-start',id:alice,name:'x',mime:'',size:MAX_FILE_BYTES}).kind).toBe('file-start');
    expect(()=>dataFrameSchema.parse({kind:'file-chunk',id:alice,offset:0,hex:'00'.repeat(FILE_CHUNK_BYTES+1)})).toThrow();
    const session=new PeerSession({invite,serverUrl:'http://127.0.0.1:8787',randomBytes:random()});
    await expect(session.sendFile({name:'x',mime:'',data:new Uint8Array(MAX_FILE_BYTES+1)})).rejects.toThrow(/5 MiB/);
    await expect(session.sendText('x'.repeat(4001))).rejects.toThrow(/4000/);
    await expect(session.sendText('x')).rejects.toThrow(/not connected/);
    session.disconnect();expect(session.getSnapshot().callState).toBe('idle');
  });
  it('explicitly fails relay-only with no TURN before opening a socket',async()=>{
    const session=new PeerSession({invite,serverUrl:'http://127.0.0.1:8787',iceServers:[],relayOnly:true,randomBytes:random()});
    await expect(session.connect()).rejects.toThrow(/TURN/);expect(session.getSnapshot().status).toBe('error');
  });
});
describe('bounded adaptive audio policy',()=>{
  it('reduces target bitrate as measured conditions deteriorate',()=>{
    expect(audioPolicy({rttMs:40,lossRatio:0}).maxBitrate).toBe(32000);
    expect(audioPolicy({rttMs:200,lossRatio:0}).maxBitrate).toBe(24000);
    expect(audioPolicy({rttMs:400,lossRatio:0}).maxBitrate).toBe(18000);
    expect(audioPolicy({rttMs:50,lossRatio:0.2}).maxBitrate).toBe(12000);
    expect(audioPolicy({rttMs:800,lossRatio:0}).maxBitrate).toBe(12000);
  });
  it('clamps loss and ignores invalid samples rather than exceeding bounds',()=>{
    for(const rttMs of [-1,0,180,700,10000,NaN,Infinity])for(const lossRatio of [-10,0,0.05,1,100,NaN]){const target=audioPolicy({rttMs,lossRatio}).maxBitrate;expect(target).toBeGreaterThanOrEqual(12000);expect(target).toBeLessThanOrEqual(32000);}
  });
});

describe('media lifecycle and stats direction',()=>{
  function fakeSession(){
    const session=new PeerSession({invite,serverUrl:'http://127.0.0.1:8787',randomBytes:random()});
    // Test platform adapters without acquiring the host machine's microphone/camera.
    const internal=session as unknown as {state:ReturnType<PeerSession['getSnapshot']>;pc:RTCPeerConnection;readStats:()=>Promise<void>;stopCall:()=>void;queue:Promise<void>};
    return {session,internal};
  }
  it('adapts outgoing audio to the remote receiver, not local incoming packet loss',async()=>{
    const {session,internal}=fakeSession();let requested=0;
    const report=new Map<string,any>([
      ['pair',{id:'pair',type:'candidate-pair',state:'succeeded',nominated:true,currentRoundTripTime:0.03,localCandidateId:'local',remoteCandidateId:'remote'}],
      ['local',{candidateType:'host'}],['remote',{candidateType:'srflx'}],
      ['out',{id:'out',type:'outbound-rtp',kind:'audio',bytesSent:1000,packetsSent:100,timestamp:1000}],
      ['in',{id:'in',type:'inbound-rtp',kind:'audio',packetsLost:999,packetsReceived:1}],
      ['feedback',{id:'feedback',type:'remote-inbound-rtp',kind:'audio',localId:'out',fractionLost:0,packetsLost:0}],
    ]);
    const sender={track:{kind:'audio',readyState:'live'},getParameters:()=>({encodings:[{}]}),setParameters:async(p:RTCRtpSendParameters)=>{requested=p.encodings[0]?.maxBitrate??0;}};
    internal.pc={getStats:async()=>report,getSenders:()=>[sender]} as unknown as RTCPeerConnection;
    await internal.readStats();expect(requested).toBe(32000);expect(session.getSnapshot().route).toBe('direct');
    report.get('feedback').fractionLost=0.2;report.get('in').packetsLost=0;
    await internal.readStats();expect(requested).toBe(12000);
    report.get('local').candidateType='relay';await internal.readStats();expect(session.getSnapshot().route).toBe('relay');
  });
  it('hangup stops local sources while preserving reusable receiver tracks',async()=>{
    const {session,internal}=fakeSession();let localStops=0;let remoteStops=0;let removed=0;
    const localTrack={stop:()=>{localStops++;}};const remoteTrack={stop:()=>{remoteStops++;}};
    internal.state={...session.getSnapshot(),callState:'active',localStream:{getTracks:()=>[localTrack]} as unknown as MediaStream,remoteStream:{getTracks:()=>[remoteTrack]} as unknown as MediaStream};
    internal.pc={getSenders:()=>[{track:localTrack}],removeTrack:()=>{removed++;}} as unknown as RTCPeerConnection;
    internal.stopCall();await internal.queue;
    expect(localStops).toBe(1);expect(remoteStops).toBe(0);expect(removed).toBe(1);expect(session.getSnapshot().callState).toBe('idle');expect(session.getSnapshot().remoteStream).toBeUndefined();
  });
  it('reuses completed immutable buffers across snapshot emissions',()=>{
    const {session,internal}=fakeSession();const data=new Uint8Array(1024);
    internal.state.files=[{id:alice,name:'x',mime:'',size:data.length,from:'peer',status:'complete',receivedBytes:data.length,data}];
    const first=session.getSnapshot();const second=session.getSnapshot();expect(first.files).not.toBe(second.files);expect(first.files[0]).not.toBe(second.files[0]);expect(first.files[0]?.data).toBe(second.files[0]?.data);
  });
});

describe('survivor reconnect negotiation',()=>{
  it('a surviving responder introduces itself to a replacement initiator',async()=>{
    const session=new PeerSession({invite,serverUrl:'http://127.0.0.1:8787',randomBytes:random()});
    const sent:string[]=[];
    const responder=session as unknown as {role:string;remoteId:string;peerId:string;socket:WebSocket;negotiate:()=>Promise<void>};
    responder.role='responder';responder.remoteId=bob;
    responder.socket={readyState:1,send:(frame:string)=>{sent.push(frame);}} as unknown as WebSocket;
    await responder.negotiate();
    expect(sent).toHaveLength(1);
    const packet=serverFrameSchema.parse({type:'signal',from:responder.peerId,payload:JSON.parse(sent[0]!).payload});
    if(packet.type!=='signal')throw new Error('Expected signal');
    const replacement=new SignalingCipher(invite,bob,random());
    expect(replacement.open(packet.from,packet.payload)).toEqual({kind:'renegotiate'});
  });
});

describe('cancelled permission request',()=>{
  it('stops late media without erasing a newer incoming invitation',async()=>{
    let grant!:(stream:MediaStream)=>void;let stopped=0;
    const session=new PeerSession({invite,serverUrl:'http://127.0.0.1:8787',randomBytes:random(),getUserMedia:()=>new Promise(resolve=>{grant=resolve;})});
    const internal=session as unknown as {state:ReturnType<PeerSession['getSnapshot']>;callId:string;pc:RTCPeerConnection};
    internal.pc={getSenders:()=>[]} as unknown as RTCPeerConnection;internal.state.status='connected';
    const outgoing=session.startCall();
    // A cancellation and fresh invitation arrive while the OS permission sheet is open.
    internal.callId='ef'.repeat(16);internal.state.callState='incoming';
    grant({getTracks:()=>[{stop:()=>{stopped++;}}]} as unknown as MediaStream);
    await expect(outgoing).rejects.toThrow(/cancelled/i);
    expect(stopped).toBe(1);expect(session.getSnapshot().callState).toBe('incoming');
  });
});
