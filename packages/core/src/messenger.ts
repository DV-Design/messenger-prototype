import { normalizePhone, iceServersSchema, type ServiceCapabilities, type PhoneChallenge } from './services.js';
import { z } from 'zod';
import { bytesToHex, randomChecked, secureRandomBytes, type RandomBytes } from './crypto.js';
import { directoryClientFrameSchema, directoryServerFrameSchema, directoryUserSchema, directConversationId, conversationInvite, endpointUrl, signAuthentication, usernameSchema, displayNameSchema, validateDeviceIdentity, type DeviceIdentity, type DirectoryUser, type DirectoryClientFrame, type DirectoryServerFrame, type PhoneMatch, type DirectoryPage, type WakeKind } from './directory.js';
import { conversationIdSchema, MAX_FILE_BYTES, MAX_TEXT_CHARS, peerIdSchema, roomIdSchema } from './protocol.js';
import { openAttachment, sealAttachment, openLocalState, sealLocalState } from './persistence.js';
import { PeerSession, type PeerSessionOptions, type SessionSnapshot, type SharedFile, type ChatMessage } from './session.js';
import {OUTBOX_TTL_MS,groupDefinitionSchema,signGroupDefinition,verifyGroupDefinition,signGroupOrigin,parseGroupOrigin,contentHash,receiptSchema,signGroupReceipt,verifyGroupReceipt,attachmentKey,type GroupDefinition,type GroupOrigin,type GroupReceipt} from './group-sync.js';
export {OUTBOX_TTL_MS} from './group-sync.js';
export interface MessengerMessage {id:string;text:string;from:string;timestamp:number;status:'pending'|'sent'|'delivered'|'received'|'expired';conversationId:string;expiresAt?:number;metadata?:string;recipientIds?:string[];deliveredTo?:string[];}
export interface MessengerFile extends SharedFile {timestamp:number;senderId:string;conversationId:string;deliveryStatus?:'pending'|'sent'|'delivered'|'received'|'expired';expiresAt?:number;blobKey?:string;recipientIds?:string[];deliveredTo?:string[];}
export interface Conversation {id:string;kind:'direct'|'group';title:string;memberIds:string[];messages:MessengerMessage[];files:MessengerFile[];unread:number;updatedAt:number;session?:SessionSnapshot;}
export interface MessengerSnapshot {status:'idle'|'connecting'|'online'|'offline'|'error';self?:DirectoryUser;contacts:DirectoryUser[];conversations:Conversation[];activeCall?:{conversationId:string;peerId:string;session:SessionSnapshot};error?:string;}
export interface MessengerOptions {serverUrl:string;identity:DeviceIdentity;username:string;displayName:string;randomBytes?:RandomBytes;rtcFactory?:PeerSessionOptions['rtcFactory'];getUserMedia?:PeerSessionOptions['getUserMedia'];onChange?:(snapshot:MessengerSnapshot)=>void;loadState?:()=>Promise<string|null>;saveState?:(sealed:string)=>Promise<void>;saveAttachment?:(key:string,sealed:string)=>Promise<void>;loadAttachment?:(key:string)=>Promise<string|null>;deleteAttachment?:(key:string)=>Promise<void>;}
export const MAX_CONTACTS=100;
export const MAX_GROUPS=32;
export const MAX_HISTORY_MESSAGES=500;
export const MAX_PENDING_MESSAGES=100;
const MAX_SESSIONS=16;
const MAX_DIRECTORY_FRAME=128*1024;
export const MAX_PENDING_FILES=16;
export const MAX_STORED_FILE_BYTES=40*1024*1024;
const messageSchema=z.object({id:peerIdSchema,text:z.string().min(1).max(MAX_TEXT_CHARS),from:roomIdSchema,timestamp:z.number().finite().nonnegative(),status:z.enum(['pending','sent','delivered','received','expired']),conversationId:conversationIdSchema,expiresAt:z.number().finite().nonnegative().optional(),metadata:z.string().max(12000).optional(),recipientIds:z.array(roomIdSchema).max(7).optional(),deliveredTo:z.array(roomIdSchema).max(7).optional()}).strict();
const fileSchema=z.object({id:peerIdSchema,name:z.string().min(1).max(255),mime:z.string().max(255),size:z.number().int().min(0).max(MAX_FILE_BYTES),timestamp:z.number().finite().nonnegative(),from:z.enum(['self','peer']),status:z.enum(['sending','receiving','complete','error']),receivedBytes:z.number().nonnegative(),senderId:roomIdSchema,conversationId:conversationIdSchema,metadata:z.string().max(12000).optional(),expiresAt:z.number().finite().nonnegative().optional(),deliveryStatus:z.enum(['pending','sent','delivered','received','expired']).optional(),blobKey:roomIdSchema.optional(),recipientIds:z.array(roomIdSchema).max(7).optional(),deliveredTo:z.array(roomIdSchema).max(7).optional()}).strict();
interface InternalConversation extends Conversation {creatorId?:string;definition?:GroupDefinition;receipts?:GroupReceipt[];}
interface PendingOperation {controller:AbortController;started:number;timeout:number;timer?:ReturnType<typeof setTimeout>;conversationId:string;peerId?:string;}
interface PendingMessage {conversationId:string;messageId:string;remaining:string[];type?:'message'|'file';author?:string;createdAt?:number;expiresAt?:number;}
const pendingSchema=z.object({conversationId:conversationIdSchema,messageId:peerIdSchema,remaining:z.array(roomIdSchema).min(1).max(7),type:z.enum(['message','file']).optional(),author:roomIdSchema.optional(),createdAt:z.number().finite().nonnegative().optional(),expiresAt:z.number().finite().nonnegative().optional()}).strict();
const storedConversationSchema=z.object({id:conversationIdSchema,kind:z.enum(['direct','group']),title:z.string().min(1).max(64),memberIds:z.array(roomIdSchema).min(2).max(8),creatorId:roomIdSchema.optional(),definition:groupDefinitionSchema.optional(),receipts:z.array(receiptSchema).max(4000).optional(),messages:z.array(messageSchema).max(100),files:z.array(fileSchema).max(64).optional(),unread:z.number().int().min(0).max(100),updatedAt:z.number().finite().nonnegative()}).strict();
const storedSchema=z.object({version:z.union([z.literal(2),z.literal(3)]),contacts:z.array(directoryUserSchema).max(MAX_CONTACTS),conversations:z.array(storedConversationSchema).max(MAX_CONTACTS+MAX_GROUPS),pending:z.array(pendingSchema).max(MAX_PENDING_MESSAGES+MAX_PENDING_FILES)}).strict().refine(state=>state.conversations.reduce((n,c)=>n+c.messages.length,0)<=MAX_HISTORY_MESSAGES,{message:'History capacity exceeded'});
type RequestInput<T=DirectoryClientFrame>=T extends {requestId:string}?Omit<T,'requestId'>:never;
type ReplyType=Exclude<Extract<DirectoryServerFrame,{requestId:string}>['type'],'error'>;
interface Request {expected:ReplyType;resolve:(frame:DirectoryServerFrame)=>void;reject:(e:Error)=>void;timer:ReturnType<typeof setTimeout>;}
interface Pair {session:PeerSession;connecting?:Promise<void>;retry?:ReturnType<typeof setTimeout>;attempt:number;flushing:boolean;notified:boolean;lastUsed:number;lastSent:Map<string,number>;definitions:Set<string>;pump?:ReturnType<typeof setTimeout>;}
export class MessengerClient {
  private status:MessengerSnapshot['status']='idle';private self?:DirectoryUser;private error?:string;
  private contacts=new Map<string,DirectoryUser>();private conversations=new Map<string,InternalConversation>();private pending:PendingMessage[]=[];
  private closing=false;private closed=false;private shutdown?:Promise<void>;private activeWork=new Set<Promise<unknown>>();
  private protectedReceive=new Set<string>();private committed=new Set<string>();private blobs=new Map<string,Uint8Array>();private enqueueQueue=Promise.resolve();private expiryTimer?:ReturnType<typeof setTimeout>;private pairs=new Map<string,Pair>();private socket?:WebSocket;private requests=new Map<string,Request>();private iceRequest?:Promise<RTCIceServer[]>;private wakeTimer?:ReturnType<typeof setTimeout>;private lastWake=new Map<string,number>();private wakeStarted=new Map<string,number>();private pendingCall?:PendingOperation;private services?:ServiceCapabilities;private servicesRequest?:Promise<ServiceCapabilities>;private wakeCapabilitiesRequest?:Promise<ServiceCapabilities>;
  private random:RandomBytes;private stopped=true;private opening?:Promise<void>;private loaded=false;private restorePromise?:Promise<void>;
  private reconnect?:ReturnType<typeof setTimeout>;private attempt=0;private epoch=0;private savedTimer?:ReturnType<typeof setTimeout>;private saveQueue=Promise.resolve();private dirty=false;private cancelOpening?:()=>void;
  constructor(private options:MessengerOptions){validateDeviceIdentity(options.identity);usernameSchema.parse(options.username);displayNameSchema.parse(options.displayName);endpointUrl(options.serverUrl,'directory');this.random=options.randomBytes??secureRandomBytes;}
  private id(){return bytesToHex(randomChecked(this.random,16));}
  getSnapshot():MessengerSnapshot {
    const conversations=[...this.conversations.values()].map(c=>({id:c.id,kind:c.kind,title:c.title,memberIds:[...c.memberIds],messages:c.messages.map(m=>({...m,recipientIds:m.recipientIds?[...m.recipientIds]:undefined,deliveredTo:m.deliveredTo?[...m.deliveredTo]:undefined})),files:c.files.map(f=>({...f,recipientIds:f.recipientIds?[...f.recipientIds]:undefined,deliveredTo:f.deliveredTo?[...f.deliveredTo]:undefined})),unread:c.unread,updatedAt:c.updatedAt,session:c.kind==='direct'?this.pairs.get(c.memberIds.find(id=>id!==this.options.identity.userId)!)?.session.getSnapshot():undefined}));
    let activeCall:MessengerSnapshot['activeCall'];
    for(const [peerId,pair] of this.pairs){const session=pair.session.getSnapshot();if(session.callState!=='idle'){activeCall={conversationId:directConversationId(this.options.identity.userId,peerId),peerId,session};break;}}
    if(!activeCall&&this.pendingCall){const op=this.pendingCall;const snapshot=this.pairs.get(op.peerId!)?.session.getSnapshot();activeCall={conversationId:op.conversationId,peerId:op.peerId!,session:{status:'connecting',messages:[],muted:false,route:'unknown',stats:{},files:[],...snapshot,callState:'outgoing'}};}
    return {status:this.status,self:this.self?{...this.self}:undefined,contacts:[...this.contacts.values()].map(c=>({...c})),conversations:conversations.sort((a,b)=>b.updatedAt-a.updatedAt),activeCall,error:this.error};
  }
  private emit(){this.options.onChange?.(this.getSnapshot());}
  private report(error:unknown){this.error=error instanceof Error?error.message:'Messenger operation failed';this.emit();}
  private changed(){if(this.closed)return;this.trimHistory();this.dirty=true;this.scheduleSave();this.emit();}
  private scheduleSave(){if(this.closing||!this.options.saveState||this.savedTimer)return;this.savedTimer=setTimeout(()=>{this.savedTimer=undefined;void this.persist().catch(error=>this.report(error));},250);}
  private stored(){return {version:3,contacts:[...this.contacts.values()].map(c=>({...c,online:false})),conversations:[...this.conversations.values()].map(c=>({id:c.id,kind:c.kind,title:c.title,memberIds:c.memberIds,creatorId:c.creatorId,definition:c.definition,receipts:c.receipts,messages:c.messages,files:c.files.map(({data:_data,...f})=>f),unread:c.unread,updatedAt:c.updatedAt})),pending:this.pending};}
  private async persist():Promise<void>{
    if(!this.dirty||!this.options.saveState)return this.saveQueue;this.dirty=false;
    const state=storedSchema.parse(this.stored());const sealed=sealLocalState(this.options.identity,state,this.random);
    this.saveQueue=this.saveQueue.catch(()=>{}).then(()=>this.options.saveState!(sealed)).catch(error=>{this.dirty=true;this.report(new Error('Local encrypted state could not be saved'));throw error;});return this.saveQueue;
  }
  private async restore(){
    if(this.loaded)return;if(this.restorePromise)return this.restorePromise;
    this.restorePromise=(async()=>{
      const sealed=await this.options.loadState?.();if(!sealed){this.loaded=true;return;}
      const state=storedSchema.parse(openLocalState(this.options.identity,sealed));const own=this.options.identity.userId;
      const contacts=new Map<string,DirectoryUser>();for(const c of state.contacts){if(c.userId===own||contacts.has(c.userId))throw new Error('Invalid stored contacts');contacts.set(c.userId,{...c,online:false});}
      const conversations=new Map<string,InternalConversation>();
      for(const c of state.conversations){
        if(conversations.has(c.id)||new Set(c.memberIds).size!==c.memberIds.length||!c.memberIds.includes(own)||c.memberIds.some(id=>id!==own&&!contacts.has(id)))throw new Error('Invalid stored membership');
        if(c.kind==='direct'&&(c.memberIds.length!==2||c.id!==directConversationId(c.memberIds[0]!,c.memberIds[1]!)))throw new Error('Invalid direct conversation');
        if(c.kind==='group'&&(!c.id.startsWith('group:')||!c.creatorId||!c.memberIds.includes(c.creatorId)))throw new Error('Invalid stored group');
        if(c.messages.some(m=>m.conversationId!==c.id||!c.memberIds.includes(m.from)))throw new Error('Invalid stored sender');
        conversations.set(c.id,{...c,files:(c.files??[]).map(f=>({...f})),messages:c.messages.map(m=>({...m,expiresAt:m.expiresAt??m.timestamp+OUTBOX_TTL_MS,status:m.from===own&&m.status!=='delivered'&&m.status!=='expired'?'pending':m.status}))});
      }
      if([...conversations.values()].filter(c=>c.kind==='group').length>MAX_GROUPS)throw new Error('Group capacity exceeded');
      for(const pending of state.pending){const c=conversations.get(pending.conversationId);if(!c||!(pending.type==='file'?c.files.some(f=>f.id===pending.messageId&&f.senderId===(pending.author??own)):c.messages.some(m=>m.id===pending.messageId&&m.from===(pending.author??own)))||new Set(pending.remaining).size!==pending.remaining.length||pending.remaining.some(id=>id===own||!c.memberIds.includes(id)))throw new Error('Invalid stored outbox');}
      this.contacts=contacts;this.conversations=conversations;this.pending=state.pending.map(p=>{const c=conversations.get(p.conversationId)!;const item=p.type==='file'?c.files.find(f=>f.id===p.messageId)!:c.messages.find(m=>m.id===p.messageId)!;return {...p,type:p.type??'message',author:p.author??own,createdAt:p.createdAt??item.timestamp,expiresAt:p.expiresAt??item.timestamp+OUTBOX_TTL_MS};});
      for(const p of this.pending)this.committed.add(this.pendingKey(p));this.loaded=true;await this.expirePending();this.emit();
    })();return this.restorePromise;
  }
  async connect():Promise<void>{
    this.assertActive();
    this.stopped=false;if(this.status==='online')return;if(this.opening)return this.opening;
    clearTimeout(this.reconnect);this.opening=this.openDirectory().catch(error=>{if(!this.stopped){this.status='offline';this.report(error);this.scheduleReconnect();}throw error;}).finally(()=>{this.opening=undefined;});return this.opening;
  }
  private async openDirectory(){
    try{await this.restore();await this.expirePending();}catch(error){this.status='error';this.report(new Error('Encrypted local state is invalid; it was not overwritten'));this.stopped=true;throw error;}
    if(this.stopped)return;this.status='connecting';this.error=undefined;this.emit();const epoch=++this.epoch;
    const url=endpointUrl(this.options.serverUrl,'directory');url.protocol=url.protocol==='https:'?'wss:':'ws:';
    const socket=new WebSocket(url.toString());this.socket=socket;
    return new Promise<void>((resolve,reject)=>{
      let ready=false;let challenged=false;let settled=false;
      const finish=(error?:Error)=>{if(settled)return;settled=true;this.cancelOpening=undefined;clearTimeout(timer);if(error)reject(error);else resolve();};
      this.cancelOpening=()=>finish(new Error('Directory connection cancelled'));
      const timer=setTimeout(()=>{finish(new Error('Directory authentication timed out'));socket.close();},15000);
      socket.onmessage=event=>{
        if(this.socket!==socket||epoch!==this.epoch)return;
        try{
          if(typeof event.data!=='string'||event.data.length>MAX_DIRECTORY_FRAME)throw new Error('Invalid directory frame');
          const frame=directoryServerFrameSchema.parse(JSON.parse(event.data));
          if(frame.type==='challenge'){
            if(challenged||ready)throw new Error('Unexpected directory challenge');challenged=true;
            this.directorySend({type:'authenticate',publicKey:this.options.identity.publicKey,username:this.options.username,displayName:this.options.displayName,signature:signAuthentication(this.options.identity,frame.challenge,this.options.username,this.options.displayName)});
          }else if(frame.type==='ready'){
            if(!challenged||ready||frame.self.userId!==this.options.identity.userId||frame.self.publicKey!==this.options.identity.publicKey)throw new Error('Directory identity mismatch');
            ready=true;this.services=undefined;this.servicesRequest=undefined;this.wakeCapabilitiesRequest=undefined;this.self=frame.self;this.status='online';this.attempt=0;this.error=undefined;finish();this.watch();this.wakePending();this.emit();
            void this.refreshContacts().catch(e=>this.report(e));
          }else if(frame.type==='error'){
            const request=frame.requestId?this.requests.get(frame.requestId):undefined;
            if(request){clearTimeout(request.timer);this.requests.delete(frame.requestId!);request.reject(new Error(frame.message));}
            else if(!ready){if(['username-taken','auth-failed','auth-expired','session-replaced','device-already-registered'].includes(frame.code)){this.stopped=true;this.status='error';this.report(new Error(`${frame.code}: ${frame.message}`));}finish(new Error(`${frame.code}: ${frame.message}`));socket.close();}
            else if(frame.code==='session-replaced'||frame.code==='device-already-registered'){this.stopped=true;this.status='error';this.report(new Error(frame.code==='session-replaced'?'This identity connected on another client; reconnect manually':'This device is already registered on this server; resolve its existing profile'));socket.close();}
            else if(frame.code!=='peer-offline'&&(frame.requestId!==undefined||!['wake-expired','wake-not-allowed','provider-failed','service-rate-limit','service-busy','service-unavailable'].includes(frame.code)))this.report(new Error(frame.message));
          }else {
            if(!ready)throw new Error('Directory message before authentication');
            if('requestId' in frame){const request=this.requests.get(frame.requestId);if(request){clearTimeout(request.timer);this.requests.delete(frame.requestId);if(frame.type!==request.expected)request.reject(new Error('Unexpected directory response type'));else request.resolve(frame);}}
            else if(frame.type==='presence'){this.updateContact(frame.user);if(frame.user.online)this.wakePeer(frame.user.userId);this.changed();}
            else if(frame.type==='connect'){this.remember(frame.from);this.ensureDirect(frame.from);void this.ensurePair(frame.from.userId,false).catch(e=>this.report(e));this.watch();this.changed();}
          }
        }catch(error){finish(error instanceof Error?error:new Error('Invalid directory response'));this.report(error);socket.close();}
      };
      socket.onerror=()=>{finish(new Error('Directory connection failed'));};
      socket.onclose=()=>{
        if(this.socket!==socket)return;this.socket=undefined;this.services=undefined;this.servicesRequest=undefined;this.wakeCapabilitiesRequest=undefined;clearTimeout(this.wakeTimer);this.wakeTimer=undefined;finish(new Error('Directory disconnected'));
        for(const request of this.requests.values()){clearTimeout(request.timer);request.reject(new Error('Directory disconnected'));}this.requests.clear();
        for(const [id,user] of this.contacts)this.contacts.set(id,{...user,online:false});
        if(this.status!=='error')this.status='offline';this.emit();if(!this.stopped)this.scheduleReconnect();
      };
    });
  }
  private scheduleReconnect(){if(this.stopped||this.reconnect)return;const delay=Math.min(30000,1000*2**Math.min(5,this.attempt++));this.reconnect=setTimeout(()=>{this.reconnect=undefined;void this.connect().catch(e=>this.report(e));},delay);}
  private directorySend(frame:DirectoryClientFrame){if(this.socket?.readyState!==1)throw new Error('Directory is offline');this.socket.send(JSON.stringify(directoryClientFrameSchema.parse(frame)));}
  private requestFrame<T extends ReplyType>(input:RequestInput,expected:T):Promise<Extract<DirectoryServerFrame,{type:T}>>{
    if(this.status!=='online')return Promise.reject(new Error('Directory is offline'));
    if(this.requests.size>=32)return Promise.reject(new Error('Too many directory requests'));
    const requestId=this.id();const frame=directoryClientFrameSchema.parse({...input,requestId});
    return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.requests.delete(requestId);reject(new Error('Directory request timed out'));},10000);
      this.requests.set(requestId,{expected,resolve:reply=>resolve(reply as Extract<DirectoryServerFrame,{type:T}>),reject,timer});
      try{this.directorySend(frame);}catch(error){clearTimeout(timer);this.requests.delete(requestId);reject(error);}
    });
  }
  private async request(type:'search'|'lookup',value:string|string[]):Promise<DirectoryUser[]>{
    const frame=await this.requestFrame(type==='search'?{type,query:value as string}:{type,userIds:value as string[]},'results');return frame.users;
  }
  async getServices():Promise<ServiceCapabilities>{
    if(this.services&&this.status==='online')return {...this.services};
    if(!this.servicesRequest){const socket=this.socket;const request=this.requestFrame({type:'services'},'services').then(frame=>{const capabilities={...frame.capabilities};if(this.socket===socket&&this.status==='online')this.services=capabilities;return capabilities;});this.servicesRequest=request;
      void request.finally(()=>{if(this.servicesRequest===request)this.servicesRequest=undefined;}).catch(()=>{});
    }
    return {...await this.servicesRequest};
  }
  async startPhoneVerification(phone:string):Promise<PhoneChallenge>{return (await this.requestFrame({type:'phone-start',phone:normalizePhone(phone,'RU')},'phone-challenge')).challenge;}
  async verifyPhone(challengeId:string,code:string):Promise<void>{await this.requestFrame({type:'phone-verify',challengeId,code},'phone-verified');if(this.services)this.services={...this.services,phoneVerified:true};}
  async discoverPhones(hashes:string[]):Promise<PhoneMatch[]>{return (await this.requestFrame({type:'phone-discover',hashes},'phone-matches')).matches;}
  async registerPushToken(token:string,backgroundSync=false):Promise<void>{if(typeof backgroundSync!=='boolean')throw new Error('Invalid background sync mode');await this.requestFrame({type:'push-register',token,...(backgroundSync?{backgroundSync:true}:{})},'push-registered');}
  async getIceServers():Promise<RTCIceServer[]>{
    if(!this.iceRequest){const request=this.requestFrame({type:'ice'},'ice').then(frame=>iceServersSchema.parse(frame.iceServers));this.iceRequest=request;
      void request.finally(()=>{if(this.iceRequest===request)this.iceRequest=undefined;}).catch(()=>{});
    }
    const servers=await this.iceRequest;return servers.map(server=>({...server,urls:Array.isArray(server.urls)?[...server.urls]:server.urls}));
  }
  private now(){return performance.now();}
  private async sendWake(peerId:string,kind:WakeKind,remaining:number,valid:()=>boolean):Promise<void>{
    if(this.stopped||this.status!=='online'||remaining<=0)return;
    const began=this.now();
    try{
      const socket=this.socket;const capabilities=await this.getServices();
      remaining-=this.now()-began;
      if(this.socket!==socket||this.stopped||this.status!=='online'||!capabilities.push||remaining<=0||!valid())return;
      const key=(kind==='call'?'call:':'data:')+peerId;const now=this.now();const previous=this.lastWake.get(key);
      if(previous!==undefined&&now-previous<30000)return;
      this.directorySend({type:'wake',to:peerId,kind,intentId:this.id(),expiresAt:Date.now()+Math.max(1,Math.ceil(Math.min(kind==='call'?30000:60000,remaining)))});
      this.lastWake.set(key,now);
    }catch{/* Optional wake failures never mark content delivered or fail direct delivery. */}
  }
  private wakePending():void {
    clearTimeout(this.wakeTimer);this.wakeTimer=undefined;
    const peers=new Set(this.pending.filter(p=>this.committed.has(this.pendingKey(p))&&Date.now()<(p.expiresAt??Infinity)).flatMap(message=>message.remaining));
    for(const peerId of this.wakeStarted.keys())if(!peers.has(peerId))this.wakeStarted.delete(peerId);
    const now=this.now();for(const peerId of peers)if(!this.wakeStarted.has(peerId))this.wakeStarted.set(peerId,now);
    if(this.stopped||this.status!=='online'||!peers.size)return;
    let delay=30000;
    for(const peerId of peers){
      const grace=2500-(now-this.wakeStarted.get(peerId)!);
      const previous=this.lastWake.get('data:'+peerId);const cooldown=previous===undefined?0:30000-(now-previous);
      const due=Math.max(grace,cooldown);
      if(due<=0)void this.sendWake(peerId,this.pending.some(p=>p.type==='file'&&p.remaining.includes(peerId))?'file':'message',60000,()=>this.pending.some(message=>message.remaining.includes(peerId)&&Date.now()<(message.expiresAt??Infinity)));
      else delay=Math.min(delay,Math.max(500,due));
    }
    this.wakeTimer=setTimeout(()=>this.wakePending(),delay);
  }
  async search(query:string):Promise<DirectoryUser[]>{return this.request('search',query.normalize('NFKC').trim().replace(/^@/,'').trim().toLowerCase());}
  async listUsers(cursor?:string):Promise<DirectoryPage>{const frame=await this.requestFrame({type:'list-users',...(cursor!==undefined?{cursor}: {})},'users-page');return {users:frame.users.map(user=>({...user})),...(frame.nextCursor!==undefined?{nextCursor:frame.nextCursor}: {})};}
  private watch(){if(this.status==='online')this.directorySend({type:'watch',userIds:[...this.contacts.keys()]});}
  private refreshContacts(){return this.track(this.refreshContactsWork());}
  private async refreshContactsWork(){if(!this.contacts.size)return;const users=await this.request('lookup',[...this.contacts.keys()]);if(this.closing)return;for(const user of users)this.updateContact(user);this.changed();for(const user of users)if(user.online)this.wakePeer(user.userId);}
  private updateContact(user:DirectoryUser){const old=this.contacts.get(user.userId);if(old){if(old.publicKey!==user.publicKey)throw new Error('Pinned contact key changed');this.contacts.set(user.userId,user);if(old.online!==user.online){const pair=this.pairs.get(user.userId);if(pair)pair.notified=false;}const c=this.conversations.get(directConversationId(this.options.identity.userId,user.userId));if(c)c.title=user.displayName;}}
  private remember(user:DirectoryUser){directoryUserSchema.parse(user);if(user.userId===this.options.identity.userId)throw new Error('Cannot add self');if(!this.contacts.has(user.userId)&&this.contacts.size>=MAX_CONTACTS)throw new Error('Contact capacity exceeded');this.contacts.set(user.userId,{...user});}
  private ensureDirect(user:DirectoryUser):InternalConversation {
    const id=directConversationId(this.options.identity.userId,user.userId);let c=this.conversations.get(id);
    if(!c){c={id,kind:'direct',title:user.displayName,memberIds:[this.options.identity.userId,user.userId].sort(),messages:[],files:[],unread:0,updatedAt:Date.now()};this.conversations.set(id,c);}return c;
  }
  async addContact(user:DirectoryUser):Promise<string>{this.assertActive();return this.track(this.addContactWork(user));}
  private async addContactWork(user:DirectoryUser):Promise<string>{await this.restore();this.remember(user);const c=this.ensureDirect(user);this.watch();this.changed();if(user.online&&this.status==='online')void this.ensurePair(user.userId,true).catch(e=>this.report(e));return c.id;}
  private validConversation(peerId:string,conversationId:string|undefined){if(!conversationId)return false;const c=this.conversations.get(conversationId);return !!c&&c.memberIds.includes(peerId)&&c.memberIds.includes(this.options.identity.userId);}
  private async ensurePair(peerId:string,notify:boolean):Promise<Pair>{
    if(this.stopped)throw new Error('Messenger is disconnected');const user=this.contacts.get(peerId);if(!user)throw new Error('Unknown contact');
    let pair=this.pairs.get(peerId);
    if(!pair){
      if(this.pairs.size>=MAX_SESSIONS){const idle=[...this.pairs.entries()].filter(([id,p])=>!p.flushing&&!p.connecting&&p.session.getSnapshot().callState==='idle'&&!p.session.getSnapshot().files.some(f=>f.status==='sending'||f.status==='receiving')&&!this.pending.some(m=>m.remaining.includes(id))).sort((a,b)=>a[1].lastUsed-b[1].lastUsed)[0];if(!idle)throw new Error('Active peer capacity exceeded (16)');this.pairs.delete(idle[0]);clearTimeout(idle[1].retry);clearTimeout(idle[1].pump);idle[1].session.disconnect();}
      const session=new PeerSession({serverUrl:this.options.serverUrl,expectPeer:true,getIceServers:()=>this.getIceServers(),invite:conversationInvite(this.options.identity,user.publicKey),randomBytes:this.random,rtcFactory:this.options.rtcFactory,getUserMedia:this.options.getUserMedia,onChange:snapshot=>this.pairChanged(peerId,snapshot),onMessage:message=>this.receiveMessage(peerId,message),onApplication:payload=>this.receiveApplication(peerId,payload),onFile:file=>this.receiveFile(peerId,file),allowConversation:id=>this.validConversation(peerId,id)});
      pair={session,attempt:0,flushing:false,notified:false,lastUsed:Date.now(),lastSent:new Map(),definitions:new Set()};this.pairs.set(peerId,pair);
    }
    pair.lastUsed=Date.now();
    if(notify&&this.status==='online'&&!pair.notified){this.directorySend({type:'connect',to:peerId});pair.notified=true;}
    const status=pair.session.getSnapshot().status;
    if(!pair.connecting&&!['connecting','waiting','connected'].includes(status)){
      const current=pair;pair.connecting=current.session.connect().finally(()=>{current.connecting=undefined;});
      try{await pair.connecting;}catch(error){this.schedulePairRetry(peerId);throw error;}
    }else if(pair.connecting)await pair.connecting;
    return pair;
  }
  private schedulePairRetry(peerId:string){const pair=this.pairs.get(peerId);if(!pair||pair.retry||this.stopped||!this.contacts.get(peerId)?.online)return;pair.notified=false;clearTimeout(pair.pump);pair.pump=undefined;pair.retry=setTimeout(()=>{pair.retry=undefined;void this.ensurePair(peerId,true).catch(e=>this.report(e));},Math.min(30000,1000*2**Math.min(5,pair.attempt++)));}
  private wakePeer(peerId:string){const needs=this.pending.some(m=>m.remaining.includes(peerId))||this.pairs.has(peerId)||[...this.conversations.values()].some(c=>c.kind==='group'&&c.memberIds.includes(peerId));if(needs)void this.ensurePair(peerId,true).then(()=>this.flushPeer(peerId)).catch(e=>this.report(e));}
  private pairChanged(peerId:string,snapshot:SessionSnapshot){
    const pair=this.pairs.get(peerId);if(!pair)return;
    const direct=this.conversations.get(directConversationId(this.options.identity.userId,peerId));if(direct)direct.session=snapshot;for(const file of snapshot.files)if(file.status==='complete'&&file.data)pair.session.releaseFileData(file.id);
    if(this.pendingCall&&snapshot.callState==='incoming'){pair.session.rejectCall();return;}
    const nonIdle=[...this.pairs.entries()].find(([id,p])=>id!==peerId&&p.session.getSnapshot().callState!=='idle');
    if(nonIdle&&snapshot.callState==='incoming'){pair.session.rejectCall();return;}
    if(snapshot.status==='connected'){pair.attempt=0;clearTimeout(pair.retry);pair.retry=undefined;void this.flushPeer(peerId);}else if(snapshot.status==='disconnected'||snapshot.status==='error'){if(snapshot.error)this.error=(this.contacts.get(peerId)?.displayName??'Contact')+': '+snapshot.error;pair.lastSent.clear();pair.definitions.clear();this.schedulePairRetry(peerId);}else if(snapshot.status==='waiting'){pair.lastSent.clear();pair.definitions.clear();}
    this.emit();
  }
  private pendingKey(p:PendingMessage){return `${p.conversationId}:${p.author??this.options.identity.userId}:${p.messageId}`;}
  private async durable(){this.changed();await this.persist();}
  private assertActive(){if(this.closing)throw new Error('Messenger has been disposed');}
  private track<T>(work:Promise<T>):Promise<T>{this.activeWork.add(work);void work.then(()=>this.activeWork.delete(work),()=>this.activeWork.delete(work));return work;}
  private serial<T>(operation:()=>Promise<T>):Promise<T>{this.assertActive();const next=this.enqueueQueue.catch(()=>{}).then(operation);this.enqueueQueue=next.then(()=>{},()=>{});return this.track(next);}
  private async putBlob(key:string,data:Uint8Array){if(this.options.saveState&&!this.options.saveAttachment)throw new Error('Encrypted attachment storage is unavailable');if(this.options.saveAttachment)await this.options.saveAttachment(key,sealAttachment(this.options.identity,key,data,this.random));this.blobs.set(key,data.slice());}
  async getFileData(conversationId:string,fileId:string,senderId?:string):Promise<Uint8Array|null>{await this.restore();const file=this.conversations.get(conversationId)?.files.find(f=>f.id===fileId&&(!senderId||f.senderId===senderId));if(!file?.blobKey)return null;const cached=this.blobs.get(file.blobKey);if(cached)return cached.slice();const sealed=await this.options.loadAttachment?.(file.blobKey);if(!sealed)return null;const data=openAttachment(this.options.identity,file.blobKey,sealed);this.blobs.set(file.blobKey,data);return data.slice();}
  private fileCapacity(size:number){const files=[...this.conversations.values()].flatMap(c=>c.files).filter(f=>f.blobKey);if(files.length>=MAX_PENDING_FILES||files.reduce((n,f)=>n+f.size,0)+size>MAX_STORED_FILE_BYTES)throw new Error('Local file storage is full (16 files / 40 MiB); waiting content was preserved');}
  private origin(c:InternalConversation,metadata:string|undefined,id:string,type:'message'|'file',hash:string):GroupOrigin|undefined {if(c.kind!=='group')return;if(!c.definition||!metadata)throw new Error('Signed group content is required');const o=parseGroupOrigin(metadata,c.definition);if(o.id!==id||o.type!==type||o.hash!==hash||Date.now()>=o.expiresAt||o.timestamp>Date.now()+60000)throw new Error('Invalid or expired group content');return o;}
  private async acknowledge(p:PendingMessage,recipient:string,record:MessengerMessage|MessengerFile){
    const remaining=[...p.remaining],delivered=[...(record.deliveredTo??[])];const status=record.status;const delivery='deliveryStatus'in record?record.deliveryStatus:undefined;
    p.remaining=p.remaining.filter(id=>id!==recipient);record.deliveredTo=[...new Set([...delivered,recipient])];if('text'in record)record.status=p.remaining.length?'sent':'delivered';else{record.deliveryStatus=p.remaining.length?'sent':'delivered';record.status=p.remaining.length?'sending':'complete';}if(!p.remaining.length)this.pending=this.pending.filter(item=>item!==p);
    try{await this.durable();}catch(error){p.remaining=remaining;if(!this.pending.includes(p))this.pending.push(p);record.deliveredTo=delivered;if('text'in record)record.status=status as MessengerMessage['status'];else{record.status=status as SharedFile['status'];record.deliveryStatus=delivery;}this.dirty=true;throw error;}
  }
  private receiveMessage(peerId:string,message:ChatMessage):Promise<boolean>{return this.closing?Promise.resolve(false):this.track(this.receiveMessageWork(peerId,message));}
  private async receiveMessageWork(peerId:string,message:ChatMessage):Promise<boolean> {
    if(!this.validConversation(peerId,message.conversationId))return false;const c=this.conversations.get(message.conversationId!)!;const own=this.options.identity.userId;
    if(message.from==='self'){
      // Session ACK belongs to its authenticated transport peer. A forwarded ACK cannot
      // clear an author's outbox; forwarded final receipts are signed separately.
      const pending=this.pending.find(p=>p.messageId===message.id&&p.conversationId===c.id&&(p.author??own)===own&&p.type!=='file');
      if(message.metadata&&c.definition&&parseGroupOrigin(message.metadata,c.definition).author!==own)return false;const target=c.messages.find(m=>m.id===message.id&&m.from===own);if(!target)return false;
      if(message.status==='delivered'&&pending&&Date.now()<pending.expiresAt!){await this.acknowledge(pending,peerId,target);this.wakePending();return true;}else if(target.status!=='delivered'&&target.status!=='expired')target.status='sent';
      await this.durable();this.wakePending();return true;
    }
    const origin=this.origin(c,message.metadata,message.id,'message',contentHash('message',message.text));const author=origin?.author??peerId;
    let target=c.messages.find(m=>m.id===message.id&&m.from===author);
    if(!target){if(c.messages.length>=100&&c.messages.every(m=>this.pending.some(p=>p.conversationId===c.id&&p.messageId===m.id)))throw new Error('Local incoming history is full');target={id:message.id,text:message.text,from:author,timestamp:origin?.timestamp??message.timestamp,status:'received',conversationId:c.id,expiresAt:origin?.expiresAt??message.timestamp+OUTBOX_TTL_MS,metadata:message.metadata};c.messages.push(target);c.unread=Math.min(100,c.unread+1);c.updatedAt=Date.now();}
    else if(target.text!==message.text||target.metadata!==message.metadata)throw new Error('Conflicting message replay');
    // Retry the write even for an in-memory duplicate after a failed earlier write.
    this.protectedReceive.add(c.id+':'+message.id);try{await this.durable();}finally{this.protectedReceive.delete(c.id+':'+message.id);}if(origin)this.receiptAfterSave(c,origin,peerId);return true;
  }
  private receiveFile(peerId:string,file:SharedFile):Promise<boolean>{return this.closing?Promise.resolve(false):this.track(this.receiveFileWork(peerId,file));}
  private async receiveFileWork(peerId:string,file:SharedFile):Promise<boolean>{
    if(!this.validConversation(peerId,file.conversationId)||!file.data)return false;const c=this.conversations.get(file.conversationId!)!;
    const origin=this.origin(c,file.metadata,file.id,'file',contentHash('file',file.data,file.name,file.mime));const author=origin?.author??peerId;
    let target=c.files.find(f=>f.id===file.id&&f.senderId===author);const key=attachmentKey(author,file.id,c.id);
    if(!target){this.fileCapacity(file.size);target={...file,data:undefined,senderId:author,conversationId:c.id,blobKey:key,deliveryStatus:'received',expiresAt:origin?.expiresAt??Date.now()+OUTBOX_TTL_MS,timestamp:origin?.timestamp??Date.now()};c.files.push(target);c.updatedAt=Date.now();}
    else if(target.name!==file.name||target.mime!==file.mime||target.size!==file.size||target.metadata!==file.metadata)throw new Error('Conflicting file replay');
    await this.putBlob(key,file.data);target.blobKey=key;await this.durable();if(origin)this.receiptAfterSave(c,origin,peerId);return true;
  }
  private receiptAfterSave(c:InternalConversation,origin:GroupOrigin,peerId:string){const receipt=signGroupReceipt(this.options.identity,origin);const receipts=c.receipts??=[];if(!receipts.some(r=>r.author===receipt.author&&r.id===receipt.id&&r.recipient===receipt.recipient))receipts.push(receipt);this.changed();queueMicrotask(()=>{void this.pairs.get(peerId)?.session.sendApplication(receipt).catch(e=>this.report(e));});for(const id of c.memberIds)if(id!==this.options.identity.userId&&id!==peerId)this.wakePeer(id);}
  private receiveApplication(peerId:string,payload:unknown){return this.closing?Promise.resolve():this.track(this.receiveApplicationWork(peerId,payload));}
  private async receiveApplicationWork(peerId:string,payload:unknown){
    if((payload as {kind?:unknown})?.kind==='group-receipt'){
      const receipt=receiptSchema.parse(payload);const c=this.conversations.get(receipt.groupId);if(!c?.definition||!c.memberIds.includes(peerId)||!verifyGroupReceipt(receipt,c.definition))throw new Error('Invalid group receipt');
      const record=c.messages.find(m=>m.id===receipt.id&&m.from===receipt.author)??c.files.find(f=>f.id===receipt.id&&f.senderId===receipt.author);if(!record||!record.metadata)throw new Error('Unknown receipt origin');
      const origin=parseGroupOrigin(record.metadata,c.definition);if(Date.now()>=origin.expiresAt)throw new Error('Expired receipt');
      const receipts=c.receipts??=[];if(!receipts.some(r=>r.id===receipt.id&&r.author===receipt.author&&r.recipient===receipt.recipient))receipts.push(receipt);
      const pending=this.pending.find(p=>p.conversationId===c.id&&p.messageId===receipt.id&&(p.author??this.options.identity.userId)===receipt.author);
      if(pending&&receipt.author===this.options.identity.userId){await this.acknowledge(pending,receipt.recipient,record);return;}
      await this.durable();return;
    }
    const group=groupDefinitionSchema.parse(payload);const own=this.options.identity.userId;
    const signed=verifyGroupDefinition(group);if(group.signature&&!signed)throw new Error('Invalid group creator signature');
    if((!signed&&group.creatorId!==peerId)||!group.members.some(m=>m.userId===peerId)||!group.members.some(m=>m.userId===own)||new Set(group.members.map(m=>m.userId)).size!==group.members.length)throw new Error('Invalid group definition author/membership');
    const existing=this.conversations.get(group.id);if(existing&&(existing.creatorId!==group.creatorId||existing.title!==group.title||JSON.stringify(existing.memberIds)!==JSON.stringify(group.members.map(m=>m.userId).sort())))throw new Error('Group definition is immutable in this version');
    if(existing?.definition?.signature&&existing.definition.signature!==group.signature)throw new Error('Group definition is immutable in this version');
    if(!existing&&[...this.conversations.values()].filter(c=>c.kind==='group').length>=MAX_GROUPS)throw new Error('Group capacity exceeded');
    if(group.members.filter(m=>m.userId!==own&&!this.contacts.has(m.userId)).length+this.contacts.size>MAX_CONTACTS)throw new Error('Contact capacity exceeded');
    for(const member of group.members)if(member.userId!==own){const old=this.contacts.get(member.userId);if(old&&old.publicKey!==member.publicKey)throw new Error('Pinned contact key changed');this.remember({...member,online:old?.online??false});}
    if(!existing)this.conversations.set(group.id,{id:group.id,kind:'group',title:group.title,memberIds:group.members.map(m=>m.userId).sort(),creatorId:group.creatorId,definition:signed?group:undefined,messages:[],files:[],unread:0,updatedAt:Date.now()});else if(signed)existing.definition=group;
    this.watch();await this.durable();if(this.status==='online')void this.refreshContacts().catch(e=>this.report(e));
  }
  private definition(c:InternalConversation):GroupDefinition {if(c.definition)return c.definition;const group=groupDefinitionSchema.parse({kind:'group-definition',id:c.id,title:c.title,creatorId:c.creatorId,members:c.memberIds.map(id=>id===this.options.identity.userId?(this.self??{userId:id,publicKey:this.options.identity.publicKey,username:this.options.username,displayName:this.options.displayName,online:false,lastSeen:0}):this.contacts.get(id))});if(c.creatorId!==this.options.identity.userId)throw new Error('Legacy group has no signed creator roster');c.definition=signGroupDefinition(this.options.identity,group);return c.definition;}
  async createGroup(title:string,userIds:string[]):Promise<string>{this.assertActive();return this.track(this.createGroupWork(title,userIds));}
  private async createGroupWork(title:string,userIds:string[]):Promise<string>{
    title=z.string().trim().min(1).max(64).parse(title);if(this.status!=='online'||!this.self)throw new Error('Directory must be online');
    const members=[...new Set([this.options.identity.userId,...userIds])].sort();if(members.length<2||members.length>8)throw new Error('Groups require 2–8 members');members.forEach(id=>roomIdSchema.parse(id));
    if([...this.conversations.values()].filter(c=>c.kind==='group').length>=MAX_GROUPS)throw new Error('Group capacity exceeded');
    const missing=members.filter(id=>id!==this.options.identity.userId&&!this.contacts.has(id));if(missing.length){const users=await this.request('lookup',missing);if(users.length!==missing.length)throw new Error('Unknown group member');for(const user of users)this.remember(user);}
    const id='group:'+this.id();const c:InternalConversation={id,kind:'group',title,memberIds:members,creatorId:this.options.identity.userId,messages:[],files:[],unread:0,updatedAt:Date.now()};c.definition=this.definition(c);this.conversations.set(id,c);this.watch();await this.durable();this.kick(c);return id;
  }
  private kick(c:InternalConversation){for(const id of c.memberIds)if(id!==this.options.identity.userId&&this.status==='online'&&this.contacts.get(id)?.online)void this.ensurePair(id,true).then(()=>this.flushPeer(id)).catch(e=>this.report(e));this.wakePending();}
  private expirePending(){return this.closing?Promise.resolve():this.track(this.expirePendingWork());}
  private async expirePendingWork(){
    clearTimeout(this.expiryTimer);this.expiryTimer=undefined;const now=Date.now();const expired=this.pending.filter(p=>p.expiresAt!==undefined&&now>=p.expiresAt);const removed:string[]=[];
    for(const p of expired){const c=this.conversations.get(p.conversationId);if(!c)continue;if(p.type==='file'){const file=c.files.find(f=>f.id===p.messageId&&f.senderId===(p.author??this.options.identity.userId));if(file){file.deliveryStatus='expired';file.status='error';if(file.blobKey)removed.push(file.blobKey);file.blobKey=undefined;file.data=undefined;}}else{const message=c.messages.find(m=>m.id===p.messageId&&m.from===(p.author??this.options.identity.userId));if(message)message.status='expired';}this.committed.delete(this.pendingKey(p));}
    if(expired.length){this.pending=this.pending.filter(p=>!expired.includes(p));await this.durable();for(const key of removed){this.blobs.delete(key);await this.options.deleteAttachment?.(key);}}
    if(this.pending.length&&!this.closing){const deadline=Math.min(...this.pending.map(p=>p.expiresAt??Infinity));this.expiryTimer=setTimeout(()=>{void this.expirePending().catch(e=>this.report(e));},Math.max(1,Math.min(2147483647,deadline-Date.now())));}
  }
  private flushPeer(peerId:string){return this.closing?Promise.resolve():this.track(this.flushPeerWork(peerId));}
  private async flushPeerWork(peerId:string){
    const pair=this.pairs.get(peerId);if(!pair||pair.flushing||pair.session.getSnapshot().status!=='connected')return;pair.flushing=true;
    try {
      await this.expirePending();
      for(const c of this.conversations.values())if(c.kind==='group'&&c.memberIds.includes(peerId)&&!pair.definitions.has(c.id)&&(c.definition||c.creatorId===this.options.identity.userId)){await pair.session.sendApplication(this.definition(c));pair.definitions.add(c.id);}
      const own=this.options.identity.userId;
      for(const c of this.conversations.values()){
        if(!c.memberIds.includes(peerId))continue;
        const pending=this.pending.filter(p=>p.conversationId===c.id&&p.remaining.includes(peerId)&&this.committed.has(this.pendingKey(p)));
        const records:Array<{type:'message'|'file';item:MessengerMessage|MessengerFile;author:string}>=[];
        for(const p of pending){const item=p.type==='file'?c.files.find(f=>f.id===p.messageId&&f.senderId===(p.author??own)):c.messages.find(m=>m.id===p.messageId&&m.from===(p.author??own));if(item)records.push({type:p.type??'message',item,author:p.author??own});}
        // Retained signed history is a bounded anti-entropy source for group peers.
        if(c.kind==='group'&&c.definition){for(const m of c.messages)if(m.from!==peerId&&m.from!==own&&m.metadata&&Date.now()<(m.expiresAt??0))records.push({type:'message',item:m,author:m.from});for(const f of c.files)if(f.senderId!==peerId&&f.senderId!==own&&f.metadata&&f.blobKey&&Date.now()<(f.expiresAt??0))records.push({type:'file',item:f,author:f.senderId});}
        for(const {type,item,author} of records){
          if(c.kind==='group'&&(c.receipts??[]).some(r=>r.id===item.id&&r.author===author&&r.recipient===peerId))continue;
          if(c.kind==='group'&&author===own&&!item.metadata&&c.definition){item.metadata=JSON.stringify(signGroupOrigin(this.options.identity,{groupId:c.id,id:item.id,type,timestamp:item.timestamp,expiresAt:item.expiresAt??item.timestamp+OUTBOX_TTL_MS,hash:type==='message'?contentHash('message',(item as MessengerMessage).text):contentHash('file',(await this.getFileData(c.id,item.id,author))!, (item as MessengerFile).name,(item as MessengerFile).mime)}));await this.durable();}const key=c.id+':'+author+':'+item.id;if(Date.now()-(pair.lastSent.get(key)??0)<5000)continue;pair.lastSent.set(key,Date.now());
          try{if(type==='message'){const message=item as MessengerMessage;await pair.session.sendText(message.text,{messageId:message.id,conversationId:c.id,metadata:message.metadata,timestamp:message.timestamp});}
            else{const file=item as MessengerFile;const data=await this.getFileData(c.id,file.id,author);if(!data)throw new Error('Encrypted file bytes are unavailable');await pair.session.sendFile({name:file.name,mime:file.mime,data},{messageId:file.id,conversationId:c.id,metadata:file.metadata});if(author===own){const p=this.pending.find(p=>p.type==='file'&&p.conversationId===c.id&&p.messageId===file.id);if(p&&Date.now()<p.expiresAt!){await this.acknowledge(p,peerId,file);}}}
          }catch(error){pair.lastSent.delete(key);throw error;}
        }
        for(const r of c.receipts??[]){const record=c.messages.find(m=>m.id===r.id&&m.from===r.author)??c.files.find(f=>f.id===r.id&&f.senderId===r.author);if(!record||Date.now()>=(record.expiresAt??0))continue;const key='receipt:'+c.id+':'+r.author+':'+r.id+':'+r.recipient;if(pair.lastSent.has(key))continue;await pair.session.sendApplication(r);pair.lastSent.set(key,Date.now());}
      }
    }catch(error){this.report(error);}finally{pair.flushing=false;this.scheduleOutbox(peerId);}
  }
  private scheduleOutbox(peerId:string){const pair=this.pairs.get(peerId);if(!pair||pair.pump||this.stopped||pair.session.getSnapshot().status!=='connected')return;const relay=[...this.conversations.values()].some(c=>c.kind==='group'&&c.memberIds.includes(peerId)&&(c.messages.some(m=>m.metadata&&Date.now()<(m.expiresAt??0))||c.files.some(f=>f.metadata&&f.blobKey&&Date.now()<(f.expiresAt??0))));if(!this.pending.some(p=>p.remaining.includes(peerId))&&!relay)return;pair.pump=setTimeout(()=>{pair.pump=undefined;void this.flushPeer(peerId);},5000);}
  async sendText(conversationId:string,text:string):Promise<void>{return this.serial(async()=>{
    await this.restore();await this.expirePending();const c=this.conversations.get(conversationId);if(!c)throw new Error('Unknown conversation');if(!text.trim()||text.length>MAX_TEXT_CHARS)throw new Error('Text must contain 1–4000 characters');if(this.pending.filter(p=>p.type!=='file').length>=MAX_PENDING_MESSAGES)throw new Error('Local outbox is full');
    const timestamp=Date.now();const expiresAt=timestamp+OUTBOX_TTL_MS;const id=this.id();const peers=c.memberIds.filter(id=>id!==this.options.identity.userId);const metadata=c.kind==='group'?JSON.stringify(signGroupOrigin(this.options.identity,{groupId:this.definition(c).id,id,type:'message',timestamp,expiresAt,hash:contentHash('message',text)})):undefined;
    const message:MessengerMessage={id,text,from:this.options.identity.userId,timestamp,expiresAt,metadata,status:'pending',conversationId,recipientIds:peers,deliveredTo:[]};const p:PendingMessage={conversationId,messageId:id,remaining:peers,type:'message',author:this.options.identity.userId,createdAt:timestamp,expiresAt};c.messages.push(message);c.updatedAt=timestamp;this.pending.push(p);
    try{await this.durable();}catch(error){c.messages=c.messages.filter(m=>m!==message);this.pending=this.pending.filter(item=>item!==p);this.dirty=true;throw error;}this.committed.add(this.pendingKey(p));await this.expirePending();this.kick(c);
  });}
  private operation(conversationId:string,timeout:number,peerId?:string):PendingOperation {
    const operation:PendingOperation={controller:new AbortController(),started:this.now(),timeout,conversationId,peerId};
    operation.timer=setTimeout(()=>operation.controller.abort(new Error('Recipient connection timed out')),timeout);return operation;
  }
  private assertOperation(operation:PendingOperation){
    if(operation.controller.signal.aborted)throw operation.controller.signal.reason??new Error('Operation cancelled');
    if(this.stopped)throw new Error('Messenger is disconnected');
    if(this.now()-operation.started>=operation.timeout)throw new Error('Recipient connection timed out');
  }
  private async waitForPeer(peerId:string,operation:PendingOperation,kind:'file'|'call'):Promise<Pair>{
    let attempted=false;let nextAttempt=0;let nextWake=2500;
    while(true){
      this.assertOperation(operation);const pair=this.pairs.get(peerId);
      if(pair?.session.getSnapshot().status==='connected')return pair;
      const elapsed=this.now()-operation.started;
      if(!attempted||elapsed>=nextAttempt){attempted=true;nextAttempt=elapsed+5000;
        void this.ensurePair(peerId,true).catch(()=>{/* Bounded readiness loop and peer snapshot expose transport failures. */});
      }
      if(elapsed>=nextWake){nextWake=elapsed+30000;void this.sendWake(peerId,kind,operation.timeout-elapsed,()=>!operation.controller.signal.aborted&&this.now()-operation.started<operation.timeout&&this.pairs.get(peerId)?.session.getSnapshot().status!=='connected');}
      await new Promise<void>((resolve,reject)=>{
        const abort=()=>{clearTimeout(timer);reject(operation.controller.signal.reason??new Error('Operation cancelled'));};
        const timer=setTimeout(()=>{operation.controller.signal.removeEventListener('abort',abort);resolve();},100);
        operation.controller.signal.addEventListener('abort',abort,{once:true});
      });
    }
  }
  async sendFile(conversationId:string,file:{name:string;mime:string;data:Uint8Array}):Promise<void>{return this.serial(async()=>{
    await this.restore();await this.expirePending();if(file.data.length>MAX_FILE_BYTES)throw new Error('File exceeds 5 MiB limit');const c=this.conversations.get(conversationId);if(!c)throw new Error('Unknown conversation');if(!file.name||file.name.length>255||typeof file.mime!=='string'||file.mime.length>255)throw new Error('Invalid file metadata');this.fileCapacity(file.data.length);
    const timestamp=Date.now(),expiresAt=timestamp+OUTBOX_TTL_MS,id=this.id(),own=this.options.identity.userId;const key=attachmentKey(own,id,conversationId);const peers=c.memberIds.filter(id=>id!==own);const metadata=c.kind==='group'?JSON.stringify(signGroupOrigin(this.options.identity,{groupId:this.definition(c).id,id,type:'file',timestamp,expiresAt,hash:contentHash('file',file.data,file.name,file.mime)})):undefined;
    await this.putBlob(key,file.data);const record:MessengerFile={id,name:file.name,mime:file.mime,size:file.data.length,from:'self',status:'sending',receivedBytes:0,timestamp,senderId:own,conversationId,blobKey:key,metadata,expiresAt,deliveryStatus:'pending',recipientIds:peers,deliveredTo:[]};const p:PendingMessage={conversationId,messageId:id,remaining:peers,type:'file',author:own,createdAt:timestamp,expiresAt};c.files.push(record);this.pending.push(p);c.updatedAt=timestamp;
    try{await this.durable();}catch(error){c.files=c.files.filter(f=>f!==record);this.pending=this.pending.filter(item=>item!==p);this.blobs.delete(key);this.dirty=true;throw error;}this.committed.add(this.pendingKey(p));await this.expirePending();this.kick(c);
  });}
  async startCall(conversationId:string,video=false):Promise<void>{
    const c=this.conversations.get(conversationId);if(!c||c.kind!=='direct')throw new Error('Group calls are not implemented');
    if(this.getSnapshot().activeCall)throw new Error('Another call is already active');
    const peerId=c.memberIds.find(id=>id!==this.options.identity.userId)!;const operation=this.operation(conversationId,30000,peerId);this.pendingCall=operation;this.emit();
    try{
      const pair=await this.waitForPeer(peerId,operation,'call');this.assertOperation(operation);
      if([...this.pairs.values()].some(p=>p.session.getSnapshot().callState!=='idle'))throw new Error('Another call is already active');
      // Cancellation also invalidates an outstanding microphone permission request.
      let abort!:()=>void;
      const cancelled=new Promise<never>((_resolve,reject)=>{abort=()=>{pair.session.endCall();reject(operation.controller.signal.reason??new Error('Call cancelled'));};operation.controller.signal.addEventListener('abort',abort,{once:true});});
      try{await Promise.race([pair.session.startCall(video),cancelled]);}finally{operation.controller.signal.removeEventListener('abort',abort);}
    }finally{clearTimeout(operation.timer);if(this.pendingCall===operation)this.pendingCall=undefined;this.emit();}
  }
  async acceptCall():Promise<void>{const active=this.getSnapshot().activeCall;if(!active||active.session.callState!=='incoming')throw new Error('No incoming call');await this.pairs.get(active.peerId)!.session.acceptCall();}
  rejectCall():void{const active=this.getSnapshot().activeCall;if(active)this.pairs.get(active.peerId)?.session.rejectCall();}
  endCall():void{const pending=this.pendingCall;this.pendingCall=undefined;if(pending){clearTimeout(pending.timer);pending.controller.abort(new Error('Call cancelled'));}const active=this.getSnapshot().activeCall;if(active)this.pairs.get(active.peerId)?.session.endCall();else if(pending)this.pairs.get(pending.peerId!)?.session.endCall();this.emit();}
  setMuted(muted:boolean):void{const active=this.getSnapshot().activeCall;if(active)this.pairs.get(active.peerId)?.session.setMuted(muted);}
  markRead(conversationId:string):void{if(this.closing)return;const c=this.conversations.get(conversationId);if(c){c.unread=0;this.changed();}}
  private trimHistory(){
    for(const c of this.conversations.values()){while(c.files.length>64){const index=c.files.findIndex(f=>!f.blobKey&&f.deliveryStatus==='expired');if(index<0)break;c.files.splice(index,1);}if(c.receipts)c.receipts=c.receipts.filter(r=>c.messages.some(m=>m.id===r.id&&m.from===r.author)||c.files.some(f=>f.id===r.id&&f.senderId===r.author));}
    const pending=new Set([...this.pending.map(p=>p.conversationId+':'+p.messageId),...this.protectedReceive]);
    for(const c of this.conversations.values())while(c.messages.length>100){const index=c.messages.findIndex(m=>!pending.has(c.id+':'+m.id));if(index<0)break;c.messages.splice(index,1);}
    let count=[...this.conversations.values()].reduce((n,c)=>n+c.messages.length,0);
    while(count>MAX_HISTORY_MESSAGES){let oldest:InternalConversation|undefined;let index=-1;let timestamp=Infinity;for(const c of this.conversations.values())for(let i=0;i<c.messages.length;i++){const m=c.messages[i]!;if(!pending.has(c.id+':'+m.id)&&m.timestamp<timestamp){oldest=c;index=i;timestamp=m.timestamp;}}if(!oldest)break;oldest.messages.splice(index,1);count--;}
  }
  async networkChanged():Promise<void>{
    if(this.closing||this.stopped)return;this.cancelOpening?.();await this.opening?.catch(()=>{});clearTimeout(this.reconnect);this.reconnect=undefined;
    const socket=this.socket;this.socket=undefined;if(socket){socket.onmessage=null;socket.onclose=null;socket.onerror=null;socket.close();}
    for(const r of this.requests.values()){clearTimeout(r.timer);r.reject(new Error('Network changed'));}this.requests.clear();this.iceRequest=undefined;this.services=undefined;this.status='offline';
    // Directory recovery does not discard peer connections, pending sends or live media.
    const reopen=this.connect();for(const pair of this.pairs.values()){const session=pair.session as PeerSession&{networkChanged?:()=>void};session.networkChanged?.();}
    await reopen;for(const id of this.pairs.keys())void this.flushPeer(id);
  }
  /** Terminal disposal boundary for a task-owned runtime. Construct a new manager after awaiting it. */
  disconnectAndFlush():Promise<void>{
    if(this.shutdown)return this.shutdown;
    let resolve!:()=>void;let reject!:(error:unknown)=>void;
    this.shutdown=new Promise<void>((yes,no)=>{resolve=yes;reject=no;});this.closing=true;
    void this.shutdownWork().then(resolve,reject);return this.shutdown;
  }
  private async shutdownWork():Promise<void>{
    const sessions=[...this.pairs.values()].map(pair=>pair.session);
    const drained=sessions.map(session=>session.disconnectAndFlush());
    this.disconnect();
    await Promise.allSettled(drained);
    if(this.restorePromise)await this.restorePromise.catch(()=>{});
    if(this.opening)await this.opening.catch(()=>{});
    while(this.activeWork.size){await Promise.allSettled([...this.activeWork]);}
    await this.enqueueQueue;
    clearTimeout(this.savedTimer);this.savedTimer=undefined;clearTimeout(this.expiryTimer);this.expiryTimer=undefined;
    try{await this.persist();await this.saveQueue;}finally{this.closed=true;}
  }
  disconnect():void{
    if(this.closed)return;
    if(this.pendingCall)this.endCall();clearTimeout(this.expiryTimer);this.expiryTimer=undefined;
    this.stopped=true;++this.epoch;this.cancelOpening?.();this.cancelOpening=undefined;clearTimeout(this.wakeTimer);this.wakeTimer=undefined;clearTimeout(this.reconnect);this.reconnect=undefined;
    const socket=this.socket;this.socket=undefined;this.services=undefined;this.servicesRequest=undefined;this.wakeCapabilitiesRequest=undefined;if(socket){socket.onmessage=null;socket.onclose=null;socket.onerror=null;socket.close();}
    for(const request of this.requests.values()){clearTimeout(request.timer);request.reject(new Error('Disconnected'));}this.requests.clear();
    for(const pair of this.pairs.values()){clearTimeout(pair.retry);clearTimeout(pair.pump);pair.session.disconnect();}this.pairs.clear();
    for(const [id,user] of this.contacts)this.contacts.set(id,{...user,online:false});this.status='offline';clearTimeout(this.savedTimer);this.savedTimer=undefined;void this.persist().catch(error=>this.report(error));this.emit();
  }
}
