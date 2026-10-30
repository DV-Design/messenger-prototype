import { iceServersSchema } from './services.js';
import { endpointUrl } from './directory.js';
import { audioPolicy } from './audio.js';
import { AdaptiveVideoPolicy, type VideoTarget } from './video.js';
import { bytesToHex, hexToBytes, randomChecked, secureRandomBytes, SignalingCipher, type RandomBytes } from './crypto.js';
import { dataFrameSchema, FILE_CHUNK_BYTES, MAX_FILE_BYTES, MAX_FILES, MAX_TEXT_CHARS, MAX_WIRE_BYTES, serverFrameSchema, type ClientFrame, type DataFrame, type SignalBody } from './protocol.js';

export interface ChatMessage {id:string;text:string;from:'self'|'peer';timestamp:number;conversationId?:string;metadata?:string;status?:'sent'|'delivered'|'received';}
export interface SharedFile {id:string;name:string;mime:string;size:number;from:'self'|'peer';status:'sending'|'receiving'|'complete'|'error';receivedBytes:number;data?:Uint8Array;conversationId?:string;metadata?:string;}
export interface SessionSnapshot {
  status:'idle'|'connecting'|'waiting'|'connected'|'disconnected'|'error';error?:string;
  callId?:string;callVideo?:boolean;
  messages:ChatMessage[];callState:'idle'|'outgoing'|'incoming'|'active';muted:boolean;
  localStream?:MediaStream;remoteStream?:MediaStream;route:'unknown'|'direct'|'relay';
  recovering?:boolean;
  stats:{rttMs?:number;audioBitrateKbps?:number;packetsLost?:number;jitterMs?:number};files:SharedFile[];
}
export interface PeerSessionOptions {
  serverUrl:string;invite:string;relayOnly?:boolean;iceServers?:RTCIceServer[];expectPeer?:boolean;getIceServers?:()=>Promise<RTCIceServer[]>;
  randomBytes?:RandomBytes;rtcFactory?:(config:RTCConfiguration)=>RTCPeerConnection;
  getUserMedia?:(constraints:MediaStreamConstraints)=>Promise<MediaStream>;
  onChange?:(snapshot:SessionSnapshot)=>void;
  onMessage?:(message:ChatMessage)=>boolean|void|Promise<boolean|void>;
  onApplication?:(payload:unknown)=>void|Promise<void>;
  onFile?:(file:SharedFile)=>boolean|void|Promise<boolean|void>;
  allowConversation?:(conversationId:string|undefined)=>boolean;
}
const initialSnapshot=():SessionSnapshot=>({status:'idle',messages:[],callState:'idle',muted:false,route:'unknown',stats:{},files:[]});
interface PendingTransfer {id:string;resolve:()=>void;reject:(e:Error)=>void;timer:ReturnType<typeof setTimeout>;ended:boolean;}
const MAX_DATA_FRAME=32*1024;
// One maximum-size transfer (hex encoded), plus bounded control traffic.
const MAX_RECEIVE_FRAMES=512;
const MAX_RECEIVE_BYTES=12*1024*1024;
const BUFFER_HIGH=256*1024;
const BUFFER_LOW=64*1024;
const REQUEST_TIMEOUT=120000;
// Experimental, authenticated application capability; never passed to the native SDP engine.
const DATA_READY_ATTRIBUTE='a=x-lastcall-data-ready:1';
const DATA_READY_TIMEOUT=5000;
const DATA_READY_RETRY=250;
function readySdp(sdp:string):string{
  const lines=sdp.split(/\r?\n/).filter(line=>line!==DATA_READY_ATTRIBUTE);
  const media=lines.findIndex(line=>line.startsWith('m='));
  lines.splice(media<0?Math.max(0,lines.length-1):media,0,DATA_READY_ATTRIBUTE);
  return lines.join('\r\n');
}
export class PeerSession {
  private state=initialSnapshot();
  private options:PeerSessionOptions;
  private random:RandomBytes;
  private readonly peerId:string;
  readonly roomId:string;
  private cipher:SignalingCipher;
  private socket?:WebSocket;
  private pc?:RTCPeerConnection;
  private channel?:RTCDataChannel;
  private remoteDataReady=false;
  private localDataReady=false;
  private dataReady=false;
  private readyNonce?:string;
  private readyRetry?:ReturnType<typeof setInterval>;
  private readyDeadline?:ReturnType<typeof setTimeout>;
  private readyWindow=0;
  private readyFrames=0;
  private role:'initiator'|'responder'='initiator';
  private remoteId?:string;
  private generation=0;
  private queue:Promise<void>=Promise.resolve();
  private receiveQueue:Promise<void>=Promise.resolve();
  private receiving=new Set<Promise<void>>();
  private receiveGeneration=0;
  private receiveFrames=0;
  private receiveBytes=0;
  private pendingCandidates:RTCIceCandidateInit[]=[];
  private offerAgain=false;
  private statsTimer?:ReturnType<typeof setInterval>;
  private statsBusy=false;
  private previousAudio?:{bytes:number;time:number};
  private previousLoss?:{lost:number;received:number};
  private previousVideoLoss?:{id:string;lost:number;sent:number};
  private previousVideoPackets?:{id:string;sent:number};
  private videoPolicy=new AdaptiveVideoPolicy();
  private videoBasicOnly=new WeakSet<RTCRtpSender>();
  private unsupportedEncoders=new WeakSet<RTCRtpSender>();
  private callId?:string;
  private callVideo=false;
  private mediaPending=false;
  private callTimer?:ReturnType<typeof setTimeout>;
  private incoming?:{id:string;bytes:Uint8Array;offset:number;timer:ReturnType<typeof setTimeout>};
  private outgoing?:PendingTransfer;
  private openReject?: (error:Error)=>void;
  private transportTimer?:ReturnType<typeof setTimeout>;
  private hasTurn=false;
  private readonly resumeToken:string;
  private socketJoined=false;
  private activeIceServers:RTCIceServer[]=[];
  private hadConnected=false;
  private recoveryTimer?:ReturnType<typeof setTimeout>;
  private resumeTimer?:ReturnType<typeof setTimeout>;
  private restartPending=false;
  private signalBacklog:SignalBody[]=[];
  constructor(options:PeerSessionOptions) {
    const base=new URL(options.serverUrl);
    if(!['http:','https:'].includes(base.protocol)||base.username||base.password||base.search||base.hash) throw new Error('serverUrl must be an http(s) base URL without credentials, query or fragment');
    this.options=options;this.random=options.randomBytes??secureRandomBytes;
    this.peerId=this.id();this.resumeToken=bytesToHex(randomChecked(this.random,32));this.cipher=new SignalingCipher(options.invite,this.peerId,this.random);this.roomId=this.cipher.roomId;
  }
  private id(){return bytesToHex(randomChecked(this.random,16));}
  getSnapshot():SessionSnapshot {
    return {...this.state,callId:this.callId,callVideo:this.callVideo,messages:this.state.messages.map(x=>({...x})),files:this.state.files.map(x=>({...x})),stats:{...this.state.stats}};
  }
  private emit(){this.options.onChange?.(this.getSnapshot());}
  private change(update:Partial<SessionSnapshot>){this.state={...this.state,...update};this.emit();}
  private report(error:unknown){this.change({error:error instanceof Error?error.message:'Session operation failed'});}
  private serial(action:()=>Promise<void>):Promise<void> {
    const generation=this.generation;
    const next=this.queue.then(async()=>{if(generation!==this.generation)throw new Error('Session operation cancelled');await action();});
    this.queue=next.catch(error=>{if(generation===this.generation)this.report(error);});return next;
  }
  private wsSend(frame:ClientFrame){if(this.socket?.readyState!==1)throw new Error('Signaling connection is unavailable');this.socket.send(JSON.stringify(frame));}
  private signal(body:SignalBody){
    if(!this.remoteId)throw new Error('Remote peer identity unavailable');
    if(body.kind==='description')body={...body,description:{...body.description,sdp:readySdp(body.description.sdp)}};
    if(this.state.recovering&&(!this.socketJoined||this.socket?.readyState!==1)){if(this.signalBacklog.length>=128)throw new Error('Signaling recovery queue capacity exceeded');this.signalBacklog.push(body);return;}
    this.wsSend({type:'signal',payload:this.cipher.seal(body,this.remoteId)});
    if(body.kind==='description'){this.localDataReady=true;if(this.channel?.readyState==='open')this.channelOpened(this.channel);}
  }
  async connect():Promise<void> {
    if(['connecting','waiting','connected'].includes(this.state.status))return;
    this.disconnect();const generation=this.generation;
    this.change({status:'connecting',error:undefined});
    try {
      let iceServers=this.options.iceServers;
      if(!iceServers&&this.options.getIceServers)iceServers=await this.options.getIceServers();
      if(!iceServers){const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),10000);
        try {const response=await fetch(endpointUrl(this.options.serverUrl,'ice'),{signal:controller.signal});if(!response.ok)throw new Error('ICE configuration request failed');
          const value=await response.json() as {iceServers?:RTCIceServer[]};
          if(!Array.isArray(value.iceServers)||value.iceServers.length>20)throw new Error('Invalid ICE configuration');iceServers=value.iceServers;
        } finally {clearTimeout(timer);}
      }
      iceServers=iceServersSchema.parse(iceServers);
      const hasTurn=iceServers.some(server=>(Array.isArray(server.urls)?server.urls:[server.urls]).some(url=>/^turns?:/i.test(url)));
      this.hasTurn=hasTurn;
      if(this.options.relayOnly&&!hasTurn)throw new Error('Relay-only mode requires a configured TURN server');
      if(generation!==this.generation)throw new Error('Connection cancelled');
      this.activeIceServers=iceServers;await this.openSignaling(false);
    }catch(error){if(generation===this.generation){this.disconnect();this.change({status:'error',error:error instanceof Error?error.message:'Connection failed'});}throw error;}
  }
  private openSignaling(preserve:boolean):Promise<void>{
    const url=endpointUrl(this.options.serverUrl,'signal');url.protocol=url.protocol==='https:'?'wss:':'ws:';
    const socket=new WebSocket(url.toString());this.socket=socket;this.socketJoined=false;
    return new Promise<void>((resolve,reject)=>{
      let joined=false;let settled=false;const timeout=setTimeout(()=>fail(new Error('Signaling join timed out')),preserve?2000:10000);
      const fail=(error:Error)=>{if(settled)return;settled=true;clearTimeout(timeout);this.openReject=undefined;reject(error);};this.openReject=fail;
      socket.onopen=()=>{if(this.socket===socket)this.wsSend({type:'join',roomId:this.roomId,peerId:this.peerId,resumeToken:this.resumeToken});};
      socket.onmessage=event=>{
        if(this.socket!==socket)return;
        try{
          if(typeof event.data!=='string'||event.data.length>MAX_WIRE_BYTES)throw new Error('Invalid signaling frame');
          const frame=serverFrameSchema.parse(JSON.parse(event.data));
          if(frame.type==='error'){const error=new Error(`${frame.code}: ${frame.message}`);if(!joined)fail(error);else if(frame.code!=='peer-unavailable')this.report(error);return;}
          if(frame.type==='joined'){
            if(joined||frame.roomId!==this.roomId||frame.peerId!==this.peerId)throw new Error('Invalid room acknowledgement');
            if(preserve&&(!frame.resumed||frame.role!==this.role))throw new Error('Peer connection resume expired');
            joined=true;this.socketJoined=true;settled=true;clearTimeout(timeout);this.openReject=undefined;
            if(!preserve){this.role=frame.role;this.makePeer(this.activeIceServers);this.change({status:'waiting'});if(this.options.expectPeer)this.armTransportDeadline(frame.peerPresent?'SDP negotiation':'peer room join');}
            else if(frame.peerPresent){const backlog=this.signalBacklog.splice(0);for(const body of backlog)this.signal(body);if(this.pc?.signalingState==='have-local-offer'&&this.pc.localDescription?.sdp)this.signal({kind:'description',description:{type:'offer',sdp:this.pc.localDescription.sdp}});this.restartPending=true;void this.serial(()=>this.negotiate()).catch(()=>{});}
            resolve();return;
          }
          if(!joined)throw new Error('Signal before room acknowledgement');
          if(frame.type==='peer-joined'){
            if(frame.peerId===this.peerId)throw new Error('Invalid peer identity');
            if(this.remoteId&&this.remoteId!==frame.peerId){this.cleanupPeer();this.makePeer(this.activeIceServers);this.change({status:'waiting'});}
            this.remoteId=frame.peerId;if(this.hadConnected){for(const body of this.signalBacklog.splice(0))this.signal(body);if(this.pc?.signalingState==='have-local-offer'&&this.pc.localDescription?.sdp)this.signal({kind:'description',description:{type:'offer',sdp:this.pc.localDescription.sdp}});this.restartPending=true;}else this.armTransportDeadline('SDP negotiation');void this.serial(()=>this.negotiate()).catch(()=>{});
          }else if(frame.type==='peer-left'){
            if(this.remoteId&&frame.peerId!==this.remoteId)return;
            if(this.hadConnected&&frame.reason!=='left'){this.beginRecovery();return;}
            this.cleanupPeer();this.remoteId=undefined;this.makePeer(this.activeIceServers);this.change({status:'waiting'});if(this.options.expectPeer)this.armTransportDeadline('peer room join');
          }else if(frame.type==='signal'){
            if(this.remoteId&&frame.from!==this.remoteId)throw new Error('Unexpected peer identity');
            const body=this.cipher.open(frame.from,frame.payload);if(!this.remoteId)this.armTransportDeadline('SDP negotiation');this.remoteId=frame.from;
            // A cold peer can replace its PC while earlier authenticated signaling waits in the queue.
            const pc=this.pc;const from=frame.from;void this.serial(async()=>{if(this.pc===pc&&this.remoteId===from)await this.handleSignal(body);}).catch(()=>{});
          }
        }catch(error){if(!joined)fail(error instanceof Error?error:new Error('Invalid signaling'));else this.report(new Error('Rejected invalid or unauthenticated signaling'));}
      };
      socket.onerror=()=>{if(!joined)fail(new Error('WebSocket connection failed'));};
      socket.onclose=()=>{if(this.socket!==socket)return;if(!joined)fail(new Error('Signaling disconnected'));this.socket=undefined;this.socketJoined=false;if(this.pc&&this.hadConnected){this.beginRecovery();this.scheduleResume();}else{this.cleanupPeer();this.change({status:'disconnected'});}};
    });
  }
  /** Keep the existing call sources during a bounded Wi-Fi/cellular handover. */
  networkChanged():void{
    if(!this.pc||!this.hadConnected)return;
    const socket=this.socket;this.socket=undefined;this.socketJoined=false;if(socket){socket.onopen=null;socket.onmessage=null;socket.onclose=null;socket.onerror=null;try{socket.close();}catch{}}
    this.beginRecovery();clearTimeout(this.resumeTimer);this.resumeTimer=undefined;this.scheduleResume(0);
  }
  private beginRecovery(){
    if(!this.pc)return;
    if(!this.recoveryTimer){this.recoveryTimer=setTimeout(()=>{this.recoveryTimer=undefined;
      if(this.pc&&this.channelReady()&&['connected','completed'].includes(this.pc.iceConnectionState)){this.change({status:'connected',recovering:false,error:this.socket?.readyState===1?undefined:'Signaling is temporarily unavailable'});return;}
      this.failTransport('Network recovery timed out after 10 seconds');
    },10000);}
    clearTimeout(this.transportTimer);this.transportTimer=undefined;this.restartPending=true;this.change({status:'connecting',recovering:true,error:undefined});
    if(this.socketJoined&&this.socket?.readyState===1){void this.serial(()=>this.negotiate()).catch(()=>{});}else this.scheduleResume();
  }
  private scheduleResume(delay=250){
    if(this.resumeTimer||!this.pc||!this.hadConnected||this.socket)return;
    const pc=this.pc;this.resumeTimer=setTimeout(()=>{this.resumeTimer=undefined;if(this.pc!==pc)return;
      const opening=this.openSignaling(true);const attemptSocket=this.socket;
      void opening.catch(error=>{if(this.pc!==pc||this.socket!==attemptSocket)return;const socket=this.socket;this.socket=undefined;this.socketJoined=false;if(socket){socket.onclose=null;try{socket.close();}catch{}}
        if(error instanceof Error&&/resume expired|resume-role-conflict|invalid-resume/.test(error.message)){this.failTransport('Signaling resume is unavailable');return;}
        this.scheduleResume(500);
      });
    },delay);
  }
  private recovered(){
    if(!this.pc||!this.channelReady()||!['connected','completed'].includes(this.pc.iceConnectionState))return;
    clearTimeout(this.recoveryTimer);this.recoveryTimer=undefined;this.change({status:'connected',recovering:false,error:undefined});
  }
  private makePeer(iceServers:RTCIceServer[]){
    const pc=(this.options.rtcFactory??(config=>new RTCPeerConnection(config)))({iceServers,iceTransportPolicy:this.options.relayOnly?'relay':'all'});this.pc=pc;
    pc.onicecandidate=event=>{if(this.pc!==pc||!event.candidate)return;
      const c=event.candidate;try{this.signal({kind:'candidate',candidate:{candidate:c.candidate,sdpMid:c.sdpMid,sdpMLineIndex:c.sdpMLineIndex,usernameFragment:c.usernameFragment}});}catch(e){this.report(e);}};
    pc.onnegotiationneeded=()=>{if(this.pc===pc)void this.serial(()=>this.negotiate()).catch(()=>{});};
    pc.ondatachannel=event=>{if(this.pc===pc)this.attachChannel(event.channel);};
    pc.ontrack=event=>{if(this.pc!==pc)return;
      const stream=event.streams[0];if(stream)this.change({remoteStream:stream});
    };
    pc.onconnectionstatechange=()=>{if(this.pc!==pc)return;
      if(pc.connectionState==='failed'||pc.connectionState==='disconnected'){if(this.hadConnected)this.beginRecovery();else if(pc.connectionState==='failed')this.failTransport('ICE/data channel failed');}
      else if(pc.connectionState==='connected'&&this.channel?.readyState==='open'){clearTimeout(this.transportTimer);this.recovered();}
    };
    pc.oniceconnectionstatechange=()=>{if(this.pc!==pc)return;if(['disconnected','failed'].includes(pc.iceConnectionState)){if(this.hadConnected)this.beginRecovery();else if(pc.iceConnectionState==='failed')this.failTransport('ICE candidate connectivity failed');}else this.recovered();};
    if(this.role==='initiator')this.attachChannel(pc.createDataChannel('messenger-v1',{ordered:true}));
    this.statsTimer=setInterval(()=>{void this.readStats();},2000);
  }
  private attachChannel(channel:RTCDataChannel){
    if(this.channel&&this.channel!==channel){channel.close();return;}this.channel=channel;channel.bufferedAmountLowThreshold=BUFFER_LOW;
    // RN can expose an already-open channel. Install its message listener before
    // announcing readiness; native transport-open does not prove remote JS is listening.
    channel.onmessage=event=>{if(this.channel!==channel)return;try{if(typeof event.data!=='string'||event.data.length>MAX_DATA_FRAME)throw new Error('Oversized data frame');const frame=dataFrameSchema.parse(JSON.parse(event.data));if(frame.kind==='ready'||frame.kind==='ready-ack')this.handleReady(frame,channel);else this.enqueueData(frame,event.data.length,channel);}catch(e){this.report(e);}};
    channel.onopen=()=>this.channelOpened(channel);
    channel.onclose=()=>{if(this.channel===channel){this.resetReady();this.resetReceiveQueue();this.failTransfers();if(this.hadConnected)this.beginRecovery();else{this.stopCall();this.change({status:'disconnected'});}}};
    channel.onerror=()=>this.report(new Error('Data channel error'));
    if(channel.readyState==='open')this.channelOpened(channel);
  }
  private channelReady(){return this.channel?.readyState==='open'&&(!this.remoteDataReady||this.dataReady);}
  private resetReady(){clearInterval(this.readyRetry);clearTimeout(this.readyDeadline);this.readyRetry=undefined;this.readyDeadline=undefined;this.readyNonce=undefined;this.dataReady=false;this.readyFrames=0;this.readyWindow=0;}
  private channelOpened(channel:RTCDataChannel){
    if(this.channel!==channel||channel.readyState!=='open')return;
    if(this.remoteDataReady&&!this.dataReady){
      if(!this.localDataReady)return;
      if(this.readyNonce)return;
      const nonce=this.id();this.readyNonce=nonce;
      this.readyRetry=setInterval(()=>{if(this.channel===channel&&channel.readyState==='open'&&!this.dataReady)try{this.dataSend({kind:'ready',nonce});}catch{this.failTransport('application readiness failed');}},DATA_READY_RETRY);
      this.readyDeadline=setTimeout(()=>{if(this.channel===channel&&!this.dataReady)this.failTransport('application readiness timed out');},DATA_READY_TIMEOUT);
      this.dataSend({kind:'ready',nonce});return;
    }
    if(this.hadConnected){this.recovered();return;}
    this.hadConnected=true;clearTimeout(this.transportTimer);this.transportTimer=undefined;this.change({status:'connected',error:undefined});this.recovered();
  }
  private handleReady(frame:Extract<DataFrame,{kind:'ready'|'ready-ack'}>,channel:RTCDataChannel){
    if(!this.remoteDataReady||channel.readyState!=='open')throw new Error('Unnegotiated application readiness');
    const now=Date.now();if(now-this.readyWindow>=DATA_READY_TIMEOUT){this.readyWindow=now;this.readyFrames=0;}
    if(++this.readyFrames>64){this.failTransport('application readiness rate exceeded');return;}
    if(frame.kind==='ready'){
      this.dataSend({kind:'ready-ack',nonce:frame.nonce});this.channelOpened(channel);
    }else if(frame.nonce===this.readyNonce&&!this.dataReady){
      this.dataReady=true;clearInterval(this.readyRetry);clearTimeout(this.readyDeadline);this.readyRetry=undefined;this.readyDeadline=undefined;this.channelOpened(channel);
    }
  }
  private async negotiate(){
    if(this.state.callState==='outgoing'||this.state.callState==='incoming')return;
    if(this.role==='initiator')await this.offer();else if(this.remoteId)this.signal({kind:'renegotiate',...(this.restartPending?{iceRestart:true}:{})});
  }
  private async offer(){
    const pc=this.pc;if(!pc||!this.remoteId||this.role!=='initiator'||this.state.callState==='outgoing'||this.state.callState==='incoming')return;
    if(pc.signalingState!=='stable'){this.offerAgain=true;return;}
    this.offerAgain=false;const restart=this.restartPending;const offer=await pc.createOffer(restart?{iceRestart:true}:undefined);if(this.pc!==pc)return;
    await pc.setLocalDescription(offer);if(this.pc!==pc)return;
    this.signal({kind:'description',description:{type:'offer',sdp:pc.localDescription?.sdp??offer.sdp??''}});this.restartPending=false;this.armTransportDeadline('SDP answer');
  }
  private async handleSignal(body:SignalBody){
    const pc=this.pc;if(!pc)return;
    if(body.kind==='description'){
      if(body.description.type==='offer'&&this.role!=='responder')throw new Error('Unexpected SDP offer');
      if(body.description.type==='answer'&&pc.signalingState!=='have-local-offer')throw new Error('Unexpected SDP answer');
      const lines=body.description.sdp.split(/\r?\n/);const media=lines.findIndex(line=>line.startsWith('m='));
      const capability=lines.slice(0,media<0?undefined:media).includes(DATA_READY_ATTRIBUTE);
      // Parse before awaiting native SDP: it may emit datachannel/open during the await.
      if(!pc.remoteDescription)this.remoteDataReady=capability;
      await pc.setRemoteDescription({...body.description,sdp:lines.filter(line=>line!==DATA_READY_ATTRIBUTE).join('\r\n')});if(this.pc!==pc)return;
      for(const candidate of this.pendingCandidates.splice(0))await pc.addIceCandidate(candidate);
      if(body.description.type==='offer'){const answer=await pc.createAnswer();if(this.pc!==pc)return;await pc.setLocalDescription(answer);if(this.pc!==pc)return;this.signal({kind:'description',description:{type:'answer',sdp:pc.localDescription?.sdp??answer.sdp??''}});}
      else if(this.offerAgain)await this.offer();
      this.armTransportDeadline(pc.signalingState==='have-local-offer'?'SDP answer':'ICE/data channel');
    }else if(body.kind==='candidate'){
      if(pc.remoteDescription)await pc.addIceCandidate(body.candidate);else {if(this.pendingCandidates.length>=128)throw new Error('Too many queued ICE candidates');this.pendingCandidates.push(body.candidate);}
    }else if(body.kind==='renegotiate'){if(body.iceRestart)this.restartPending=true;await this.offer();
    }else if(body.kind==='call-invite'){
      if(this.state.callState!=='idle'){this.signal({kind:'call-end',callId:body.callId});return;}
      this.callId=body.callId;this.callVideo=body.video;this.change({callState:'incoming'});this.armCallTimeout();
    }else if(body.kind==='call-accept'){
      if(this.callId!==body.callId||this.state.callState!=='outgoing')return;
      clearTimeout(this.callTimer);this.change({callState:'active'});await this.negotiate();
    }else if(body.kind==='call-end'&&body.callId===this.callId){this.stopCall();await this.negotiate();}
  }
  private armTransportDeadline(stage:string){
    if(this.channel?.readyState==='open'||this.state.recovering)return;clearTimeout(this.transportTimer);const pc=this.pc;
    this.transportTimer=setTimeout(()=>{if(this.pc===pc&&this.channel?.readyState!=='open')this.failTransport(stage+' timed out');},30000);
  }
  private failTransport(stage:string){
    const ice=this.pc?.iceConnectionState??'new';const connection=this.pc?.connectionState??'new';
    const error=`Transport ${stage} (ICE=${ice}, connection=${connection}; TURN ${this.hasTurn?'configured':'not configured'}). Messages remain pending.`;
    this.cleanupPeer();this.change({status:'error',error});
  }
  private armCallTimeout(){clearTimeout(this.callTimer);this.callTimer=setTimeout(()=>this.endCall(),45000);}
  private async acquireMedia(video:boolean){
    const pc=this.pc;if(!pc)throw new Error('No peer connection');
    const media=this.options.getUserMedia??(constraints=>navigator.mediaDevices.getUserMedia(constraints));
    const generation=this.generation;const callId=this.callId;
    if(this.mediaPending)throw new Error('Media permission request is already pending');
    this.mediaPending=true;let stream:MediaStream;
    const audio={echoCancellation:true,noiseSuppression:true,autoGainControl:true};
    try{
      try{stream=await media({audio,video:video?{width:{ideal:1280,max:1280},height:{ideal:720,max:720},frameRate:{ideal:30,max:30}}:false});}
      catch(error){
        const name=error&&typeof error==='object'&&'name' in error?error.name:undefined;
        if(!video||!['OverconstrainedError','ConstraintNotSatisfiedError','TypeError'].includes(String(name))||this.pc!==pc||this.callId!==callId||generation!==this.generation)throw error;
        stream=await media({audio,video:true});
      }
    }finally{this.mediaPending=false;}
    if(this.pc!==pc||generation!==this.generation||!callId||this.callId!==callId){stream.getTracks().forEach(track=>track.stop());throw new Error('Call cancelled');}
    try{await this.serial(async()=>{
      if(this.pc!==pc||this.callId!==callId)throw new Error('Call cancelled');
      this.videoPolicy=new AdaptiveVideoPolicy();this.previousVideoLoss=undefined;this.previousVideoPackets=undefined;
      for(const track of stream.getTracks()){
        const sender=pc.addTrack(track,stream);
        if(track.kind==='video')await this.applyEncoderTarget(pc,sender,track,callId,this.videoPolicy.current());
      }
      if(this.pc!==pc||this.callId!==callId)throw new Error('Call cancelled');
      this.change({localStream:stream,muted:false});
    });}catch(error){stream.getTracks().forEach(track=>track.stop());throw error;}
  }
  async startCall(video=false):Promise<void>{
    if(this.state.status!=='connected'||this.state.callState!=='idle')throw new Error('A connected, idle session is required');
    const callId=this.id();this.callId=callId;this.callVideo=video;this.change({callState:'outgoing'});
    try{await this.acquireMedia(video);if(this.callId!==callId)throw new Error('Call cancelled');this.signal({kind:'call-invite',callId,video});this.armCallTimeout();}catch(error){if(this.callId===callId)this.stopCall();throw error;}
  }
  async acceptCall():Promise<void>{
    if(this.mediaPending)throw new Error('Media permission request is already pending');
    if(this.state.callState!=='incoming'||!this.callId)throw new Error('No incoming call');
    const callId=this.callId;
    try{await this.acquireMedia(this.callVideo);if(this.callId!==callId)throw new Error('Call cancelled');this.signal({kind:'call-accept',callId});clearTimeout(this.callTimer);this.change({callState:'active'});await this.serial(()=>this.negotiate());}catch(error){if(this.callId===callId)this.endCall();throw error;}
  }
  rejectCall():void{if(this.state.callState==='incoming')this.endCall();}
  endCall():void{
    const callId=this.callId;this.stopCall();if(callId){try{this.signal({kind:'call-end',callId});}catch{}void this.serial(()=>this.negotiate()).catch(()=>{});}
  }
  private stopCall(){
    clearTimeout(this.callTimer);this.callTimer=undefined;this.callId=undefined;
    this.videoPolicy=new AdaptiveVideoPolicy();this.previousVideoLoss=undefined;this.previousVideoPackets=undefined;
    this.state.localStream?.getTracks().forEach(track=>track.stop());
    // Receiver tracks belong to the reusable peer connection. Stopping them here
    // would permanently end a transceiver reused by the next call. Hide the stream;
    // local sender tracks are stopped above and pc.close() releases receivers.
    const pc=this.pc;const senders=pc?.getSenders().filter(sender=>sender.track);
    if(pc&&senders?.length)void this.serial(async()=>{if(this.pc!==pc)return;for(const sender of senders){try{pc.removeTrack(sender);}catch{}}await this.negotiate();}).catch(()=>{});
    this.change({callState:'idle',muted:false,localStream:undefined,remoteStream:undefined});
  }
  setMuted(muted:boolean):void{this.state.localStream?.getAudioTracks().forEach(track=>{track.enabled=!muted;});this.change({muted});}
  private dataSend(frame:DataFrame){const channel=this.channel;if(channel?.readyState!=='open'||(!this.channelReady()&&!['ready','ready-ack','text-ack','file-ack'].includes(frame.kind)))throw new Error('Peer data channel is not connected or application-ready');const text=JSON.stringify(frame);if(text.length>MAX_DATA_FRAME)throw new Error('Data frame exceeds limit');channel.send(text);}
  async sendText(text:string,metadata:{messageId?:string;conversationId?:string;metadata?:string;timestamp?:number}={}):Promise<void>{
    if(!text.trim()||text.length>MAX_TEXT_CHARS)throw new Error(`Text must contain 1–${MAX_TEXT_CHARS} characters`);
    if((this.channel?.bufferedAmount??0)>BUFFER_HIGH)throw new Error('Data channel busy; retry after transfer');
    const frame=dataFrameSchema.parse({kind:'text',id:metadata.messageId??this.id(),conversationId:metadata.conversationId,metadata:metadata.metadata,text,timestamp:metadata.timestamp??Date.now()});
    if(frame.kind!=='text')return;this.dataSend(frame);
    const message:ChatMessage={id:frame.id,text,conversationId:frame.conversationId,metadata:frame.metadata,from:'self',timestamp:frame.timestamp,status:'sent'};
    const old=this.state.messages.findIndex(x=>x.id===frame.id&&x.conversationId===frame.conversationId&&x.from==='self');
    if(old<0)this.state.messages=[...this.state.messages,message].slice(-100);else if(this.state.messages[old]?.status!=='delivered')this.state.messages[old]=message;
    await this.options.onMessage?.(message);this.emit();
  }
  async sendApplication(payload:unknown):Promise<void>{
    if((this.channel?.bufferedAmount??0)>BUFFER_HIGH)throw new Error('Data channel busy');
    const frame=dataFrameSchema.parse({kind:'application',id:this.id(),body:JSON.stringify(payload)});this.dataSend(frame);
  }
  /** Manager may retain the immutable completed bytes itself, then release this duplicate reference. */
  releaseFileData(fileId:string):void{const file=this.state.files.find(f=>f.id===fileId);if(file?.status==='complete')file.data=undefined;}
  private reserveFile(file:SharedFile){
    const duplicate=this.state.files.findIndex(x=>x.id===file.id);
    if(duplicate>=0){const existing=this.state.files[duplicate]!;if(existing.from!==file.from||!['complete','error'].includes(existing.status))throw new Error('Duplicate active file ID');this.state.files[duplicate]=file;this.emit();return;}
    while(this.state.files.length>=MAX_FILES){const index=this.state.files.findIndex(x=>x.status==='complete'||x.status==='error');if(index<0)throw new Error('File capacity exhausted');this.state.files.splice(index,1);}
    this.state.files.push(file);this.emit();
  }
  async sendFile(file:{name:string;mime:string;data:Uint8Array},metadata:{conversationId?:string;messageId?:string;metadata?:string}={}):Promise<void>{
    if(!(file.data instanceof Uint8Array)||file.data.length>MAX_FILE_BYTES)throw new Error('File exceeds 5 MiB limit');
    if(this.outgoing)throw new Error('One outgoing file at a time');
    const id=metadata.messageId??this.id();const start=dataFrameSchema.parse({kind:'file-start',id,conversationId:metadata.conversationId,metadata:metadata.metadata,name:file.name,mime:file.mime,size:file.data.length});
    if(!this.channelReady())throw new Error('Peer data channel is not connected or application-ready');
    this.reserveFile({id,name:file.name,mime:file.mime,size:file.data.length,from:'self',status:'sending',receivedBytes:0,conversationId:metadata.conversationId,metadata:metadata.metadata});
    let ackResolve!:()=>void;let ackReject!:(e:Error)=>void;
    const acknowledged=new Promise<void>((resolve,reject)=>{ackResolve=resolve;ackReject=reject;});
    // Handle rejection immediately while the producer is still draining the channel.
    void acknowledged.catch(()=>{});
    this.outgoing={id,ended:false,resolve:ackResolve,reject:ackReject,timer:setTimeout(()=>this.failOutgoing(new Error('File acknowledgement timed out')),REQUEST_TIMEOUT)};
    try{
      this.dataSend(start);
      for(let offset=0;offset<file.data.length;offset+=FILE_CHUNK_BYTES){await this.waitForBuffer(id);if(this.outgoing?.id!==id)throw new Error('Transfer cancelled');
        const chunk=file.data.subarray(offset,offset+FILE_CHUNK_BYTES);this.dataSend({kind:'file-chunk',id,offset,hex:bytesToHex(chunk)});
      }
      await this.waitForBuffer(id);if(this.outgoing?.id!==id)throw new Error('Transfer cancelled');this.outgoing.ended=true;this.dataSend({kind:'file-end',id});await acknowledged;
    }catch(error){if(this.outgoing?.id===id)this.failOutgoing(error instanceof Error?error:new Error('File transfer failed'));throw error;}
  }
  private async waitForBuffer(id:string){
    const start=Date.now();
    while((this.channel?.bufferedAmount??0)>BUFFER_HIGH){
      if(this.channel?.readyState!=='open'||this.outgoing?.id!==id)throw new Error('Transfer disconnected');
      if(Date.now()-start>REQUEST_TIMEOUT)throw new Error('Data channel backpressure timed out');
      await new Promise(resolve=>setTimeout(resolve,20));
    }
    if(this.channel?.readyState!=='open'||this.outgoing?.id!==id)throw new Error('Transfer disconnected');
  }
  private resetReceiveQueue(){
    ++this.receiveGeneration;this.receiveQueue=Promise.resolve();this.receiveFrames=0;this.receiveBytes=0;
  }
  private enqueueData(frame:DataFrame,size:number,channel:RTCDataChannel){
    if(this.receiveFrames>=MAX_RECEIVE_FRAMES||this.receiveBytes+size>MAX_RECEIVE_BYTES){this.failTransport('receive queue capacity exceeded');return;}
    const generation=this.receiveGeneration;
    const current=()=>generation===this.receiveGeneration&&this.channel===channel&&channel.readyState==='open';
    ++this.receiveFrames;this.receiveBytes+=size;
    const work=this.receiveQueue.then(async()=>{if(current())await this.handleData(frame,current);})
      .catch(error=>{if(current())this.report(error);})
      .finally(()=>{if(generation===this.receiveGeneration){--this.receiveFrames;this.receiveBytes-=size;}});
    this.receiveQueue=work;this.receiving.add(work);void work.then(()=>this.receiving.delete(work),()=>this.receiving.delete(work));
  }
  private async handleData(frame:DataFrame,current:()=>boolean=()=>true){
    if(frame.kind==='application'){
      await this.options.onApplication?.(JSON.parse(frame.body));
    }else if(frame.kind==='text-ack'){
      const message=this.state.messages.find(x=>x.id===frame.id&&x.conversationId===frame.conversationId&&x.from==='self');
      if(message){await this.options.onMessage?.({...message,status:'delivered'});if(!current())return;message.status='delivered';this.emit();}
    }else if(frame.kind==='text'){
      if(this.options.allowConversation?.(frame.conversationId)===false)return;
      const message:ChatMessage={id:frame.id,text:frame.text,conversationId:frame.conversationId,metadata:frame.metadata,from:'peer',timestamp:frame.timestamp,status:'received'};
      if(await this.options.onMessage?.(message)===false||!current())return;
      if(!this.state.messages.some(x=>x.id===frame.id&&x.conversationId===frame.conversationId&&x.from==='peer'))this.state.messages=[...this.state.messages,message].slice(-100);
      this.dataSend({kind:'text-ack',id:frame.id,conversationId:frame.conversationId});this.emit();
    }else if(frame.kind==='file-start'){
      if(this.options.allowConversation?.(frame.conversationId)===false)throw new Error('Unknown file conversation');
      if(this.incoming)throw new Error('One incoming file at a time');
      this.reserveFile({id:frame.id,name:frame.name,mime:frame.mime,size:frame.size,from:'peer',status:'receiving',receivedBytes:0,conversationId:frame.conversationId,metadata:frame.metadata});
      this.incoming={id:frame.id,bytes:new Uint8Array(frame.size),offset:0,timer:setTimeout(()=>this.failIncoming(),REQUEST_TIMEOUT)};
    }else if(frame.kind==='file-chunk'){
      const incoming=this.incoming;
      if(!incoming||incoming.id!==frame.id||incoming.offset!==frame.offset||incoming.offset+frame.hex.length/2>incoming.bytes.length){this.failIncoming();throw new Error('Invalid file chunk ordering or bounds');}
      const chunk=hexToBytes(frame.hex);incoming.bytes.set(chunk,incoming.offset);incoming.offset+=chunk.length;
      const file=this.state.files.find(x=>x.id===frame.id);if(file)file.receivedBytes=incoming.offset;this.emit();
    }else if(frame.kind==='file-end'){
      const incoming=this.incoming;if(!incoming||incoming.id!==frame.id||incoming.offset!==incoming.bytes.length){this.failIncoming();throw new Error('Incomplete file');}
      clearTimeout(incoming.timer);const file=this.state.files.find(x=>x.id===frame.id&&x.from==='peer');
      if(!file)throw new Error('Missing incoming file');
      try{
        const accepted=await this.options.onFile?.({...file,status:'complete',data:incoming.bytes});
        if(!current())return;
        if(accepted===false){this.failIncoming();return;}
        file.status='complete';file.data=incoming.bytes;this.incoming=undefined;this.dataSend({kind:'file-ack',id:frame.id});this.emit();
      }catch(error){if(current())this.failIncoming();throw error;}
    }else if(frame.kind==='file-ack'){
      const outgoing=this.outgoing;if(!outgoing||outgoing.id!==frame.id||!outgoing.ended)return;
      clearTimeout(outgoing.timer);this.outgoing=undefined;const file=this.state.files.find(x=>x.id===frame.id);if(file){file.status='complete';file.receivedBytes=file.size;}outgoing.resolve();this.emit();
    }
  }
  private failOutgoing(error:Error){const outgoing=this.outgoing;if(!outgoing)return;clearTimeout(outgoing.timer);this.outgoing=undefined;const file=this.state.files.find(x=>x.id===outgoing.id);if(file)file.status='error';outgoing.reject(error);this.emit();}
  private failIncoming(){if(!this.incoming)return;clearTimeout(this.incoming.timer);const file=this.state.files.find(x=>x.id===this.incoming!.id);if(file)file.status='error';this.incoming=undefined;this.emit();}
  private failTransfers(){this.failIncoming();this.failOutgoing(new Error('Transfer disconnected'));}
  /** Called only within the SDP/sender queue, with fresh transaction IDs and no live-cache mutations. */
  private async applyEncoderTarget(pc:RTCPeerConnection,sender:RTCRtpSender,track:MediaStreamTrack,callId:string|undefined,target:number|VideoTarget){
    const valid=()=>this.pc===pc&&this.callId===callId&&sender.track===track&&track.readyState!=='ended'&&pc.getSenders().includes(sender);
    if(!valid()||this.unsupportedEncoders.has(sender)||typeof sender.getParameters!=='function'||typeof sender.setParameters!=='function')return;
    const video=typeof target!=='number';
    const attempt=async(advanced:boolean,force=false)=>{
      if(!valid())return;
      // RN155 returns a cached class instance; JSON cloning also preserves its toJSON conversion.
      const parameters=JSON.parse(JSON.stringify(sender.getParameters())) as RTCRtpSendParameters;
      if(!parameters.encodings?.length)return;
      const bitrate=Math.max(1,Math.floor((video?target.maxBitrate:target)/parameters.encodings.length));
      const changed=parameters.encodings.some(encoding=>encoding.maxBitrate!==bitrate||(video&&(encoding.active!==target.active||(advanced&&(encoding.maxFramerate!==target.maxFramerate||encoding.scaleResolutionDownBy!==target.scaleResolutionDownBy)))));
      if(!changed&&!force)return;
      for(const encoding of parameters.encodings){encoding.maxBitrate=bitrate;if(video){encoding.active=target.active;if(advanced){encoding.maxFramerate=target.maxFramerate;encoding.scaleResolutionDownBy=target.scaleResolutionDownBy;}}}
      await sender.setParameters(parameters);
    };
    try{await attempt(video&&!this.videoBasicOnly.has(sender));}
    catch{
      if(video&&!this.videoBasicOnly.has(sender)&&valid()){
        this.videoBasicOnly.add(sender);
        try{await attempt(false,true);return;}catch{}
      }
      // Optional native API failure must never terminate media or displace GCC.
      this.unsupportedEncoders.add(sender);
    }
  }
  private async readStats(){
    const pc=this.pc;const statsCall=this.callId;if(!pc||this.statsBusy)return;this.statsBusy=true;
    try{
      const report=await pc.getStats();if(this.pc!==pc||this.callId!==statsCall)return;
      let pair:any;let outbound:any;let outboundVideo:any;let inbound:any;let remoteInbound:any;const remoteReports:any[]=[];
      report.forEach((value:any)=>{
        if(value.type==='transport'&&value.selectedCandidatePairId)pair=report.get(value.selectedCandidatePairId);
        if(!pair&&value.type==='candidate-pair'&&value.state==='succeeded'&&(value.nominated||value.selected))pair=value;
        if(value.type==='outbound-rtp'&&(value.kind??value.mediaType)==='audio'&&!value.isRemote)outbound=value;
        if(value.type==='outbound-rtp'&&(value.kind??value.mediaType)==='video'&&!value.isRemote)outboundVideo=value;
        if(value.type==='inbound-rtp'&&(value.kind??value.mediaType)==='audio'&&!value.isRemote)inbound=value;
        if(value.type==='remote-inbound-rtp')remoteReports.push(value);
      });
      remoteInbound=remoteReports.find(value=>value.localId===outbound?.id);
      const local=pair?report.get(pair.localCandidateId):undefined;const remote=pair?report.get(pair.remoteCandidateId):undefined;
      const route=pair?(local?.candidateType==='relay'||remote?.candidateType==='relay'?'relay':'direct'):'unknown';
      const rttMs=Number.isFinite(pair?.currentRoundTripTime)?pair.currentRoundTripTime*1000:undefined;
      let audioBitrateKbps:number|undefined;let lossRatio:number|undefined;
      if(outbound&&this.previousAudio&&outbound.timestamp>this.previousAudio.time){audioBitrateKbps=Math.max(0,(outbound.bytesSent-this.previousAudio.bytes)*8/(outbound.timestamp-this.previousAudio.time));}
      if(outbound)this.previousAudio={bytes:outbound.bytesSent,time:outbound.timestamp};
      if(remoteInbound){const lost=Math.max(0,remoteInbound.packetsLost??0);const received=outbound?.packetsSent??0;
        if(Number.isFinite(remoteInbound.fractionLost))lossRatio=Math.max(0,Math.min(1,remoteInbound.fractionLost));
        if(this.previousLoss){const dl=Math.max(0,lost-this.previousLoss.lost);const dr=Math.max(0,received-this.previousLoss.received);if(lossRatio===undefined&&dr>0)lossRatio=Math.min(1,dl/dr);}
        this.previousLoss={lost,received};
      }
      const previousPackets=this.previousVideoPackets;
      const videoAdvanced=outboundVideo&&Number.isFinite(outboundVideo.packetsSent)&&(!previousPackets||previousPackets.id!==outboundVideo.id||outboundVideo.packetsSent>previousPackets.sent);
      if(outboundVideo&&Number.isFinite(outboundVideo.packetsSent))this.previousVideoPackets={id:outboundVideo.id,sent:outboundVideo.packetsSent};
      // Paused video retains old RTCP loss/RTT indefinitely. Only new sent packets make it usable.
      const videoFeedback=videoAdvanced?remoteReports.find(value=>value.localId===outboundVideo.id):undefined;
      let videoLoss:number|undefined;
      if(videoFeedback){
        if(Number.isFinite(videoFeedback.fractionLost))videoLoss=Math.max(0,Math.min(1,videoFeedback.fractionLost));
        const lost=videoFeedback.packetsLost,sent=outboundVideo.packetsSent,previous=this.previousVideoLoss;
        if(Number.isFinite(lost)&&Number.isFinite(sent)){
          if(videoLoss===undefined&&previous&&previous.id===outboundVideo.id&&sent>previous.sent&&lost>=previous.lost)videoLoss=Math.min(1,(lost-previous.lost)/(sent-previous.sent));
          this.previousVideoLoss={id:outboundVideo.id,lost,sent};
        }
      }
      const videoRtt=Number.isFinite(videoFeedback?.roundTripTime)?videoFeedback.roundTripTime*1000:undefined;
      const videoTarget=this.videoPolicy.update({availableOutgoingBitrate:pair?.availableOutgoingBitrate,rttMs:rttMs===undefined?videoRtt:Math.max(rttMs,videoRtt??0),lossRatio:lossRatio===undefined?videoLoss:Math.max(lossRatio,videoLoss??0)},performance.now());
      this.change({route,stats:{rttMs,audioBitrateKbps,packetsLost:inbound?.packetsLost,jitterMs:inbound?.jitter!==undefined?inbound.jitter*1000:undefined}});
      for(const sender of pc.getSenders()){
        const track=sender.track;const callId=statsCall;if(!track||!['audio','video'].includes(track.kind))continue;
        const target=track.kind==='audio'?audioPolicy({rttMs,lossRatio}).maxBitrate:{...videoTarget,maxBitrate:videoTarget.maxBitrate/Math.max(1,pc.getSenders().filter(value=>value.track?.kind==='video').length)};
        try{await this.serial(()=>this.applyEncoderTarget(pc,sender,track,callId,target));}catch{/* Session may have ended while diagnostics were queued. */}
      }
    }catch{/* Stats are optional and must not break the call. */}finally{this.statsBusy=false;}
  }
  private cleanupPeer(){
    this.resetReady();this.remoteDataReady=false;this.localDataReady=false;
    clearTimeout(this.recoveryTimer);this.recoveryTimer=undefined;clearTimeout(this.resumeTimer);this.resumeTimer=undefined;this.hadConnected=false;this.restartPending=false;this.signalBacklog=[];this.state.recovering=false;
    this.resetReceiveQueue();
    clearTimeout(this.transportTimer);this.transportTimer=undefined;clearInterval(this.statsTimer);this.statsTimer=undefined;this.stopCall();this.failTransfers();
    const channel=this.channel;this.channel=undefined;if(channel){channel.onopen=null;channel.onclose=null;channel.onmessage=null;channel.onerror=null;try{channel.close();}catch{}}
    const pc=this.pc;this.pc=undefined;if(pc){pc.onicecandidate=null;pc.onnegotiationneeded=null;pc.ondatachannel=null;pc.ontrack=null;pc.onconnectionstatechange=null;pc.oniceconnectionstatechange=null;try{pc.close();}catch{}}
    this.pendingCandidates=[];this.offerAgain=false;this.previousAudio=undefined;this.previousLoss=undefined;this.change({route:'unknown',stats:{}});
  }
  /** Stop transport input immediately, then await callbacks already running. */
  async disconnectAndFlush():Promise<void>{
    const receive=[...this.receiving,this.receiveQueue];const signaling=this.queue;this.disconnect();
    await Promise.allSettled([...receive,signaling]);
  }
  disconnect():void{
    ++this.generation;this.openReject?.(new Error('Connection cancelled'));this.openReject=undefined;
    const socket=this.socket;this.socket=undefined;this.socketJoined=false;if(socket){socket.onopen=null;socket.onclose=null;socket.onmessage=null;socket.onerror=null;try{if(socket.readyState===1)socket.send(JSON.stringify({type:'leave'}));socket.close();}catch{}}
    this.cleanupPeer();this.remoteId=undefined;this.queue=Promise.resolve();this.change({status:'disconnected'});
  }
}
