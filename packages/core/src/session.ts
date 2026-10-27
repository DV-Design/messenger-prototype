import { endpointUrl } from './directory.js';
import { audioPolicy } from './audio.js';
import { bytesToHex, hexToBytes, randomChecked, secureRandomBytes, SignalingCipher, type RandomBytes } from './crypto.js';
import { dataFrameSchema, FILE_CHUNK_BYTES, MAX_FILE_BYTES, MAX_FILES, MAX_TEXT_CHARS, MAX_WIRE_BYTES, serverFrameSchema, type ClientFrame, type DataFrame, type SignalBody } from './protocol.js';

export interface ChatMessage {id:string;text:string;from:'self'|'peer';timestamp:number;conversationId?:string;status?:'sent'|'delivered'|'received';}
export interface SharedFile {id:string;name:string;mime:string;size:number;from:'self'|'peer';status:'sending'|'receiving'|'complete'|'error';receivedBytes:number;data?:Uint8Array;conversationId?:string;}
export interface SessionSnapshot {
  status:'idle'|'connecting'|'waiting'|'connected'|'disconnected'|'error';error?:string;
  messages:ChatMessage[];callState:'idle'|'outgoing'|'incoming'|'active';muted:boolean;
  localStream?:MediaStream;remoteStream?:MediaStream;route:'unknown'|'direct'|'relay';
  stats:{rttMs?:number;audioBitrateKbps?:number;packetsLost?:number;jitterMs?:number};files:SharedFile[];
}
export interface PeerSessionOptions {
  serverUrl:string;invite:string;relayOnly?:boolean;iceServers?:RTCIceServer[];
  randomBytes?:RandomBytes;rtcFactory?:(config:RTCConfiguration)=>RTCPeerConnection;
  getUserMedia?:(constraints:MediaStreamConstraints)=>Promise<MediaStream>;
  onChange?:(snapshot:SessionSnapshot)=>void;
  onMessage?:(message:ChatMessage)=>boolean|void;
  onApplication?:(payload:unknown)=>void;
  allowConversation?:(conversationId:string|undefined)=>boolean;
}
const initialSnapshot=():SessionSnapshot=>({status:'idle',messages:[],callState:'idle',muted:false,route:'unknown',stats:{},files:[]});
interface PendingTransfer {id:string;resolve:()=>void;reject:(e:Error)=>void;timer:ReturnType<typeof setTimeout>;ended:boolean;}
const MAX_DATA_FRAME=32*1024;
const BUFFER_HIGH=256*1024;
const BUFFER_LOW=64*1024;
const REQUEST_TIMEOUT=120000;
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
  private role:'initiator'|'responder'='initiator';
  private remoteId?:string;
  private generation=0;
  private queue:Promise<void>=Promise.resolve();
  private pendingCandidates:RTCIceCandidateInit[]=[];
  private offerAgain=false;
  private statsTimer?:ReturnType<typeof setInterval>;
  private statsBusy=false;
  private previousAudio?:{bytes:number;time:number};
  private previousLoss?:{lost:number;received:number};
  private callId?:string;
  private callVideo=false;
  private mediaPending=false;
  private callTimer?:ReturnType<typeof setTimeout>;
  private incoming?:{id:string;bytes:Uint8Array;offset:number;timer:ReturnType<typeof setTimeout>};
  private outgoing?:PendingTransfer;
  private openReject?: (error:Error)=>void;
  constructor(options:PeerSessionOptions) {
    const base=new URL(options.serverUrl);
    if(!['http:','https:'].includes(base.protocol)||base.username||base.password||base.search||base.hash) throw new Error('serverUrl must be an http(s) base URL without credentials, query or fragment');
    this.options=options;this.random=options.randomBytes??secureRandomBytes;
    this.peerId=this.id();this.cipher=new SignalingCipher(options.invite,this.peerId,this.random);this.roomId=this.cipher.roomId;
  }
  private id(){return bytesToHex(randomChecked(this.random,16));}
  getSnapshot():SessionSnapshot {
    return {...this.state,messages:this.state.messages.map(x=>({...x})),files:this.state.files.map(x=>({...x})),stats:{...this.state.stats}};
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
  private signal(body:SignalBody){if(!this.remoteId)throw new Error('Remote peer identity unavailable');this.wsSend({type:'signal',payload:this.cipher.seal(body,this.remoteId)});}
  async connect():Promise<void> {
    if(['connecting','waiting','connected'].includes(this.state.status))return;
    this.disconnect();const generation=this.generation;
    this.change({status:'connecting',error:undefined});
    try {
      let iceServers=this.options.iceServers;
      if(!iceServers){const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),10000);
        try {const response=await fetch(endpointUrl(this.options.serverUrl,'ice'),{signal:controller.signal});if(!response.ok)throw new Error('ICE configuration request failed');
          const value=await response.json() as {iceServers?:RTCIceServer[]};
          if(!Array.isArray(value.iceServers)||value.iceServers.length>20)throw new Error('Invalid ICE configuration');iceServers=value.iceServers;
        } finally {clearTimeout(timer);}
      }
      const hasTurn=iceServers.some(server=>(Array.isArray(server.urls)?server.urls:[server.urls]).some(url=>/^turns?:/i.test(url)));
      if(this.options.relayOnly&&!hasTurn)throw new Error('Relay-only mode requires a configured TURN server');
      if(generation!==this.generation)throw new Error('Connection cancelled');
      const url=endpointUrl(this.options.serverUrl,'signal');url.protocol=url.protocol==='https:'?'wss:':'ws:';
      const socket=new WebSocket(url.toString());this.socket=socket;
      await new Promise<void>((resolve,reject)=>{
        let joined=false;const timeout=setTimeout(()=>fail(new Error('Signaling join timed out')),10000);
        const fail=(error:Error)=>{clearTimeout(timeout);this.openReject=undefined;reject(error);};
        this.openReject=fail;
        socket.onopen=()=>{if(this.socket===socket)this.wsSend({type:'join',roomId:this.roomId,peerId:this.peerId});};
        socket.onmessage=event=>{
          if(this.socket!==socket)return;
          try {
            if(typeof event.data!=='string'||event.data.length>MAX_WIRE_BYTES)throw new Error('Invalid signaling frame');
            const frame=serverFrameSchema.parse(JSON.parse(event.data));
            if(frame.type==='error'){const error=new Error(`${frame.code}: ${frame.message}`);if(!joined)fail(error);else this.report(error);return;}
            if(frame.type==='joined'){
              if(joined||frame.roomId!==this.roomId||frame.peerId!==this.peerId)throw new Error('Invalid room acknowledgement');
              joined=true;clearTimeout(timeout);this.openReject=undefined;this.role=frame.role;
              this.makePeer(iceServers!);this.change({status:'waiting'});resolve();return;
            }
            if(!joined)throw new Error('Signal before room acknowledgement');
            if(frame.type==='peer-joined'){
              if(frame.peerId===this.peerId)throw new Error('Invalid peer identity');this.remoteId=frame.peerId;
              void this.serial(()=>this.negotiate()).catch(()=>{});
            }else if(frame.type==='peer-left'){
              if(this.remoteId&&frame.peerId!==this.remoteId)return;
              this.cleanupPeer();this.remoteId=undefined;this.makePeer(iceServers!);this.change({status:'waiting'});
            }else if(frame.type==='signal'){
              if(this.remoteId&&frame.from!==this.remoteId)throw new Error('Unexpected peer identity');
              const body=this.cipher.open(frame.from,frame.payload);this.remoteId=frame.from;
              void this.serial(()=>this.handleSignal(body)).catch(()=>{});
            }
          }catch(error){if(!joined)fail(error instanceof Error?error:new Error('Invalid signaling'));else this.report(new Error('Rejected invalid or unauthenticated signaling'));}
        };
        socket.onerror=()=>{if(!joined)fail(new Error('WebSocket connection failed'));else this.report(new Error('WebSocket transport error'));};
        socket.onclose=()=>{if(this.socket!==socket)return;if(!joined)fail(new Error('Signaling disconnected'));this.socket=undefined;this.cleanupPeer();this.change({status:'disconnected'});};
      });
    }catch(error){if(generation===this.generation){this.disconnect();this.change({status:'error',error:error instanceof Error?error.message:'Connection failed'});}throw error;}
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
      if(pc.connectionState==='failed'){this.stopCall();this.change({status:'error',error:'Peer connection failed; reconnect to retry'});}
      else if(pc.connectionState==='disconnected')this.change({status:'disconnected'});
      else if(pc.connectionState==='connected'&&this.channel?.readyState==='open')this.change({status:'connected',error:undefined});
    };
    if(this.role==='initiator')this.attachChannel(pc.createDataChannel('messenger-v1',{ordered:true}));
    this.statsTimer=setInterval(()=>{void this.readStats();},2000);
  }
  private attachChannel(channel:RTCDataChannel){
    if(this.channel&&this.channel!==channel){channel.close();return;}this.channel=channel;channel.bufferedAmountLowThreshold=BUFFER_LOW;
    channel.onopen=()=>{if(this.channel===channel)this.change({status:'connected',error:undefined});};
    channel.onclose=()=>{if(this.channel===channel){this.failTransfers();this.stopCall();this.change({status:'disconnected'});}};
    channel.onerror=()=>this.report(new Error('Data channel error'));
    channel.onmessage=event=>{if(this.channel!==channel)return;try{if(typeof event.data!=='string'||event.data.length>MAX_DATA_FRAME)throw new Error('Oversized data frame');this.handleData(dataFrameSchema.parse(JSON.parse(event.data)));}catch(e){this.report(e);}};
  }
  private async negotiate(){
    if(this.state.callState==='outgoing'||this.state.callState==='incoming')return;
    if(this.role==='initiator')await this.offer();else if(this.remoteId)this.signal({kind:'renegotiate'});
  }
  private async offer(){
    const pc=this.pc;if(!pc||!this.remoteId||this.role!=='initiator'||this.state.callState==='outgoing'||this.state.callState==='incoming')return;
    if(pc.signalingState!=='stable'){this.offerAgain=true;return;}
    this.offerAgain=false;const offer=await pc.createOffer();if(this.pc!==pc)return;
    await pc.setLocalDescription(offer);if(this.pc!==pc)return;
    this.signal({kind:'description',description:{type:'offer',sdp:pc.localDescription?.sdp??offer.sdp??''}});
  }
  private async handleSignal(body:SignalBody){
    const pc=this.pc;if(!pc)return;
    if(body.kind==='description'){
      if(body.description.type==='offer'&&this.role!=='responder')throw new Error('Unexpected SDP offer');
      if(body.description.type==='answer'&&pc.signalingState!=='have-local-offer')throw new Error('Unexpected SDP answer');
      await pc.setRemoteDescription(body.description);if(this.pc!==pc)return;
      for(const candidate of this.pendingCandidates.splice(0))await pc.addIceCandidate(candidate);
      if(body.description.type==='offer'){const answer=await pc.createAnswer();if(this.pc!==pc)return;await pc.setLocalDescription(answer);if(this.pc!==pc)return;this.signal({kind:'description',description:{type:'answer',sdp:pc.localDescription?.sdp??answer.sdp??''}});}
      else if(this.offerAgain)await this.offer();
    }else if(body.kind==='candidate'){
      if(pc.remoteDescription)await pc.addIceCandidate(body.candidate);else {if(this.pendingCandidates.length>=128)throw new Error('Too many queued ICE candidates');this.pendingCandidates.push(body.candidate);}
    }else if(body.kind==='renegotiate'){await this.offer();
    }else if(body.kind==='call-invite'){
      if(this.state.callState!=='idle'){this.signal({kind:'call-end',callId:body.callId});return;}
      this.callId=body.callId;this.callVideo=body.video;this.change({callState:'incoming'});this.armCallTimeout();
    }else if(body.kind==='call-accept'){
      if(this.callId!==body.callId||this.state.callState!=='outgoing')return;
      clearTimeout(this.callTimer);this.change({callState:'active'});await this.negotiate();
    }else if(body.kind==='call-end'&&body.callId===this.callId){this.stopCall();await this.negotiate();}
  }
  private armCallTimeout(){clearTimeout(this.callTimer);this.callTimer=setTimeout(()=>this.endCall(),45000);}
  private async acquireMedia(video:boolean){
    const pc=this.pc;if(!pc)throw new Error('No peer connection');
    const media=this.options.getUserMedia??(constraints=>navigator.mediaDevices.getUserMedia(constraints));
    const generation=this.generation;const callId=this.callId;
    if(this.mediaPending)throw new Error('Media permission request is already pending');
    this.mediaPending=true;let stream:MediaStream;
    try{stream=await media({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true},video});}finally{this.mediaPending=false;}
    if(this.pc!==pc||generation!==this.generation||!callId||this.callId!==callId){stream.getTracks().forEach(track=>track.stop());throw new Error('Call cancelled');}
    try{await this.serial(async()=>{if(this.pc!==pc||this.callId!==callId)throw new Error('Call cancelled');for(const track of stream.getTracks())pc.addTrack(track,stream);this.change({localStream:stream,muted:false});});}catch(error){stream.getTracks().forEach(track=>track.stop());throw error;}
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
    this.state.localStream?.getTracks().forEach(track=>track.stop());
    // Receiver tracks belong to the reusable peer connection. Stopping them here
    // would permanently end a transceiver reused by the next call. Hide the stream;
    // local sender tracks are stopped above and pc.close() releases receivers.
    const pc=this.pc;const senders=pc?.getSenders().filter(sender=>sender.track);
    if(pc&&senders?.length)void this.serial(async()=>{if(this.pc!==pc)return;for(const sender of senders){try{pc.removeTrack(sender);}catch{}}await this.negotiate();}).catch(()=>{});
    this.change({callState:'idle',muted:false,localStream:undefined,remoteStream:undefined});
  }
  setMuted(muted:boolean):void{this.state.localStream?.getAudioTracks().forEach(track=>{track.enabled=!muted;});this.change({muted});}
  private dataSend(frame:DataFrame){const channel=this.channel;if(channel?.readyState!=='open')throw new Error('Peer data channel is not connected');const text=JSON.stringify(frame);if(text.length>MAX_DATA_FRAME)throw new Error('Data frame exceeds limit');channel.send(text);}
  async sendText(text:string,metadata:{messageId?:string;conversationId?:string}={}):Promise<void>{
    if(!text.trim()||text.length>MAX_TEXT_CHARS)throw new Error(`Text must contain 1–${MAX_TEXT_CHARS} characters`);
    if((this.channel?.bufferedAmount??0)>BUFFER_HIGH)throw new Error('Data channel busy; retry after transfer');
    const frame=dataFrameSchema.parse({kind:'text',id:metadata.messageId??this.id(),conversationId:metadata.conversationId,text,timestamp:Date.now()});
    if(frame.kind!=='text')return;this.dataSend(frame);
    const message:ChatMessage={id:frame.id,text,conversationId:frame.conversationId,from:'self',timestamp:frame.timestamp,status:'sent'};
    const old=this.state.messages.findIndex(x=>x.id===frame.id&&x.conversationId===frame.conversationId&&x.from==='self');
    if(old<0)this.state.messages=[...this.state.messages,message].slice(-100);else if(this.state.messages[old]?.status!=='delivered')this.state.messages[old]=message;
    this.options.onMessage?.(message);this.emit();
  }
  async sendApplication(payload:unknown):Promise<void>{
    if((this.channel?.bufferedAmount??0)>BUFFER_HIGH)throw new Error('Data channel busy');
    const frame=dataFrameSchema.parse({kind:'application',id:this.id(),body:JSON.stringify(payload)});this.dataSend(frame);
  }
  /** Manager may retain the immutable completed bytes itself, then release this duplicate reference. */
  releaseFileData(fileId:string):void{const file=this.state.files.find(f=>f.id===fileId);if(file?.status==='complete')file.data=undefined;}
  private reserveFile(file:SharedFile){
    if(this.state.files.some(x=>x.id===file.id))throw new Error('Duplicate file ID');
    while(this.state.files.length>=MAX_FILES){const index=this.state.files.findIndex(x=>x.status==='complete'||x.status==='error');if(index<0)throw new Error('File capacity exhausted');this.state.files.splice(index,1);}
    this.state.files.push(file);this.emit();
  }
  async sendFile(file:{name:string;mime:string;data:Uint8Array},metadata:{conversationId?:string;messageId?:string}={}):Promise<void>{
    if(!(file.data instanceof Uint8Array)||file.data.length>MAX_FILE_BYTES)throw new Error('File exceeds 5 MiB limit');
    if(this.outgoing)throw new Error('One outgoing file at a time');
    const id=metadata.messageId??this.id();const start=dataFrameSchema.parse({kind:'file-start',id,conversationId:metadata.conversationId,name:file.name,mime:file.mime,size:file.data.length});
    if(this.channel?.readyState!=='open')throw new Error('Peer data channel is not connected');
    this.reserveFile({id,name:file.name,mime:file.mime,size:file.data.length,from:'self',status:'sending',receivedBytes:0,conversationId:metadata.conversationId});
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
  private handleData(frame:DataFrame){
    if(frame.kind==='application'){
      this.options.onApplication?.(JSON.parse(frame.body));
    }else if(frame.kind==='text-ack'){
      const message=this.state.messages.find(x=>x.id===frame.id&&x.conversationId===frame.conversationId&&x.from==='self');
      if(message){message.status='delivered';this.options.onMessage?.({...message});this.emit();}
    }else if(frame.kind==='text'){
      if(this.options.allowConversation?.(frame.conversationId)===false)return;
      const message:ChatMessage={id:frame.id,text:frame.text,conversationId:frame.conversationId,from:'peer',timestamp:frame.timestamp,status:'received'};
      if(this.options.onMessage?.(message)===false)return;
      if(!this.state.messages.some(x=>x.id===frame.id&&x.conversationId===frame.conversationId&&x.from==='peer'))this.state.messages=[...this.state.messages,message].slice(-100);
      this.dataSend({kind:'text-ack',id:frame.id,conversationId:frame.conversationId});this.emit();
    }else if(frame.kind==='file-start'){
      if(this.options.allowConversation?.(frame.conversationId)===false)throw new Error('Unknown file conversation');
      if(this.incoming)throw new Error('One incoming file at a time');
      this.reserveFile({id:frame.id,name:frame.name,mime:frame.mime,size:frame.size,from:'peer',status:'receiving',receivedBytes:0,conversationId:frame.conversationId});
      this.incoming={id:frame.id,bytes:new Uint8Array(frame.size),offset:0,timer:setTimeout(()=>this.failIncoming(),REQUEST_TIMEOUT)};
    }else if(frame.kind==='file-chunk'){
      const incoming=this.incoming;
      if(!incoming||incoming.id!==frame.id||incoming.offset!==frame.offset||incoming.offset+frame.hex.length/2>incoming.bytes.length){this.failIncoming();throw new Error('Invalid file chunk ordering or bounds');}
      const chunk=hexToBytes(frame.hex);incoming.bytes.set(chunk,incoming.offset);incoming.offset+=chunk.length;
      const file=this.state.files.find(x=>x.id===frame.id);if(file)file.receivedBytes=incoming.offset;this.emit();
    }else if(frame.kind==='file-end'){
      const incoming=this.incoming;if(!incoming||incoming.id!==frame.id||incoming.offset!==incoming.bytes.length){this.failIncoming();throw new Error('Incomplete file');}
      clearTimeout(incoming.timer);const file=this.state.files.find(x=>x.id===frame.id);if(file){file.status='complete';file.data=incoming.bytes;}this.incoming=undefined;this.dataSend({kind:'file-ack',id:frame.id});this.emit();
    }else if(frame.kind==='file-ack'){
      const outgoing=this.outgoing;if(!outgoing||outgoing.id!==frame.id||!outgoing.ended)return;
      clearTimeout(outgoing.timer);this.outgoing=undefined;const file=this.state.files.find(x=>x.id===frame.id);if(file){file.status='complete';file.receivedBytes=file.size;}outgoing.resolve();this.emit();
    }
  }
  private failOutgoing(error:Error){const outgoing=this.outgoing;if(!outgoing)return;clearTimeout(outgoing.timer);this.outgoing=undefined;const file=this.state.files.find(x=>x.id===outgoing.id);if(file)file.status='error';outgoing.reject(error);this.emit();}
  private failIncoming(){if(!this.incoming)return;clearTimeout(this.incoming.timer);const file=this.state.files.find(x=>x.id===this.incoming!.id);if(file)file.status='error';this.incoming=undefined;this.emit();}
  private failTransfers(){this.failIncoming();this.failOutgoing(new Error('Transfer disconnected'));}
  private async readStats(){
    const pc=this.pc;if(!pc||this.statsBusy)return;this.statsBusy=true;
    try{
      const report=await pc.getStats();if(this.pc!==pc)return;
      let pair:any;let outbound:any;let inbound:any;let remoteInbound:any;const remoteReports:any[]=[];
      report.forEach((value:any)=>{
        if(value.type==='transport'&&value.selectedCandidatePairId)pair=report.get(value.selectedCandidatePairId);
        if(!pair&&value.type==='candidate-pair'&&value.state==='succeeded'&&(value.nominated||value.selected))pair=value;
        if(value.type==='outbound-rtp'&&(value.kind??value.mediaType)==='audio'&&!value.isRemote)outbound=value;
        if(value.type==='inbound-rtp'&&(value.kind??value.mediaType)==='audio'&&!value.isRemote)inbound=value;
        if(value.type==='remote-inbound-rtp'&&(value.kind??value.mediaType)==='audio')remoteReports.push(value);
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
      this.change({route,stats:{rttMs,audioBitrateKbps,packetsLost:inbound?.packetsLost,jitterMs:inbound?.jitter!==undefined?inbound.jitter*1000:undefined}});
      for(const sender of pc.getSenders()){
        if(sender.track?.kind!=='audio'||typeof sender.setParameters!=='function')continue;
        const parameters=sender.getParameters();if(!parameters.encodings?.length)continue;
        const target=audioPolicy({rttMs,lossRatio}).maxBitrate;
        if(parameters.encodings.every(encoding=>encoding.maxBitrate===target))continue;
        parameters.encodings.forEach(encoding=>{encoding.maxBitrate=target;});
        try{await this.serial(async()=>{if(this.pc===pc&&sender.track?.readyState!=='ended')await sender.setParameters(parameters);});}catch{/* Optional API unsupported on some RN/OS stacks; preserve native controller. */}
      }
    }catch{/* Stats are optional and must not break the call. */}finally{this.statsBusy=false;}
  }
  private cleanupPeer(){
    clearInterval(this.statsTimer);this.statsTimer=undefined;this.stopCall();this.failTransfers();
    const channel=this.channel;this.channel=undefined;if(channel){channel.onopen=null;channel.onclose=null;channel.onmessage=null;channel.onerror=null;try{channel.close();}catch{}}
    const pc=this.pc;this.pc=undefined;if(pc){pc.onicecandidate=null;pc.onnegotiationneeded=null;pc.ondatachannel=null;pc.ontrack=null;pc.onconnectionstatechange=null;try{pc.close();}catch{}}
    this.pendingCandidates=[];this.offerAgain=false;this.previousAudio=undefined;this.previousLoss=undefined;this.change({route:'unknown',stats:{}});
  }
  disconnect():void{
    ++this.generation;this.openReject?.(new Error('Connection cancelled'));this.openReject=undefined;
    const socket=this.socket;this.socket=undefined;if(socket){socket.onopen=null;socket.onclose=null;socket.onmessage=null;socket.onerror=null;try{if(socket.readyState===1)socket.send(JSON.stringify({type:'leave'}));socket.close();}catch{}}
    this.cleanupPeer();this.remoteId=undefined;this.queue=Promise.resolve();this.change({status:'disconnected'});
  }
}
