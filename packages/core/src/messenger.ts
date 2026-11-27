import {callCaptionFrameSchema,type CallCaptionFrame} from './call-captions.js';
import {CALL_INVITE_TTL_MS,callPushSchema,callPushEnvelopeSchema,type CallInvitation,type CallState} from './call-control.js';
import {encryptCallPush,decryptCallPush,type OpenedCallPush} from './call-push.js';
import { normalizePhone, iceServersSchema, type ServiceCapabilities, type PhoneChallenge } from './services.js';
import { z } from 'zod';
import { bytesToHex, randomChecked, secureRandomBytes, type RandomBytes } from './crypto.js';
import {MAX_DELIVERY_PEERS, directoryClientFrameSchema, directoryServerFrameSchema, directoryUserSchema, directConversationId, conversationInvite, endpointUrl, signAuthentication, usernameSchema, displayNameSchema, validateDeviceIdentity, pushPreviewSchema,pushPreviewEnvelopeSchema, type DeviceIdentity, type DirectoryUser, type DirectoryClientFrame, type DirectoryServerFrame, type PhoneMatch, type DirectoryPage, type WakeKind,type WakeIntent } from './directory.js';
import { countryHintsSchema, inviteCodeSchema, InviteRequestError, type AccessRequest, type CreatedInvite, type InviteStatus, type PhoneVisibility } from './directory.js';
import {decryptPushPreview,type OpenedPushPreview} from './push-preview.js';
import {MAX_MAILBOX_BATCH_CHARS,MAX_MAILBOX_PUT_ITEMS,mailboxRecordId,openMailboxItem,sealMailboxItem,type MailboxAck,type MailboxItem,type MailboxKind,type MailboxPayload,type MailboxReceipt,type mailboxFileSchema} from './mailbox.js';
import { conversationIdSchema, MAX_BULK_BYTES, MAX_FILE_BYTES, MAX_TEXT_CHARS, peerIdSchema, roomIdSchema } from './protocol.js';
import type { BulkOffer, BulkSink } from './bulk.js';
import { openAttachment, sealAttachment, openLocalState, sealLocalState } from './persistence.js';
import { localRecordWriter, type LocalRecordStore, type LocalRecordWriter } from './local-records.js';
import { PeerSession, type PeerSessionOptions, type SessionSnapshot, type SharedFile, type ChatMessage } from './session.js';
import {OUTBOX_TTL_MS,groupDefinitionSchema,signGroupDefinition,verifyGroupDefinition,rosterVersion,signGroupOrigin,parseGroupOrigin,contentHash,receiptSchema,signGroupReceipt,verifyGroupReceipt,attachmentKey,bulkHash,type GroupDefinition,type GroupOrigin,type GroupReceipt} from './group-sync.js';
import {encodeDirectFileTiming,parseDirectFileTiming} from './direct-file.js';
import {readReceiptSchema,signReadReceipt,verifyReadReceipt,type ReadReceipt} from './read-receipt.js';
import {messageChangeSchema,signMessageChange,verifyMessageChange,type MessageChange} from './message-change.js';
import {messageReactionSchema,signMessageReaction,verifyMessageReaction,type MessageReaction,type ReactionEmoji} from './message-reaction.js';
export {OUTBOX_TTL_MS} from './group-sync.js';
export interface MessengerMessage {id:string;text:string;from:string;timestamp:number;status:'pending'|'sent'|'delivered'|'received'|'expired';conversationId:string;expiresAt?:number;metadata?:string;recipientIds?:string[];deliveredTo?:string[];readBy?:string[];notifiedTo?:string[];editedAt?:number;originalText?:string;reactions?:ReactionView[];}
export interface MessengerFile extends SharedFile {timestamp:number;senderId:string;conversationId:string;deliveryStatus?:'pending'|'sent'|'delivered'|'received'|'expired';expiresAt?:number;blobKey?:string;recipientIds?:string[];deliveredTo?:string[];readBy?:string[];notifiedTo?:string[];reactions?:ReactionView[];large?:true;
  /** Announced through the server; the bytes come directly once the sender's phone is online. */
  waiting?:true;}
/** One member's current reaction, oldest first. */
export interface ReactionView {userId:string;emoji:ReactionEmoji;}
export interface Conversation {id:string;kind:'direct'|'group';title:string;memberIds:string[];creatorId?:string;formerIds?:string[];removed?:boolean;messages:MessengerMessage[];files:MessengerFile[];unread:number;updatedAt:number;session?:SessionSnapshot;hidden?:boolean;implicit?:boolean;/** Older messages moved out of memory into the encrypted archive; read them with loadEarlier. */archived?:number;/** Text typed but not sent, kept with the chat (encrypted like the history). */draft?:string;}
/** What a contact may do besides sending messages. Absent means both, as for every contact before 1.0.42. */
export interface ContactPermissions {/** Wake this phone (pushes) and call. */push:boolean;/** Open a direct phone-to-phone connection (files, calls); it reveals the IP address to each other. */direct:boolean;}
/** Someone who is not a contact wrote first. Their messages stay encrypted on the server, unopened, until accepted. */
export interface MessageRequest {user:DirectoryUser;/** Items waiting on the server (0 for a direct connection request from an older app). */waiting:number;}
export interface PendingIncomingCall extends OpenedCallPush {state:'ringing'|'accepted';revision:number;}
interface OutgoingInvitation extends CallInvitation {peerId:string;conversationId:string;video:boolean;serverEpoch?:string;offered:boolean;offering:boolean;ringing:boolean;sessionStarted:boolean;revision:number;operation:PendingOperation;timer?:ReturnType<typeof setTimeout>;expiry?:ReturnType<typeof setTimeout>;}
export interface MessengerSnapshot {status:'idle'|'connecting'|'online'|'offline'|'error';/** The encrypted local history has been read; before that an empty chat list means "not loaded yet", not "no chats". */restored?:boolean;self?:DirectoryUser;contacts:DirectoryUser[];conversations:Conversation[];activeCall?:{conversationId:string;peerId:string;session:SessionSnapshot};pendingIncomingCall?:PendingIncomingCall;verifiedContacts:string[];blockedContacts:string[];messageRequests?:MessageRequest[];contactPermissions?:Record<string,ContactPermissions>;movedContacts?:Record<string,DirectoryUser>;error?:string;}
export interface MessengerOptions {callCaptions?:boolean;/** Receives the server's address list (primary first) after sign-in; asks for it with endpointsV1. */onEndpoints?:(urls:string[])=>void;reconcileDeliveryOnConnect?:boolean;/** Texts and service records go through the encrypted server mailbox when the server and recipient support it. */mailbox?:boolean;serverUrl:string;identity:DeviceIdentity;username:string;displayName:string;emailProof?:string;/** Registration with a number confirmed through Telegram: no invitation or email needed. */phoneProof?:string;inviteCode?:string;/** Registration only, and only for a server whose policy announced `countryHints`. */countryHints?:string[];randomBytes?:RandomBytes;rtcFactory?:PeerSessionOptions['rtcFactory'];getUserMedia?:PeerSessionOptions['getUserMedia'];createMediaStream?:PeerSessionOptions['createMediaStream'];onChange?:(snapshot:MessengerSnapshot)=>void;/** Awaited before the history is encrypted and saved, so a phone can keep that work out of a screen animation; it must settle quickly. */whenIdle?:()=>Promise<void>;/** Per-record encrypted storage (SQLite on the phone); takes precedence over loadState/saveState, which are then read once to migrate and cleared after the first successful write. */records?:LocalRecordStore;clearLegacyState?:()=>Promise<void>;loadState?:()=>Promise<string|null>;saveState?:(sealed:string)=>Promise<void>;saveAttachment?:(key:string,sealed:string)=>Promise<void>;loadAttachment?:(key:string)=>Promise<string|null>;deleteAttachment?:(key:string)=>Promise<void>;
  /**
   * Files as plain bytes in the app's private storage (since 1.0.43: files are encrypted on the way, not on the
   * phone). When present, new files are written here; older sealed attachments are still read through loadAttachment.
   */
  savePlainAttachment?:(key:string,data:Uint8Array)=>Promise<void>;loadPlainAttachment?:(key:string)=>Promise<Uint8Array|null>;
  /** Large files (up to 1 GiB) live as plain files in app storage under the attachment key; the core only streams them. Without it this client neither sends nor accepts them. */
  bulkFiles?:BulkFileStore;}
export interface BulkFileStore {read(key:string,name:string,offset:number,length:number):Promise<Uint8Array>;openIncoming(key:string,name:string,size:number):Promise<BulkSink>;}
export const MAX_CONTACTS=100;
export const MAX_GROUPS=32;
export const MAX_HISTORY_MESSAGES=500;
export const MAX_PENDING_MESSAGES=100;
const MAX_SESSIONS=16;
const MAX_DIRECTORY_FRAME=128*1024;
/** Own files waiting for delivery (the sender-held outbox). */
export const MAX_PENDING_FILES=16;
/** How long files wait for ICE to find a direct path before they use the TURN relay. */
export const RELAY_GRACE_MS=10_000;
/** Files kept on this phone: received and sent, delivered or not. */
export const MAX_STORED_FILES=2000;
export const MAX_STORED_FILE_BYTES=10*1024*1024*1024;
/** Records without a stored copy (expired, failed) kept per chat. */
const MAX_FILE_RECORDS_WITHOUT_DATA=64;
export const MAX_MESSAGE_CHANGES=128;
export const MAX_TOMBSTONES=256;
/** A history of 100 messages and 64 files with 8 members each fits; older reactions go first beyond that. */
export const MAX_REACTIONS=1312;
export const MAX_TOTAL_REACTIONS=4000;
/** History alone can reach about 6 MiB of the 16 MiB state limit; stored file records take the rest. Edits and deletions never take it past that. */
const MAX_CHANGE_STATE_BYTES=1024*1024;
const MAX_APPLICATION_BODY=16000;
const utf8=new TextEncoder();
const withReactions=(reactions?:ReactionView[])=>reactions?{reactions}:{};
/** Archive rows sort by time inside a chat, so a page is one range read. */
const archiveKey=(conversationId:string,m:{timestamp:number;from:string;id:string})=>`a:${conversationId}:${String(Math.max(0,Math.floor(m.timestamp))).padStart(15,'0')}:${m.from}:${m.id}`;
const messageSchema=z.object({id:peerIdSchema,text:z.string().min(1).max(MAX_TEXT_CHARS),from:roomIdSchema,timestamp:z.number().finite().nonnegative(),status:z.enum(['pending','sent','delivered','received','expired']),conversationId:conversationIdSchema,expiresAt:z.number().finite().nonnegative().optional(),metadata:z.string().max(12000).optional(),recipientIds:z.array(roomIdSchema).max(7).optional(),deliveredTo:z.array(roomIdSchema).max(7).optional(),readBy:z.array(roomIdSchema).max(7).optional(),notifiedTo:z.array(roomIdSchema).max(7).optional(),editedAt:z.number().finite().nonnegative().optional(),originalText:z.string().min(1).max(MAX_TEXT_CHARS).optional()}).strict();
const fileSchema=z.object({id:peerIdSchema,name:z.string().min(1).max(255),mime:z.string().max(255),size:z.number().int().min(0).max(MAX_BULK_BYTES),large:z.literal(true).optional(),timestamp:z.number().finite().nonnegative(),from:z.enum(['self','peer']),status:z.enum(['sending','receiving','complete','error']),receivedBytes:z.number().nonnegative(),senderId:roomIdSchema,conversationId:conversationIdSchema,metadata:z.string().max(12000).optional(),expiresAt:z.number().finite().nonnegative().optional(),deliveryStatus:z.enum(['pending','sent','delivered','received','expired']).optional(),blobKey:roomIdSchema.optional(),recipientIds:z.array(roomIdSchema).max(7).optional(),deliveredTo:z.array(roomIdSchema).max(7).optional(),readBy:z.array(roomIdSchema).max(7).optional(),notifiedTo:z.array(roomIdSchema).max(7).optional(),waiting:z.literal(true).optional()}).strict().refine(f=>f.large||f.size<=MAX_FILE_BYTES,'File exceeds 5 MiB limit');
const tombstoneSchema=z.object({id:peerIdSchema,author:roomIdSchema,type:z.enum(['message','file']),expiresAt:z.number().finite().nonnegative()}).strict();
type Tombstone=z.infer<typeof tombstoneSchema>;
interface InternalConversation extends Conversation {creatorId?:string;definition?:GroupDefinition;notifyRemoved?:string[];joinedAt?:Record<string,number>;receipts?:GroupReceipt[];readReceipts?:ReadReceipt[];changes?:MessageChange[];tombstones?:Tombstone[];reactions?:MessageReaction[];}
interface PendingOperation {controller:AbortController;started:number;timeout:number;timer?:ReturnType<typeof setTimeout>;conversationId:string;peerId?:string;}
interface PendingMessage {conversationId:string;messageId:string;remaining:string[];type?:'message'|'file';author?:string;createdAt?:number;expiresAt?:number;/** Recipients whose server mailbox holds this item: a text then needs no direct path; a file only announced itself. */mailboxed?:string[];}
const pendingSchema=z.object({conversationId:conversationIdSchema,messageId:peerIdSchema,remaining:z.array(roomIdSchema).min(1).max(7),type:z.enum(['message','file']).optional(),author:roomIdSchema.optional(),createdAt:z.number().finite().nonnegative().optional(),expiresAt:z.number().finite().nonnegative().optional(),mailboxed:z.array(roomIdSchema).max(7).optional()}).strict();
const storedConversationSchema=z.object({id:conversationIdSchema,kind:z.enum(['direct','group']),title:z.string().min(1).max(64),memberIds:z.array(roomIdSchema).min(1).max(8),creatorId:roomIdSchema.optional(),formerIds:z.array(roomIdSchema).max(64).optional(),removed:z.boolean().optional(),notifyRemoved:z.array(roomIdSchema).max(8).optional(),joinedAt:z.record(roomIdSchema,z.number().finite().nonnegative()).optional(),definition:groupDefinitionSchema.optional(),receipts:z.array(receiptSchema).max(4000).optional(),readReceipts:z.array(readReceiptSchema).max(1312).optional(),messages:z.array(messageSchema).max(100),files:z.array(fileSchema).max(MAX_STORED_FILES+MAX_FILE_RECORDS_WITHOUT_DATA).optional(),unread:z.number().int().min(0).max(100),updatedAt:z.number().finite().nonnegative(),changes:z.array(messageChangeSchema).max(MAX_MESSAGE_CHANGES).optional(),tombstones:z.array(tombstoneSchema).max(MAX_TOMBSTONES).optional(),reactions:z.array(messageReactionSchema).max(MAX_REACTIONS).optional(),hidden:z.boolean().optional(),implicit:z.boolean().optional(),archived:z.number().int().nonnegative().optional(),draft:z.string().min(1).max(MAX_TEXT_CHARS).optional()}).strict();
const storedSchema=z.object({version:z.union([z.literal(2),z.literal(3),z.literal(4),z.literal(5),z.literal(6),z.literal(7)]),contacts:z.array(directoryUserSchema).max(MAX_CONTACTS),conversations:z.array(storedConversationSchema).max(MAX_CONTACTS+MAX_GROUPS),pending:z.array(pendingSchema).max(MAX_PENDING_MESSAGES+MAX_PENDING_FILES),verified:z.array(roomIdSchema).max(MAX_CONTACTS).optional(),blocked:z.array(roomIdSchema).max(MAX_CONTACTS).optional(),permissions:z.record(roomIdSchema,z.object({push:z.boolean(),direct:z.boolean()}).strict()).optional()}).strict().refine(state=>state.conversations.reduce((n,c)=>n+c.messages.length,0)<=MAX_HISTORY_MESSAGES,{message:'History capacity exceeded'});
type RequestInput<T=DirectoryClientFrame>=T extends {requestId:string}?Omit<T,'requestId'>:never;
type ReplyType=Exclude<Extract<DirectoryServerFrame,{requestId:string}>['type'],'error'>|'call-state';
export type ReportReason='spam'|'harassment'|'illegal'|'other';
interface Request {expected:ReplyType;resolve:(frame:DirectoryServerFrame)=>void;reject:(e:Error)=>void;timer:ReturnType<typeof setTimeout>;}
interface Pair {session:PeerSession;/** Since when the session has run without a direct path (TURN relay or unknown). */indirectSince?:number;connecting?:Promise<void>;retry?:ReturnType<typeof setTimeout>;attempt:number;flushing:boolean;notified:boolean;lastUsed:number;lastSent:Map<string,number>;definitions:Set<string>;pump?:ReturnType<typeof setTimeout>;}
export class MessengerClient {
  private status:MessengerSnapshot['status']='idle';private self?:DirectoryUser;private error?:string;
  private contacts=new Map<string,DirectoryUser>();private conversations=new Map<string,InternalConversation>();private pending:PendingMessage[]=[];private verified=new Set<string>();private blocked=new Set<string>();private moved=new Map<string,DirectoryUser>();
  private closing=false;private closed=false;private shutdown?:Promise<void>;private activeWork=new Set<Promise<unknown>>();
  private deliverySent?:string;private deliveryProbe?:unknown;private deliveryRefused=false;
  private protectedReceive=new Set<string>();private committed=new Set<string>();private blobs=new Map<string,Uint8Array>();private enqueueQueue=Promise.resolve();private expiryTimer?:ReturnType<typeof setTimeout>;private pairs=new Map<string,Pair>();private socket?:WebSocket;private requests=new Map<string,Request>();private iceRequest?:Promise<RTCIceServer[]>;private wakeTimer?:ReturnType<typeof setTimeout>;private lastWake=new Map<string,number>();private wakeStarted=new Map<string,number>();private pendingCall?:PendingOperation;private outgoingInvitation?:OutgoingInvitation;private pendingIncoming?:PendingIncomingCall;private incomingExpiry?:ReturnType<typeof setTimeout>;private endedCalls=new Map<string,number>();private callStates=new Map<string,CallState>();private services?:ServiceCapabilities;private servicesRequest?:Promise<ServiceCapabilities>;private wakeCapabilitiesRequest?:Promise<ServiceCapabilities>;
  private random:RandomBytes;private stopped=true;private opening?:Promise<void>;private loaded=false;private restorePromise?:Promise<void>;
  private reconnect?:ReturnType<typeof setTimeout>;private attempt=0;private epoch=0;private savedTimer?:ReturnType<typeof setTimeout>;private saveQueue=Promise.resolve();private dirty=false;private cancelOpening?:()=>void;
  private callCaptionListeners=new Set<(frame:CallCaptionFrame)=>void>();
  /** Messages trimmed from memory, waiting to be written to the archive with the next save. */
  private archiveQueue:Array<{key:string;json:string}>=[];
  private permissions=new Map<string,ContactPermissions>();private incoming=new Map<string,MessageRequest>();private dropFrom=new Set<string>();
  private mailboxRefused=new Set<string>();private mailboxPosting?:Promise<void>;private mailboxRepost=false;private mailboxFetching?:Promise<void>;private mailboxRefetch=false;
  private mailboxApp:Array<{to:string;id:string;payload:unknown;expiresAt:number}>=[];private mailboxDefinitions=new Set<string>();private persistFailedAt=0;
  private options: Omit<MessengerOptions, 'inviteCode'>;
  private inviteCode?: string;
  private countryHints?: string[];
  constructor({ inviteCode, countryHints, ...options }: MessengerOptions) {
    validateDeviceIdentity(options.identity);
    usernameSchema.parse(options.username);
    displayNameSchema.parse(options.displayName);
    endpointUrl(options.serverUrl, 'directory');
    this.inviteCode = inviteCodeSchema.optional().parse(inviteCode);
    this.countryHints = countryHints?.length ? countryHintsSchema.parse(countryHints) : undefined;
    this.options = options;
    this.random = options.randomBytes ?? secureRandomBytes;
  }
  private id(){return bytesToHex(randomChecked(this.random,16));}
  /**
   * Snapshots reuse the objects of messages and files that did not change since the last one, and
   * the whole list when nothing in it changed, so a screen can skip work by comparing references:
   * a status tick or a presence change no longer makes the chat rebuild its whole history.
   * Internal records are mutated in place, so each view is keyed by its record plus a stamp of
   * every field (long text by length and ends: an edit also sets `editedAt`).
   */
  private views=new WeakMap<object,{stamp:string;view:unknown}>();
  private lists=new Map<string,readonly unknown[]>();
  private sharedView<T>(record:object,reactions:ReactionView[]|undefined,build:()=>T):T{
    let stamp=reactions?JSON.stringify(reactions):'';
    for(const [key,value] of Object.entries(record)){
      stamp+='|'+key+'=';
      if(value===undefined)continue;
      if(typeof value==='string')stamp+=value.length>64?value.length+':'+value.slice(0,16)+':'+value.slice(-16):value;
      else if(Array.isArray(value))stamp+=value.join(',');
      else if(value instanceof Uint8Array)stamp+='bytes:'+value.byteLength;
      else stamp+=String(value);
    }
    const cached=this.views.get(record);if(cached&&cached.stamp===stamp)return cached.view as T;
    // Shared between snapshots, so frozen: a consumer that mutated one would corrupt the next.
    const view=build();for(const value of Object.values(view as object))if(Array.isArray(value))Object.freeze(value);Object.freeze(view);this.views.set(record,{stamp,view});return view;
  }
  private sharedList<T>(conversationId:string,kind:'messages'|'files',items:T[]):T[]{
    const key=kind+':'+conversationId;const previous=this.lists.get(key) as T[]|undefined;
    if(previous&&previous.length===items.length&&previous.every((item,index)=>item===items[index]))return previous;
    Object.freeze(items);this.lists.set(key,items);return items;
  }
  getSnapshot():MessengerSnapshot {
    const conversations=[...this.conversations.values()].map(c=>{const reactions=this.reactionViews(c);return {id:c.id,kind:c.kind,title:c.title,memberIds:[...c.memberIds],...(c.kind==='group'?{creatorId:c.creatorId,formerIds:c.formerIds?[...c.formerIds]:undefined,removed:c.removed}:{}),messages:this.sharedList(c.id,'messages',c.messages.map(m=>this.sharedView(m,reactions.get('message:'+m.from+':'+m.id),()=>({...m,recipientIds:m.recipientIds?[...m.recipientIds]:undefined,deliveredTo:m.deliveredTo?[...m.deliveredTo]:undefined,readBy:m.readBy?[...m.readBy]:undefined,notifiedTo:m.notifiedTo?[...m.notifiedTo]:undefined,...withReactions(reactions.get('message:'+m.from+':'+m.id))})))),files:this.sharedList(c.id,'files',c.files.map(f=>this.sharedView(f,reactions.get('file:'+f.senderId+':'+f.id),()=>({...f,recipientIds:f.recipientIds?[...f.recipientIds]:undefined,deliveredTo:f.deliveredTo?[...f.deliveredTo]:undefined,readBy:f.readBy?[...f.readBy]:undefined,notifiedTo:f.notifiedTo?[...f.notifiedTo]:undefined,...withReactions(reactions.get('file:'+f.senderId+':'+f.id))})))),unread:c.unread,updatedAt:c.updatedAt,session:c.kind==='direct'?this.pairs.get(c.memberIds.find(id=>id!==this.options.identity.userId)!)?.session.getSnapshot():undefined,...(c.hidden?{hidden:true}:{}),...(c.implicit?{implicit:true}:{}),...(c.archived?{archived:c.archived}:{}),...(c.draft?{draft:c.draft}:{})};});
    let activeCall:MessengerSnapshot['activeCall'];
    for(const [peerId,pair] of this.pairs){const session=pair.session.getSnapshot();if(session.callState!=='idle'){activeCall={conversationId:directConversationId(this.options.identity.userId,peerId),peerId,session};break;}}
    if(!activeCall&&this.pendingIncoming){const incoming=this.pendingIncoming;activeCall={conversationId:incoming.conversationId,peerId:incoming.callerId,session:{status:'connecting',setup:'invitation',callId:incoming.callId,callVideo:incoming.video,callExpiresAt:incoming.expiresAt,messages:[],files:[],stats:{},muted:false,route:'unknown',callState:'incoming'}};}
    if(!activeCall&&this.pendingCall){const op=this.pendingCall;const snapshot=this.pairs.get(op.peerId!)?.session.getSnapshot();activeCall={conversationId:op.conversationId,peerId:op.peerId!,session:{status:'connecting',messages:[],muted:false,route:'unknown',stats:{},files:[],...snapshot,callState:'outgoing',callId:this.outgoingInvitation?.callId,callVideo:this.outgoingInvitation?.video,callExpiresAt:this.outgoingInvitation?.expiresAt}};}
    return {status:this.status,restored:this.loaded,self:this.self?{...this.self}:undefined,contacts:[...this.contacts.values()].map(c=>({...c})),conversations:conversations.sort((a,b)=>b.updatedAt-a.updatedAt),activeCall,pendingIncomingCall:this.pendingIncoming?{...this.pendingIncoming}:undefined,verifiedContacts:[...this.verified],blockedContacts:[...this.blocked],messageRequests:[...this.incoming.values()].map(r=>({user:{...r.user},waiting:r.waiting})),contactPermissions:Object.fromEntries([...this.permissions].map(([id,p])=>[id,{...p}])),movedContacts:Object.fromEntries([...this.moved].map(([id,user])=>[id,{...user}])),error:this.error};
  }
  private emit(){this.options.onChange?.(this.getSnapshot());}
  private report(error:unknown){this.error=error instanceof Error?error.message:'Messenger operation failed';this.emit();}
  private changed(){if(this.closed)return;this.trimHistory();this.dirty=true;this.scheduleSave();this.emit();}
  private recordWriter?:LocalRecordWriter;private migrating=false;
  private persistent(){return !!(this.options.records||this.options.saveState);}
  private scheduleSave(){if(this.closing||!this.persistent()||this.savedTimer)return;this.savedTimer=setTimeout(()=>{this.savedTimer=undefined;void this.persist().catch(error=>this.report(error));},250);}
  private stored(){return {version:7,contacts:[...this.contacts.values()].map(c=>({...c,online:false})),conversations:[...this.conversations.values()].map(c=>({id:c.id,kind:c.kind,title:c.title,memberIds:c.memberIds,creatorId:c.creatorId,formerIds:c.formerIds,removed:c.removed,notifyRemoved:c.notifyRemoved,joinedAt:c.joinedAt,definition:c.definition,receipts:c.receipts,readReceipts:c.readReceipts,messages:c.messages,files:c.files.map(({data:_data,...f})=>f),unread:c.unread,updatedAt:c.updatedAt,changes:c.changes,tombstones:c.tombstones,reactions:c.reactions,hidden:c.hidden,implicit:c.implicit,archived:c.archived,draft:c.draft})),pending:this.pending,verified:[...this.verified],blocked:[...this.blocked],...(this.permissions.size?{permissions:Object.fromEntries(this.permissions)}:{})};}
  private records(){return this.recordWriter??=localRecordWriter(this.options.records!,this.options.identity,this.random);}
  private async persist():Promise<void>{
    if(!this.dirty||!this.persistent())return this.saveQueue;
    if(this.options.whenIdle){try{await this.options.whenIdle();}catch{/* Save anyway. */}if(!this.dirty)return this.saveQueue;}
    this.dirty=false;
    const state=storedSchema.parse(this.stored());
    const failed=(error:unknown)=>{this.dirty=true;this.persistFailedAt=Date.now();this.report(new Error('Local encrypted state could not be saved'));throw error;};
    if(this.options.records){
      // Only records that changed since the last successful write are encrypted and written.
      const writer=this.records();const archive=this.archiveQueue;this.archiveQueue=[];
      this.saveQueue=this.saveQueue.catch(()=>{}).then(async()=>{
        try{await writer.write(state,archive);}catch(error){this.archiveQueue=[...archive,...this.archiveQueue];throw error;}
        if(this.migrating){this.migrating=false;await this.options.clearLegacyState?.().catch(()=>{/* The records are the history now; the old file is ignored. */});}
      }).catch(failed);
      return this.saveQueue;
    }
    const sealed=sealLocalState(this.options.identity,state,this.random);
    this.saveQueue=this.saveQueue.catch(()=>{}).then(()=>this.options.saveState!(sealed)).catch(failed);return this.saveQueue;
  }
  private async restore(){
    if(this.loaded)return;if(this.restorePromise)return this.restorePromise;
    this.restorePromise=(async()=>{
      let raw:unknown;
      if(this.options.records){
        raw=await this.records().read();
        // First start with record storage: the history still sits in the old single sealed file.
        if(raw===null){const sealed=await this.options.loadState?.();if(sealed){raw=openLocalState(this.options.identity,sealed);this.migrating=true;}}
      }else{const sealed=await this.options.loadState?.();if(sealed)raw=openLocalState(this.options.identity,sealed);}
      if(raw===null||raw===undefined){this.loaded=true;return;}
      const state=storedSchema.parse(raw);const own=this.options.identity.userId;
      const contacts=new Map<string,DirectoryUser>();for(const c of state.contacts){if(c.userId===own||contacts.has(c.userId))throw new Error('Invalid stored contacts');contacts.set(c.userId,{...c,online:false});}
      const conversations=new Map<string,InternalConversation>();
      for(const c of state.conversations){
        const known=new Set([...c.memberIds,...(c.formerIds??[])]);
        if(conversations.has(c.id)||new Set(c.memberIds).size!==c.memberIds.length||!c.memberIds.includes(own)||[...known].some(id=>id!==own&&!contacts.has(id))||(c.memberIds.length<2&&!c.removed))throw new Error('Invalid stored membership');
        if(c.kind==='direct'&&(c.memberIds.length!==2||c.id!==directConversationId(c.memberIds[0]!,c.memberIds[1]!)))throw new Error('Invalid direct conversation');
        if(c.kind==='group'&&(!c.id.startsWith('group:')||!c.creatorId||!known.has(c.creatorId)))throw new Error('Invalid stored group');
        if(c.messages.some(m=>m.conversationId!==c.id||!known.has(m.from)))throw new Error('Invalid stored sender');
        for(const record of [...c.messages,...(c.files??[])])if(record.readBy?.some(id=>!record.recipientIds?.includes(id)||!known.has(id)))throw new Error('Invalid stored readers');
        // Signatures were verified when each item arrived; the sealed state is authenticated by this device's own key,
        // so re-verifying hundreds of Ed25519 signatures here only kept the app on a blank screen for seconds (JS, no JIT).
        for(const receipt of c.readReceipts??[]){const key=receipt.reader===own?this.options.identity.publicKey:contacts.get(receipt.reader)?.publicKey;if(receipt.conversationId!==c.id||!known.has(receipt.author)||!known.has(receipt.reader)||!key)throw new Error('Invalid stored read receipt');}
        for(const change of c.changes??[]){const key=change.author===own?this.options.identity.publicKey:contacts.get(change.author)?.publicKey;if(change.conversationId!==c.id||!known.has(change.author)||!key)throw new Error('Invalid stored message change');}
        for(const reaction of c.reactions??[]){const key=reaction.reactor===own?this.options.identity.publicKey:contacts.get(reaction.reactor)?.publicKey;if(reaction.conversationId!==c.id||!known.has(reaction.author)||!known.has(reaction.reactor)||!key)throw new Error('Invalid stored reaction');}
        conversations.set(c.id,{...c,files:(c.files??[]).map(f=>({...f})),messages:c.messages.map(m=>({...m,expiresAt:m.expiresAt??m.timestamp+OUTBOX_TTL_MS,status:m.from===own&&m.status!=='delivered'&&m.status!=='expired'?'pending':m.status}))});
      }
      if([...conversations.values()].filter(c=>c.kind==='group').length>MAX_GROUPS)throw new Error('Group capacity exceeded');
      for(const pending of state.pending){const c=conversations.get(pending.conversationId);if(!c||!(pending.type==='file'?c.files.some(f=>f.id===pending.messageId&&f.senderId===(pending.author??own)):c.messages.some(m=>m.id===pending.messageId&&m.from===(pending.author??own)))||new Set(pending.remaining).size!==pending.remaining.length||pending.remaining.some(id=>id===own||!c.memberIds.includes(id)))throw new Error('Invalid stored outbox');}
      if(state.verified?.some(id=>!contacts.has(id)))throw new Error('Invalid stored verification');
      if(new Set(state.blocked??[]).size!==(state.blocked?.length??0)||state.blocked?.some(id=>!contacts.has(id)))throw new Error('Invalid stored blocks');
      for(const id of Object.keys(state.permissions??{}))if(!contacts.has(id))throw new Error('Invalid stored permissions');
      this.permissions=new Map(Object.entries(state.permissions??{}));
      this.contacts=contacts;this.verified=new Set(state.verified??[]);this.blocked=new Set(state.blocked??[]);this.conversations=conversations;this.pending=state.pending.map(p=>{const c=conversations.get(p.conversationId)!;const item=p.type==='file'?c.files.find(f=>f.id===p.messageId)!:c.messages.find(m=>m.id===p.messageId)!;return {...p,type:p.type??'message',author:p.author??own,createdAt:p.createdAt??item.timestamp,expiresAt:p.expiresAt??item.timestamp+OUTBOX_TTL_MS};});
      for(const p of this.pending)this.committed.add(this.pendingKey(p));this.loaded=true;await this.expirePending();
      if(this.migrating){this.dirty=true;this.scheduleSave();}
      this.emit();
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
            this.directorySend({type:'authenticate',publicKey:this.options.identity.publicKey,username:this.options.username,displayName:this.options.displayName,signature:signAuthentication(this.options.identity,frame.challenge,this.options.username,this.options.displayName),...(this.options.emailProof?{emailProof:this.options.emailProof}:{}),...(this.options.phoneProof?{phoneProof:this.options.phoneProof}:{}),...(this.inviteCode?{inviteCode:this.inviteCode}:{}),...(this.countryHints?{countryHints:this.countryHints}:{})});
          }else if(frame.type==='ready'){
            if(!challenged||ready||frame.self.userId!==this.options.identity.userId||frame.self.publicKey!==this.options.identity.publicKey)throw new Error('Directory identity mismatch');
            this.inviteCode = undefined;this.countryHints = undefined;
            ready=true;this.deliverySent=undefined;this.services=undefined;this.servicesRequest=undefined;this.wakeCapabilitiesRequest=undefined;this.self=frame.self;this.status='online';this.attempt=0;this.error=undefined;this.mailboxRefused.clear();this.mailboxDefinitions.clear();finish();this.watch();this.wakePending();this.emit();
            void this.startMailbox();
            void this.refreshContacts().catch(e=>this.report(e));
          }else if(frame.type==='error'){
            const request=frame.requestId?this.requests.get(frame.requestId):undefined;
            // A server without this feature rejects the field and closes; ask without it after the reconnect.
            if(!request&&frame.code==='invalid-frame'&&this.deliveryProbe===socket){this.deliveryRefused=true;return;}
            if(request){clearTimeout(request.timer);this.requests.delete(frame.requestId!);request.reject(request.expected.startsWith('invite-') ? new InviteRequestError(frame.code, frame.message) : new Error(frame.message));}
            else if(!ready){if(['username-taken','auth-failed','auth-expired','session-replaced','device-already-registered','email-required','email-taken','account-moved','invite-required','invite-invalid','registration-closed'].includes(frame.code)){this.stopped=true;this.status='error';this.report(new Error(`${frame.code}: ${frame.message}`));}finish(new Error(`${frame.code}: ${frame.message}`));socket.close();}
            else if(frame.code==='session-replaced'||frame.code==='device-already-registered'||frame.code==='account-moved'||frame.code==='email-required'||frame.code==='email-taken'){this.stopped=true;this.status='error';this.report(new Error(frame.code==='session-replaced'?'This identity connected on another client':frame.code==='device-already-registered'?'This device is already registered on this server; resolve its existing profile':`${frame.code}: ${frame.message}`));socket.close();}
            else if(frame.code!=='peer-offline'&&(frame.requestId!==undefined||!['wake-expired','wake-not-allowed','provider-failed','service-rate-limit','service-busy','service-unavailable'].includes(frame.code)))this.report(new Error(frame.message));
          }else {
            if(!ready)throw new Error('Directory message before authentication');
            if(frame.type==='call-state'){this.handleCallState(frame);if(frame.requestId){const request=this.requests.get(frame.requestId);if(request){clearTimeout(request.timer);this.requests.delete(frame.requestId);if(request.expected!=='call-state')request.reject(new Error('Unexpected directory response type'));else request.resolve(frame);}}}
            else if(frame.type==='mailbox-available'){void this.fetchMailbox().catch(()=>{/* Fetched again on the next nudge or connection. */});}
            else if(frame.type==='call-invitation'){const h=callPushEnvelopeSchema.parse(JSON.parse(frame.invite));void this.openCallPush(frame.invite,{kind:'call',intentId:h.callId,expiresAt:h.expiresAt}).catch(e=>this.report(e));}
            else if('requestId' in frame){const request=this.requests.get(frame.requestId);if(request){clearTimeout(request.timer);this.requests.delete(frame.requestId);if(frame.type!==request.expected)request.reject(new Error('Unexpected directory response type'));else request.resolve(frame);}}
            else if(frame.type==='identity-moved'){this.identityMoved(frame.oldUserId,frame.user);}
            else if(frame.type==='presence'){this.updateContact(frame.user);if(frame.user.online)this.wakePeer(frame.user.userId);this.changed();}
            else if(frame.type==='connect'){
              // A connection request: only a contact who may connect directly gets WebRTC (and so the IP address); a stranger becomes a message request.
              const id=frame.from.userId;
              if(!this.blocked.has(id)&&!this.contacts.has(id)){this.addRequest(frame.from,0);this.emit();}
              else if(this.allowsDirect(id)){this.remember(frame.from);this.ensureDirect(frame.from,true);void this.ensurePair(id,false).catch(e=>this.report(e));this.watch();this.changed();}
            }
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
    if(!this.servicesRequest){const socket=this.socket;const request=(this.deliveryProbe=this.deliveryRefused?undefined:socket,this.requestFrame({type:'services',callInviteV1:true,...(this.deliveryRefused?{}:{deliveryV1:true,...(this.options.mailbox?{mailboxV1:true as const}:{}),...(this.options.onEndpoints?{endpointsV1:true as const}:{})})},'services')).then(frame=>{const capabilities={...frame.capabilities};if(this.socket===socket&&this.status==='online')this.services=capabilities;if(capabilities.endpoints?.length)try{this.options.onEndpoints?.(capabilities.endpoints);}catch{/* storing the list is best effort */}return capabilities;});this.servicesRequest=request;
      void request.finally(()=>{if(this.servicesRequest===request)this.servicesRequest=undefined;}).catch(()=>{});
    }
    return {...await this.servicesRequest};
  }
  async startPhoneVerification(phone:string):Promise<PhoneChallenge>{return (await this.requestFrame({type:'phone-start',phone:normalizePhone(phone,'RU')},'phone-challenge')).challenge;}
  async verifyPhone(challengeId:string,code:string):Promise<void>{await this.requestFrame({type:'phone-verify',challengeId,code},'phone-verified');if(this.services)this.services={...this.services,phoneVerified:true};}
  async discoverPhones(hashes:string[]):Promise<PhoneMatch[]>{return (await this.requestFrame({type:'phone-discover',hashes},'phone-matches')).matches;}
  /** The masked number linked to this account (if any) and who may find it. */
  async phoneState():Promise<{phone?:string;visibility:PhoneVisibility}>{const {phone,visibility}=await this.requestFrame({type:'phone-state-get'},'phone-state');return {...(phone?{phone}:{}),visibility};}
  async setPhoneVisibility(visibility:PhoneVisibility):Promise<{phone?:string;visibility:PhoneVisibility}>{const reply=await this.requestFrame({type:'phone-visibility',visibility},'phone-state');return {...(reply.phone?{phone:reply.phone}:{}),visibility:reply.visibility};}
  /** Contact search: numbers in batches of 500; the server keeps none of them. */
  async findByPhones(phones:string[]):Promise<Array<{phone:string;user:DirectoryUser}>>{
    const unique=[...new Set(phones)];const found:Array<{phone:string;user:DirectoryUser}>=[];
    for(let index=0;index<unique.length;index+=500)found.push(...(await this.requestFrame({type:'phone-find',phones:unique.slice(index,index+500)},'phone-found')).matches.map(match=>({phone:match.phone,user:{...match.user}})));
    return found;
  }
  async accessRequests():Promise<AccessRequest[]>{return (await this.requestFrame({type:'access-list'},'access-requests')).requests.map(request=>({...request}));}
  async decideAccess(id:string,approve:boolean):Promise<void>{await this.requestFrame({type:'access-decide',id,approve},'access-decided');}
  async deleteAccount():Promise<void>{await this.requestFrame({type:'delete-account'},'account-deleted');this.stopped=true;}
  async getInviteStatus(): Promise<InviteStatus> {
    const { isAdmin, canInvite, remaining, resetAt, active, granted } = await this.requestFrame({ type: 'invite-status' }, 'invite-status');
    return { isAdmin, canInvite, remaining, resetAt, active, granted };
  }
  async createInvite(): Promise<CreatedInvite> {
    const { id, code, expiresAt } = await this.requestFrame({ type: 'invite-create' }, 'invite-created');
    return { id, code, expiresAt };
  }
  async revokeInvite(inviteId: string): Promise<void> {
    await this.requestFrame({ type: 'invite-revoke', inviteId }, 'invite-updated');
  }
  async grantInvites(username: string, enabled: boolean): Promise<void> {
    await this.requestFrame({ type: 'invite-grant', username, enabled }, 'invite-updated');
  }
  async registerPushToken(token:string,backgroundSync=false,messagePreview=false,callInviteV1=false,deliveryV1=false):Promise<void>{if(typeof backgroundSync!=='boolean'||typeof messagePreview!=='boolean'||typeof callInviteV1!=='boolean'||typeof deliveryV1!=='boolean')throw new Error('Invalid push capability mode');await this.requestFrame({type:'push-register',token,...(backgroundSync?{backgroundSync:true}:{}),...(messagePreview?{messagePreview:true}:{}),...(callInviteV1?{callInviteV1:true}:{}),...(deliveryV1?{deliveryV1:true}:{})},'push-registered');}
  /** Decrypt notification copy without inserting chat history or acknowledging delivery. */
  openPushPreview(envelope:string,intent:WakeIntent):Promise<OpenedPushPreview>{this.assertActive();return this.track(this.openPushPreviewWork(envelope,intent));}
  private async openPushPreviewWork(envelope:string,intent:WakeIntent):Promise<OpenedPushPreview>{
    await this.restore();this.assertActive();const header=pushPreviewEnvelopeSchema.parse(JSON.parse(pushPreviewSchema.parse(envelope)));
    const contact=this.contacts.get(header.senderId);if(!contact)throw new Error('Unknown push preview sender');
    const preview=decryptPushPreview(this.options.identity,contact.publicKey,envelope,intent);
    const c=this.conversations.get(preview.conversationId);if(!c||!c.memberIds.includes(preview.senderId)||!c.memberIds.includes(this.options.identity.userId))throw new Error('Unknown push preview conversation or membership');
    return {...preview,displayName:contact.displayName};
  }
  /** Await encrypted state writes without shutting down an active transport. */
  flushState():Promise<void>{this.assertActive();return this.track(this.flushStateWork());}
  private async flushStateWork():Promise<void>{await this.restore();await this.persist();await this.saveQueue;}
  async getIceServers():Promise<RTCIceServer[]>{
    if(!this.iceRequest){const request=this.requestFrame({type:'ice'},'ice').then(frame=>iceServersSchema.parse(frame.iceServers));this.iceRequest=request;
      void request.finally(()=>{if(this.iceRequest===request)this.iceRequest=undefined;}).catch(()=>{});
    }
    const servers=await this.iceRequest;return servers.map(server=>({...server,urls:Array.isArray(server.urls)?[...server.urls]:server.urls}));
  }
  private now(){return performance.now();}
  private wakeKey(peerId:string,kind:WakeKind,pending?:PendingMessage){return pending?`preview:${peerId}:${this.pendingKey(pending)}`:(kind==='call'?'call:':'data:')+peerId;}
  private async sendWake(peerId:string,kind:WakeKind,remaining:number,valid:()=>boolean,pending?:PendingMessage):Promise<void>{
    if(this.stopped||this.status!=='online'||remaining<=0)return;
    const began=this.now();
    try{
      const socket=this.socket;const capabilities=await this.getServices();
      remaining-=this.now()-began;
      if(this.socket!==socket||this.stopped||this.status!=='online'||!capabilities.push||remaining<=0||!valid())return;
      const key=this.wakeKey(peerId,kind,pending);const now=this.now();const previous=this.lastWake.get(key);
      if(previous!==undefined&&now-previous<30000)return;
      const intent:WakeIntent={kind,intentId:this.id(),expiresAt:Date.now()+Math.max(1,Math.ceil(Math.min(kind==='call'?30000:60000,remaining)))};
      // No message text rides in a push any more, not even encrypted: the phone fetches its mailbox and says only who wrote.
      const preview:string|undefined=undefined;
      this.directorySend({type:'wake',to:peerId,...intent,...(preview?{preview}:{})});
      this.lastWake.set(key,now);if(pending&&(kind==='message'||kind==='file'))this.markNotified([peerId],pending);
    }catch{/* Optional wake failures never mark content delivered or fail direct delivery. */}
  }
  /** The single tick: a push request for these recipients was handed to the server over a live socket. Display only — never counts as delivery. */
  private markNotified(peerIds:string[],only?:PendingMessage){
    const own=this.options.identity.userId;let touched=false;
    for(const p of only?[only]:this.pending){
      if((p.author??own)!==own||!this.committed.has(this.pendingKey(p)))continue;
      const peers=p.remaining.filter(id=>peerIds.includes(id));if(!peers.length)continue;
      const c=this.conversations.get(p.conversationId);
      const record=p.type==='file'?c?.files.find(f=>f.id===p.messageId&&f.senderId===own):c?.messages.find(m=>m.id===p.messageId&&m.from===own);
      if(!record)continue;
      const next=[...new Set([...(record.notifiedTo??[]),...peers])];
      if(next.length!==(record.notifiedTo?.length??0)){record.notifiedTo=next;touched=true;}
    }
    if(touched)this.changed();
  }
  /** Replaces the server's list of this phone's waiting peers. Unchanged lists are not resent; every new socket resends. */
  private async syncDelivery(waiting:Map<string,number>):Promise<void>{
    if(this.stopped||this.status!=='online')return;
    // An empty list still clears what a previous run left behind, but only a real app needs that round trip.
    if(!waiting.size&&!this.services&&!this.options.reconcileDeliveryOnConnect)return;
    const socket=this.socket;
    const peers=[...waiting].sort(([a],[b])=>a<b?-1:1).slice(0,MAX_DELIVERY_PEERS).map(([to,expiresAt])=>({to,expiresAt}));
    try{
      const capabilities=await this.getServices();
      if(this.socket!==socket||this.stopped||this.status!=='online'||!capabilities.deliveryV1)return;
      const body=JSON.stringify(peers);if(this.deliverySent===body)return;
      this.directorySend({type:'delivery-sync',peers});this.deliverySent=body;this.markNotified(peers.map(peer=>peer.to));
    }catch{/* The next change or reconnect resends the whole list. */}
  }
  private wakePending():void {
    clearTimeout(this.wakeTimer);this.wakeTimer=undefined;
    const entries=this.pending.filter(p=>this.committed.has(this.pendingKey(p))&&Date.now()<(p.expiresAt??Infinity)).flatMap(p=>p.remaining.filter(peerId=>!this.viaMailbox(p,peerId)).map(peerId=>({p,peerId,kind:(p.type==='file'?'file':'message') as WakeKind,key:this.wakeKey(peerId,p.type==='file'?'file':'message',p)})));
    const keys=new Set(entries.map(entry=>entry.key));
    for(const key of this.wakeStarted.keys())if(!keys.has(key))this.wakeStarted.delete(key);
    for(const key of this.lastWake.keys())if(key.startsWith('preview:')&&!keys.has(key))this.lastWake.delete(key);
    const now=this.now();for(const key of keys)if(!this.wakeStarted.has(key))this.wakeStarted.set(key,now);
    // A peer counts only after the direct-first grace, so an instant ACK leaves no trace on the server.
    const waiting=new Map<string,number>();
    for(const {p,peerId,key} of entries)if(now-this.wakeStarted.get(key)!>=2500)waiting.set(peerId,Math.max(waiting.get(peerId)??0,p.expiresAt??Date.now()+OUTBOX_TTL_MS));
    void this.syncDelivery(waiting);
    if(this.stopped||this.status!=='online'||!entries.length)return;
    let delay=30000;
    for(const {p,peerId,kind,key} of entries){
      const grace=2500-(now-this.wakeStarted.get(key)!);
      const previous=this.lastWake.get(key);const cooldown=previous===undefined?0:30000-(now-previous);
      const due=Math.max(grace,cooldown);
      if(due<=0)void this.sendWake(peerId,kind,Math.min(60000,(p.expiresAt??Date.now()+60000)-Date.now()),()=>this.pending.includes(p)&&p.remaining.includes(peerId)&&Date.now()<(p.expiresAt??Infinity),p);
      else delay=Math.min(delay,Math.max(500,due));
    }
    this.wakeTimer=setTimeout(()=>this.wakePending(),delay);
  }
  async search(query:string):Promise<DirectoryUser[]>{return this.request('search',query.normalize('NFKC').trim().replace(/^@/,'').trim().toLowerCase());}
  async listUsers(cursor?:string):Promise<DirectoryPage>{const frame=await this.requestFrame({type:'list-users',...(cursor!==undefined?{cursor}: {})},'users-page');return {users:frame.users.map(user=>({...user})),...(frame.nextCursor!==undefined?{nextCursor:frame.nextCursor}: {})};}
  /** Every contact is watched (presence, moved keys); only those neither blocked nor limited may wake this phone (pushes, calls). */
  private watch(){if(this.status!=='online')return;const userIds=[...this.contacts.keys()];const consent=userIds.filter(id=>this.allowsPush(id));this.directorySend({type:'watch',userIds,identityMovedV1:true,...(consent.length!==userIds.length?{consent}:{})});}
  private allowsPush(id:string){return !this.blocked.has(id)&&(this.permissions.get(id)?.push??true);}
  private allowsDirect(id:string){return !this.blocked.has(id)&&(this.permissions.get(id)?.direct??true);}
  private addRequest(user:DirectoryUser,waiting:number){
    if(this.blocked.has(user.userId)||this.contacts.has(user.userId)||user.userId===this.options.identity.userId)return;
    const known=this.incoming.get(user.userId);if(!known&&this.incoming.size>=MAX_CONTACTS)return;
    this.incoming.set(user.userId,{user:{...user,online:false},waiting:(known?.waiting??0)+waiting});
  }
  /** Accepting makes them a contact with the chosen permissions, then opens what waited on the server. */
  async acceptRequest(userId:string,permissions:ContactPermissions={push:true,direct:true}):Promise<string>{
    await this.restore();this.assertActive();const request=this.incoming.get(userId);if(!request)throw new Error('Unknown message request');
    this.remember(request.user);const c=this.ensureDirect(request.user);c.hidden=undefined;c.implicit=undefined;
    if(!permissions.push||!permissions.direct)this.permissions.set(userId,{push:permissions.push,direct:permissions.direct});else this.permissions.delete(userId);
    this.incoming.delete(userId);this.watch();await this.durable();
    void this.fetchMailbox().catch(()=>{});
    if(permissions.direct&&request.user.online&&this.status==='online')void this.ensurePair(userId,false).catch(e=>this.report(e));
    return c.id;
  }
  /** Declining drops what they sent (the server deletes it; they never see it as delivered). They may write again later. */
  async declineRequest(userId:string):Promise<void>{
    await this.restore();this.assertActive();if(!this.incoming.delete(userId))return;this.emit();
    this.dropFrom.add(userId);try{await this.fetchMailbox();}finally{this.dropFrom.delete(userId);}
  }
  /** Blocking a request drops what waits and refuses them from now on, before any connection or write. */
  async blockRequest(userId:string):Promise<void>{
    await this.restore();this.assertActive();const request=this.incoming.get(userId);if(!request)throw new Error('Unknown message request');
    this.remember(request.user);this.incoming.delete(userId);this.blocked.add(userId);this.watch();await this.durable();
    this.dropFrom.add(userId);try{await this.fetchMailbox();}finally{this.dropFrom.delete(userId);}
  }
  async setContactPermissions(userId:string,permissions:ContactPermissions):Promise<void>{
    await this.restore();this.assertActive();if(!this.contacts.has(userId))throw new Error('Unknown contact');
    if(!permissions.push||!permissions.direct)this.permissions.set(userId,{push:permissions.push,direct:permissions.direct});else this.permissions.delete(userId);
    if(!permissions.direct)this.closePair(userId);
    this.watch();await this.durable();
  }
  private closePair(userId:string){const pair=this.pairs.get(userId);if(!pair)return;clearTimeout(pair.retry);clearTimeout(pair.pump);this.pairs.delete(userId);try{pair.session.disconnect();}catch{/* already closed */}}
  private refreshContacts(){return this.track(this.refreshContactsWork());}
  private async refreshContactsWork(){if(!this.contacts.size)return;const users=await this.request('lookup',[...this.contacts.keys()]);if(this.closing)return;for(const user of users)this.updateContact(user);this.changed();for(const user of users)if(user.online)this.wakePeer(user.userId);}
  private updateContact(user:DirectoryUser){const old=this.contacts.get(user.userId);if(old){if(old.publicKey!==user.publicKey)throw new Error('Pinned contact key changed');this.contacts.set(user.userId,user);if(old.online!==user.online){const pair=this.pairs.get(user.userId);if(pair)pair.notified=false;}const c=this.conversations.get(directConversationId(this.options.identity.userId,user.userId));if(c)c.title=user.displayName;}}
  private remember(user:DirectoryUser){directoryUserSchema.parse(user);if(user.userId===this.options.identity.userId)throw new Error('Cannot add self');if(!this.contacts.has(user.userId)&&this.contacts.size>=MAX_CONTACTS)throw new Error('Contact capacity exceeded');this.contacts.set(user.userId,{...user});}
  private ensureDirect(user:DirectoryUser,inbound=false):InternalConversation {
    const id=directConversationId(this.options.identity.userId,user.userId);let c=this.conversations.get(id);
    if(!c){c={id,kind:'direct',title:user.displayName,memberIds:[this.options.identity.userId,user.userId].sort(),messages:[],files:[],unread:0,updatedAt:Date.now(),...(inbound?{hidden:true,implicit:true}:{})};this.conversations.set(id,c);}return c;
  }
  async addContact(user:DirectoryUser):Promise<string>{this.assertActive();return this.track(this.addContactWork(user));}
  async markContactVerified(userId:string):Promise<void>{await this.restore();this.assertActive();if(!this.contacts.has(userId))throw new Error('Unknown contact');this.verified.add(userId);this.changed();}
  async blockContact(userId:string):Promise<void>{await this.restore();this.assertActive();if(!this.contacts.has(userId))throw new Error('Unknown contact');if(this.blocked.has(userId))return;this.blocked.add(userId);if(this.pendingIncoming?.callerId===userId)this.clearPendingIncoming(true);const active=this.getSnapshot().activeCall;if(active?.peerId===userId)this.endCall();const moved=this.moved.get(userId);if(moved){this.moved.delete(userId);this.blockMoved(moved);}this.closePair(userId);this.watch();this.changed();}
  /** The new key is unconfirmed: never migrate the old chat, its verification or its queue. */
  async acceptMovedContact(oldUserId:string):Promise<string>{await this.restore();this.assertActive();const user=this.moved.get(oldUserId);if(!user)throw new Error('Unknown moved contact');return this.track(this.addContactWork(user));}
  private identityMoved(oldUserId:string,user:DirectoryUser){
    if(!this.contacts.has(oldUserId)||oldUserId===this.options.identity.userId||user.userId===this.options.identity.userId||user.userId===oldUserId)return;
    if(this.blocked.has(oldUserId)){this.moved.delete(oldUserId);if(this.blockMoved(user))this.changed();return;}
    this.moved.set(oldUserId,{...user});this.emit();
  }
  /** Persisted blocks must name a known contact, so the block needs a contact slot. At capacity a new sender cannot be added at all. */
  private blockMoved(user:DirectoryUser):boolean{
    if(this.blocked.has(user.userId))return false;
    if(!this.contacts.has(user.userId)&&this.contacts.size>=MAX_CONTACTS)return false;
    this.remember(user);this.blocked.add(user.userId);return true;
  }
  async unblockContact(userId:string):Promise<void>{await this.restore();this.assertActive();if(this.blocked.delete(userId)){this.watch();this.changed();}}
  /** Sends report metadata to the authenticated directory; message content is never included. */
  async reportContent(input:{targetId:string;targetKind:'user'|'group';conversationId?:string;reason:ReportReason;details?:string}):Promise<void>{await this.restore();this.assertActive();if(input.targetKind==='user'&&!this.contacts.has(input.targetId))throw new Error('Unknown contact');if(input.targetKind==='group'){const c=this.conversations.get(input.targetId);if(!c||c.kind!=='group')throw new Error('Unknown group');}await this.requestFrame({type:'report',...input},'report-received');}
  private async addContactWork(user:DirectoryUser):Promise<string>{await this.restore();this.remember(user);const c=this.ensureDirect(user);c.hidden=undefined;c.implicit=undefined;this.watch();this.changed();if(user.online&&this.status==='online')void this.ensurePair(user.userId,true).catch(e=>this.report(e));return c.id;}
  private validConversation(peerId:string,conversationId:string|undefined){if(!conversationId)return false;const c=this.conversations.get(conversationId);return !!c&&c.memberIds.includes(peerId)&&c.memberIds.includes(this.options.identity.userId);}
  private async ensurePair(peerId:string,notify:boolean):Promise<Pair>{
    if(this.stopped)throw new Error('Messenger is disconnected');const user=this.contacts.get(peerId);if(!user)throw new Error('Unknown contact');
    if(!this.allowsDirect(peerId))throw new Error(this.blocked.has(peerId)?'Contact is blocked':'Direct connection with this contact is turned off');
    let pair=this.pairs.get(peerId);
    if(!pair){
      if(this.pairs.size>=MAX_SESSIONS){const idle=[...this.pairs.entries()].filter(([id,p])=>!p.flushing&&!p.connecting&&p.session.getSnapshot().callState==='idle'&&!p.session.getSnapshot().files.some(f=>f.status==='sending'||f.status==='receiving')&&!this.pending.some(m=>m.remaining.includes(id))).sort((a,b)=>a[1].lastUsed-b[1].lastUsed)[0];if(!idle)throw new Error('Active peer capacity exceeded (16)');this.pairs.delete(idle[0]);clearTimeout(idle[1].retry);clearTimeout(idle[1].pump);idle[1].session.disconnect();}
      const session=new PeerSession({serverUrl:this.options.serverUrl,expectPeer:true,getIceServers:()=>this.getIceServers(),invite:conversationInvite(this.options.identity,user.publicKey),callCaptions:this.options.callCaptions,contentIdentity:this.options.identity,remoteIdentityPublicKey:user.publicKey,randomBytes:this.random,rtcFactory:this.options.rtcFactory,getUserMedia:this.options.getUserMedia,createMediaStream:this.options.createMediaStream,onChange:snapshot=>this.pairChanged(peerId,snapshot),onMessage:message=>this.receiveMessage(peerId,message),onApplication:payload=>this.receiveApplication(peerId,payload),onFile:file=>this.receiveFile(peerId,file),allowConversation:id=>this.validConversation(peerId,id),...(this.options.bulkFiles?{onBulkOffer:offer=>this.receiveBulkOffer(peerId,offer),onBulkProgress:(id,bytes,direction)=>this.bulkProgress(peerId,id,bytes,direction)}:{})});
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
  private wakePeer(peerId:string){if(!this.allowsDirect(peerId))return;const needs=[...this.conversations.values()].some(c=>c.readReceipts?.some(r=>r.author===peerId))||this.pending.some(m=>m.remaining.includes(peerId)&&!this.viaMailbox(m,peerId))||this.pairs.has(peerId)||[...this.conversations.values()].some(c=>c.kind==='group'&&c.memberIds.includes(peerId))||[...this.conversations.values()].some(c=>c.memberIds.includes(peerId)&&(c.changes?.some(x=>x.author===this.options.identity.userId&&Date.now()<x.expiresAt)||c.reactions?.some(x=>x.reactor===this.options.identity.userId&&Date.now()<x.expiresAt)));if(needs)void this.ensurePair(peerId,true).then(()=>this.flushPeer(peerId)).catch(e=>this.report(e));}
  private pairChanged(peerId:string,snapshot:SessionSnapshot){
    const pair=this.pairs.get(peerId);if(!pair)return;
    if(snapshot.callState==='incoming'){if(this.blocked.has(peerId)){pair.session.rejectCall();return;}const key=peerId+':'+snapshot.callId;const ended=this.endedCalls.get(key);if(ended&&Date.now()<ended){pair.session.rejectCall();return;}const invitation=this.pendingIncoming;if(invitation&&(invitation.callerId!==peerId||invitation.callId!==snapshot.callId||invitation.video!==snapshot.callVideo||invitation.expiresAt!==snapshot.callExpiresAt)){pair.session.rejectCall();return;}}
    const outgoing=this.outgoingInvitation;if(outgoing?.peerId===peerId&&outgoing.sessionStarted&&snapshot.callState==='idle')queueMicrotask(()=>{if(this.outgoingInvitation===outgoing)this.endCall();});if(outgoing?.peerId===peerId&&snapshot.callId===outgoing.callId){if(snapshot.callRinging||snapshot.callState==='active'){outgoing.ringing=true;clearTimeout(outgoing.timer);}if(snapshot.callState==='active')clearTimeout(outgoing.expiry);}
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
  private async putBlob(key:string,data:Uint8Array){
    if(this.options.savePlainAttachment)await this.options.savePlainAttachment(key,data);
    else{if(this.persistent()&&!this.options.saveAttachment)throw new Error('Attachment storage is unavailable');if(this.options.saveAttachment)await this.options.saveAttachment(key,sealAttachment(this.options.identity,key,data,this.random));}
    this.blobs.set(key,data.slice());
  }
  async getFileData(conversationId:string,fileId:string,senderId?:string):Promise<Uint8Array|null>{await this.restore();const file=this.conversations.get(conversationId)?.files.find(f=>f.id===fileId&&(!senderId||f.senderId===senderId));if(!file?.blobKey)return null;const cached=this.blobs.get(file.blobKey);if(cached)return cached.slice();const plain=await this.options.loadPlainAttachment?.(file.blobKey);if(plain){this.blobs.set(file.blobKey,plain);return plain.slice();}const sealed=await this.options.loadAttachment?.(file.blobKey);if(!sealed)return null;const data=openAttachment(this.options.identity,file.blobKey,sealed);this.blobs.set(file.blobKey,data);return data.slice();}
  private fileCapacity(size:number,outgoing=false){
    if(outgoing&&this.pending.filter(p=>p.type==='file').length>=MAX_PENDING_FILES)throw new Error('Local file outbox is full (16 files waiting for delivery); waiting content was preserved');
    const files=[...this.conversations.values()].flatMap(c=>c.files).filter(f=>f.blobKey);if(files.length>=MAX_STORED_FILES||files.reduce((n,f)=>n+f.size,0)+size>MAX_STORED_FILE_BYTES)throw new Error('Local file storage is full (2000 files / 10 GiB); free space in Settings, Data and storage. Waiting content was preserved');
  }
  private origin(c:InternalConversation,metadata:string|undefined,id:string,type:'message'|'file',hash:string):GroupOrigin|undefined {if(c.kind!=='group')return;if(!c.definition||!metadata)throw new Error('Signed group content is required');const o=parseGroupOrigin(metadata,c.definition);if(o.id!==id||o.type!==type||o.hash!==hash||Date.now()>=o.expiresAt||o.timestamp>Date.now()+60000)throw new Error('Invalid or expired group content');return o;}
  private async acknowledge(p:PendingMessage,recipient:string,record:MessengerMessage|MessengerFile){
    const remaining=[...p.remaining],delivered=[...(record.deliveredTo??[])];const status=record.status;const delivery='deliveryStatus'in record?record.deliveryStatus:undefined;
    p.remaining=p.remaining.filter(id=>id!==recipient);record.deliveredTo=[...new Set([...delivered,recipient])];if('text'in record)record.status=p.remaining.length?'sent':'delivered';else{record.deliveryStatus=p.remaining.length?'sent':'delivered';record.status=p.remaining.length?'sending':'complete';}if(!p.remaining.length)this.pending=this.pending.filter(item=>item!==p);
    try{await this.durable();}catch(error){p.remaining=remaining;if(!this.pending.includes(p))this.pending.push(p);record.deliveredTo=delivered;if('text'in record)record.status=status as MessengerMessage['status'];else{record.status=status as SharedFile['status'];record.deliveryStatus=delivery;}this.dirty=true;throw error;}
  }
  private receiveMessage(peerId:string,message:ChatMessage):Promise<boolean>{return this.closing?Promise.resolve(false):this.track(this.receiveMessageWork(peerId,message));}
  private async receiveMessageWork(peerId:string,message:ChatMessage):Promise<boolean> {
    // Blocking acts before anything is written, whichever path the content took.
    if(this.blocked.has(peerId))return false;
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
    if(this.blocked.has(author))return true;
    if(this.isRemoved(c,author,message.id,'message')){if(origin)this.receiptAfterSave(c,origin,peerId);return true;}
    let target=c.messages.find(m=>m.id===message.id&&m.from===author);
    if(!target){if(c.messages.length>=100&&c.messages.every(m=>this.pending.some(p=>p.conversationId===c.id&&p.messageId===m.id)))throw new Error('Local incoming history is full');target={id:message.id,text:message.text,from:author,timestamp:origin?.timestamp??message.timestamp,status:'received',conversationId:c.id,expiresAt:origin?.expiresAt??message.timestamp+OUTBOX_TTL_MS,metadata:message.metadata};c.messages.push(target);c.unread=Math.min(100,c.unread+1);c.updatedAt=Date.now();c.hidden=undefined;c.implicit=undefined;const id=target.id;const edit=c.changes?.find(x=>x.action==='edit'&&x.type==='message'&&x.id===id&&x.author===author);if(edit?.text&&edit.text!==target.text){target.originalText=target.text;target.text=edit.text;target.editedAt=edit.changedAt;}}
    else if((target.originalText??target.text)!==message.text||target.metadata!==message.metadata)throw new Error('Conflicting message replay');
    // Retry the write even for an in-memory duplicate after a failed earlier write.
    this.protectedReceive.add(c.id+':'+message.id);try{await this.durable();}finally{this.protectedReceive.delete(c.id+':'+message.id);}if(origin)this.receiptAfterSave(c,origin,peerId);return true;
  }
  private receiveFile(peerId:string,file:SharedFile):Promise<boolean>{return this.closing?Promise.resolve(false):this.track(this.receiveFileWork(peerId,file));}
  private async receiveFileWork(peerId:string,file:SharedFile):Promise<boolean>{
    if(this.blocked.has(peerId))return false;
    if(!this.validConversation(peerId,file.conversationId)||!file.data)return false;const c=this.conversations.get(file.conversationId!)!;
    const origin=this.origin(c,file.metadata,file.id,'file',contentHash('file',file.data,file.name,file.mime));const timing=c.kind==='direct'?parseDirectFileTiming(file.metadata,file.id,c.id,Date.now()):undefined;const author=origin?.author??peerId;
    if(this.isRemoved(c,author,file.id,'file')){if(origin)this.receiptAfterSave(c,origin,peerId);return true;}
    let target=c.files.find(f=>f.id===file.id&&f.senderId===author);const key=attachmentKey(author,file.id,c.id);
    if(!target){this.fileCapacity(file.size);target={...file,data:undefined,status:'receiving',receivedBytes:0,senderId:author,conversationId:c.id,blobKey:undefined,deliveryStatus:'received',expiresAt:origin?.expiresAt??timing?.expiresAt??Date.now()+OUTBOX_TTL_MS,timestamp:origin?.timestamp??timing?.timestamp??Date.now()};c.files.push(target);c.updatedAt=Date.now();c.hidden=undefined;c.implicit=undefined;}
    else if(target.name!==file.name||target.mime!==file.mime||target.size!==file.size||target.metadata!==file.metadata)throw new Error('Conflicting file replay');
    const retained=target.blobKey===key;
    const checkDeadline=async()=>{
      if(!timing||Date.now()<timing.expiresAt)return;
      // A rejected late replay must not delete a previously accepted local copy.
      if(!retained){target.blobKey=undefined;target.status='error';target.receivedBytes=0;target.deliveryStatus='expired';await this.durable();this.blobs.delete(key);await this.options.deleteAttachment?.(key);}
      throw new Error('Direct file expired');
    };
    const received=target;const dropped=async()=>{if(this.conversations.get(c.id)===c&&c.files.includes(received))return false;this.blobs.delete(key);await this.options.deleteAttachment?.(key);return true;};
    await this.putBlob(key,file.data);if(await dropped())return true;await checkDeadline();target.blobKey=key;target.status='complete';target.receivedBytes=file.size;target.waiting=undefined;await this.durable();if(await dropped())return true;await checkDeadline();if(origin)this.receiptAfterSave(c,origin,peerId);return true;
  }
  private receiptAfterSave(c:InternalConversation,origin:GroupOrigin,peerId:string){const receipt=signGroupReceipt(this.options.identity,origin);const receipts=c.receipts??=[];if(!receipts.some(r=>r.author===receipt.author&&r.id===receipt.id&&r.recipient===receipt.recipient))receipts.push(receipt);this.changed();queueMicrotask(()=>{void this.pairs.get(peerId)?.session.sendApplication(receipt).catch(e=>this.report(e));});for(const id of c.memberIds)if(id!==this.options.identity.userId&&id!==peerId)this.wakePeer(id);}
  /** Live words from the current call only. Never saved, never logged, and dropped once the call ends. */
  private receiveCallCaption(peerId:string,payload:unknown){
    const parsed=callCaptionFrameSchema.safeParse(payload);if(!parsed.success)return;
    const session=this.pairs.get(peerId)?.session.getSnapshot();if(session?.callState!=='active'||session.callId!==parsed.data.callId)return;
    for(const listener of this.callCaptionListeners)listener(parsed.data);
  }
  onCallCaption(listener:(frame:CallCaptionFrame)=>void):()=>void{this.callCaptionListeners.add(listener);return()=>{this.callCaptionListeners.delete(listener);};}
  /** False while the peer cannot take sealed captions; live words are dropped, never queued. */
  async sendCallCaption(frame:CallCaptionFrame):Promise<boolean>{
    const parsed=callCaptionFrameSchema.parse(frame);
    for(const pair of this.pairs.values()){
      const session=pair.session.getSnapshot();if(session.callState!=='active'||session.callId!==parsed.callId)continue;
      if(!pair.session.supportsCallCaptions())return false;
      await pair.session.sendApplication(parsed);return true;
    }
    return false;
  }
  private receiveApplication(peerId:string,payload:unknown){return this.closing?Promise.resolve():this.track(this.receiveApplicationWork(peerId,payload));}
  private async receiveApplicationWork(peerId:string,payload:unknown){
    if(this.blocked.has(peerId))return;
    if((payload as {kind?:unknown})?.kind==='call-caption'||(payload as {kind?:unknown})?.kind==='call-caption-state'){this.receiveCallCaption(peerId,payload);return;}
    if((payload as {kind?:unknown})?.kind==='read-receipt'){await this.acceptReadReceipt(peerId,readReceiptSchema.parse(payload));return;}
    if((payload as {kind?:unknown})?.kind==='message-change'){await this.acceptMessageChange(peerId,messageChangeSchema.parse(payload));return;}
    if((payload as {kind?:unknown})?.kind==='message-reaction'){await this.acceptReaction(peerId,messageReactionSchema.parse(payload));return;}
    if((payload as {kind?:unknown})?.kind==='group-receipt'){
      const receipt=receiptSchema.parse(payload);const c=this.conversations.get(receipt.groupId);if(!c?.definition||!c.memberIds.includes(peerId)||!verifyGroupReceipt(receipt,c.definition))throw new Error('Invalid group receipt');
      const record=c.messages.find(m=>m.id===receipt.id&&m.from===receipt.author)??c.files.find(f=>f.id===receipt.id&&f.senderId===receipt.author);if(!record)return;if(!record.metadata)throw new Error('Unknown receipt origin');
      const origin=parseGroupOrigin(record.metadata,c.definition);if(Date.now()>=origin.expiresAt)throw new Error('Expired receipt');
      const receipts=c.receipts??=[];if(!receipts.some(r=>r.id===receipt.id&&r.author===receipt.author&&r.recipient===receipt.recipient))receipts.push(receipt);
      const pending=this.pending.find(p=>p.conversationId===c.id&&p.messageId===receipt.id&&(p.author??this.options.identity.userId)===receipt.author);
      if(pending&&receipt.author===this.options.identity.userId){await this.acknowledge(pending,receipt.recipient,record);return;}
      await this.durable();return;
    }
    const group=groupDefinitionSchema.parse(payload);const own=this.options.identity.userId;
    const signed=verifyGroupDefinition(group);if(group.signature&&!signed)throw new Error('Invalid group creator signature');
    {const existing=this.conversations.get(group.id);
      // A newer roster signed by the creator may arrive from any current or former member: the signature, not the courier, is what counts.
      if(existing&&signed&&existing.creatorId===group.creatorId&&rosterVersion(group)>rosterVersion(existing.definition)){
        if(!existing.memberIds.includes(peerId)&&!group.members.some(m=>m.userId===peerId)&&!(existing.formerIds??[]).includes(peerId))throw new Error('Group roster from a stranger');
        await this.applyRoster(existing,group);return;
      }
      if(existing&&rosterVersion(group)<rosterVersion(existing.definition))return; // A stale copy from a peer that has not caught up yet.
      if(existing?.removed)return;
    }
    if((!signed&&group.creatorId!==peerId)||!group.members.some(m=>m.userId===peerId)||!group.members.some(m=>m.userId===own)||new Set(group.members.map(m=>m.userId)).size!==group.members.length)throw new Error('Invalid group definition author/membership');
    const existing=this.conversations.get(group.id);if(existing&&(existing.creatorId!==group.creatorId||existing.title!==group.title||JSON.stringify(existing.memberIds)!==JSON.stringify(group.members.map(m=>m.userId).sort())))throw new Error('Group definition is immutable in this version');
    if(existing?.definition?.signature&&existing.definition.signature!==group.signature)throw new Error('Group definition is immutable in this version');
    if(!existing&&[...this.conversations.values()].filter(c=>c.kind==='group').length>=MAX_GROUPS)throw new Error('Group capacity exceeded');
    if(group.members.filter(m=>m.userId!==own&&!this.contacts.has(m.userId)).length+this.contacts.size>MAX_CONTACTS)throw new Error('Contact capacity exceeded');
    for(const member of group.members)if(member.userId!==own){const old=this.contacts.get(member.userId);if(old&&old.publicKey!==member.publicKey)throw new Error('Pinned contact key changed');this.remember({...member,online:old?.online??false});}
    if(!existing)this.conversations.set(group.id,{id:group.id,kind:'group',title:group.title,memberIds:group.members.map(m=>m.userId).sort(),creatorId:group.creatorId,definition:signed?group:undefined,messages:[],files:[],unread:0,updatedAt:Date.now()});else if(signed)existing.definition=group;
    this.watch();await this.durable();if(this.status==='online')void this.refreshContacts().catch(e=>this.report(e));
  }
  /** Adopts a newer creator-signed roster: title, joins and removals. Removed members keep the history; removing this phone makes the group read-only. */
  private async applyRoster(c:InternalConversation,group:GroupDefinition){
    const own=this.options.identity.userId;const members=group.members.map(m=>m.userId).sort();const stillIn=members.includes(own);
    const fresh=group.members.filter(m=>m.userId!==own&&!this.contacts.has(m.userId)).length;if(fresh+this.contacts.size>MAX_CONTACTS)throw new Error('Contact capacity exceeded');
    for(const member of group.members)if(member.userId!==own){const old=this.contacts.get(member.userId);if(old&&old.publicKey!==member.publicKey)throw new Error('Pinned contact key changed');this.remember({...member,online:old?.online??false});}
    const before=new Set([...c.memberIds,...(c.formerIds??[])]);const next=stillIn?members:[own];
    const former=[...before].filter(id=>id!==own&&!next.includes(id));
    // Someone added later gets what is written from now on, never the retained history from before they joined.
    const joined={...(c.joinedAt??{})};for(const id of next)if(id!==own&&!c.memberIds.includes(id))joined[id]=Date.now();for(const id of Object.keys(joined))if(!next.includes(id))delete joined[id];
    c.definition=group;c.title=group.title;c.memberIds=next;c.formerIds=former.length?former:undefined;c.joinedAt=Object.keys(joined).length?joined:undefined;
    if(stillIn)delete c.removed;else{c.removed=true;c.notifyRemoved=undefined;}
    // Nothing more is owed to someone who left the roster: their part of every pending send is dropped, not left to expire for a week.
    const ownRecords=(p:PendingMessage)=>p.type==='file'?c.files.find(f=>f.id===p.messageId&&f.senderId===own):c.messages.find(m=>m.id===p.messageId&&m.from===own);
    for(const p of this.pending.filter(item=>item.conversationId===c.id)){
      p.remaining=p.remaining.filter(id=>next.includes(id)&&id!==own);
      const record=(p.author??own)===own?ownRecords(p):undefined;
      if(record?.recipientIds){record.recipientIds=record.recipientIds.filter(id=>next.includes(id)||record.deliveredTo?.includes(id));if(!record.recipientIds.length)record.recipientIds=undefined;}
      if(!p.remaining.length){this.pending=this.pending.filter(item=>item!==p);if(record){if('text'in record)record.status=record.deliveredTo?.length?'delivered':'expired';else{record.deliveryStatus=record.deliveredTo?.length?'delivered':'expired';record.status='complete';}}}
    }
    for(const pair of this.pairs.values())pair.definitions.delete(c.id); // every member, new or old, gets the new version on its next flush
    this.watch();await this.durable();this.emit();if(!c.removed)this.kick(c);
  }
  /** Owner only: rename, add and remove people. Every change is a new creator-signed roster version that members pass on to each other; there is no server copy. */
  async updateGroup(groupId:string,change:{title?:string;add?:string[];remove?:string[]}):Promise<void>{this.assertActive();return this.track(this.updateGroupWork(groupId,change));}
  private async updateGroupWork(groupId:string,change:{title?:string;add?:string[];remove?:string[]}){
    await this.restore();const own=this.options.identity.userId;const c=this.conversations.get(groupId);
    if(!c||c.kind!=='group')throw new Error('Unknown group');if(c.creatorId!==own)throw new Error('Only the group owner can change the group');if(c.removed)throw new Error('You are no longer a member of this group');
    const title=change.title===undefined?c.title:z.string().trim().min(1).max(64).parse(change.title);
    const add=(change.add??[]).map(id=>roomIdSchema.parse(id)),remove=new Set((change.remove??[]).map(id=>roomIdSchema.parse(id)));if(remove.has(own))throw new Error('The owner cannot remove themselves');
    const members=[...new Set([...c.memberIds,...add])].filter(id=>!remove.has(id)).sort();if(members.length<2||members.length>8)throw new Error('Groups require 2–8 members');
    const missing=members.filter(id=>id!==own&&!this.contacts.has(id));if(missing.length){if(this.status!=='online')throw new Error('Directory must be online');const users=await this.request('lookup',missing);if(users.length!==missing.length)throw new Error('Unknown group member');for(const user of users)this.remember(user);}
    const current=this.definition(c);const self=this.self??current.members.find(m=>m.userId===own)!;
    const group=signGroupDefinition(this.options.identity,groupDefinitionSchema.parse({kind:'group-definition',id:c.id,title,creatorId:own,version:rosterVersion(current)+1,members:members.map(id=>id===own?{...self,online:false}:{...this.contacts.get(id)!,online:false})}));
    const removed=c.memberIds.filter(id=>id!==own&&!members.includes(id));
    if(removed.length)c.notifyRemoved=[...new Set([...(c.notifyRemoved??[]),...removed])];
    await this.applyRoster(c,group);
    for(const id of removed)if(this.status==='online'&&this.contacts.get(id)?.online)void this.ensurePair(id,true).then(()=>this.flushPeer(id)).catch(e=>this.report(e));
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
  private kick(c:InternalConversation){
    const direct=()=>{for(const id of c.memberIds)if(id!==this.options.identity.userId&&this.status==='online'&&this.contacts.get(id)?.online&&this.allowsDirect(id)&&this.needsDirect(c,id))void this.ensurePair(id,true).then(()=>this.flushPeer(id)).catch(e=>this.report(e));this.wakePending();};
    // Without a mailbox the direct path starts at once; with one, only what the server could not take still needs it.
    if(!this.mailboxReady()){direct();return;}
    void this.postMailbox().catch(()=>{/* The direct path below still carries it. */}).then(direct);
  }
  /** A text already in this person's server mailbox needs no direct connection and no wake from this phone. */
  private viaMailbox(p:PendingMessage,peerId:string){return p.type!=='file'&&!!p.mailboxed?.includes(peerId);}
  private needsDirect(c:InternalConversation,peerId:string){
    if(!this.mailboxReady()||this.mailboxRefused.has(peerId))return true;
    if(c.kind==='group'&&!this.pairs.get(peerId)?.definitions.has(c.id))return true;
    return this.pending.some(p=>p.conversationId===c.id&&p.remaining.includes(peerId)&&!this.viaMailbox(p,peerId));
  }
  private mailboxReady(){return !!this.options.mailbox&&this.status==='online'&&this.services?.mailboxV1===true;}
  private async startMailbox(){
    if(!this.options.mailbox)return;
    try{const capabilities=await this.getServices();if(!capabilities.mailboxV1||this.stopped)return;}catch{return;}
    // Failures are retried on the next nudge or connection; the direct path still covers anything not stored.
    await Promise.all([this.fetchMailbox().catch(()=>{}),this.postMailbox().catch(()=>{})]);
  }
  /** Service records go out the moment they exist; if the server cannot take them, the direct path still carries them. */
  private queueApp(memberIds:string[],key:Array<string|number>,payload:unknown,expiresAt:number){
    const own=this.options.identity.userId;const id=mailboxRecordId(key);
    for(const to of memberIds){if(to===own||this.mailboxApp.some(x=>x.to===to&&x.id===id))continue;this.mailboxApp.push({to,id,payload,expiresAt});}
    if(this.mailboxApp.length>500)this.mailboxApp.splice(0,this.mailboxApp.length-500);
  }
  private postMailbox():Promise<void>{
    if(this.closing)return Promise.resolve();
    if(this.mailboxPosting){this.mailboxRepost=true;return this.mailboxPosting;}
    const run=this.track(this.postMailboxWork()).finally(()=>{this.mailboxPosting=undefined;if(this.mailboxRepost&&!this.closing){this.mailboxRepost=false;void this.postMailbox().catch(e=>this.report(e));}});
    this.mailboxPosting=run;return run;
  }
  /**
   * Every own text and file waiting for someone whose phone takes mailbox items goes to the server,
   * encrypted for that phone, oldest first, so the recipient sees them in the order they were written.
   * A file goes as an announcement only; its bytes still wait for both phones to be online.
   */
  private async postMailboxWork(){
    if(!this.mailboxReady())return;
    const own=this.options.identity.userId;const now=Date.now();
    type Out={id:string;kind:MailboxKind;payload:MailboxPayload;expiresAt:number;pending?:PendingMessage;app?:{to:string;id:string};definition?:string};
    const byPeer=new Map<string,Out[]>();const list=(peer:string)=>{let items=byPeer.get(peer);if(!items){items=[];byPeer.set(peer,items);}return items;};
    const usable=(peer:string)=>!this.mailboxRefused.has(peer)&&!this.blocked.has(peer)&&this.contacts.has(peer);
    const pending=this.pending.filter(p=>(p.author??own)===own&&this.committed.has(this.pendingKey(p))&&now<(p.expiresAt??Infinity)).sort((a,b)=>(a.createdAt??0)-(b.createdAt??0));
    for(const p of pending){
      const c=this.conversations.get(p.conversationId);if(!c||c.removed)continue;
      const record=p.type==='file'?c.files.find(f=>f.id===p.messageId&&f.senderId===own):c.messages.find(m=>m.id===p.messageId&&m.from===own);if(!record)continue;
      const payload:MailboxPayload=p.type==='file'
        ?{type:'file',conversationId:c.id,id:record.id,name:(record as MessengerFile).name,mime:(record as MessengerFile).mime,size:(record as MessengerFile).size,...((record as MessengerFile).large?{large:true as const}:{}),timestamp:record.timestamp,...(record.metadata?{metadata:record.metadata}:{})}
        :{type:'message',conversationId:c.id,id:record.id,text:(record as MessengerMessage).originalText??(record as MessengerMessage).text,timestamp:record.timestamp,...(record.metadata?{metadata:record.metadata}:{})};
      for(const peer of p.remaining){
        if(p.mailboxed?.includes(peer)||!usable(peer))continue;const items=list(peer);
        // A group's roster goes ahead of its first item, so the recipient knows the group and its members' keys.
        const definition=c.kind==='group'?(c.definition??(c.creatorId===own?this.definition(c):undefined)):undefined;
        if(definition){const marker=peer+':'+c.id+':'+rosterVersion(definition);if(!this.mailboxDefinitions.has(marker)&&!items.some(x=>x.definition===marker))items.push({id:mailboxRecordId(['group',c.id,rosterVersion(definition),definition.signature??'']),kind:'app',payload:{type:'app',payload:definition},expiresAt:p.expiresAt??now+OUTBOX_TTL_MS,definition:marker});}
        items.push({id:record.id,kind:p.type==='file'?'file':'message',payload,expiresAt:p.expiresAt??now+OUTBOX_TTL_MS,pending:p});
      }
    }
    for(const app of this.mailboxApp)if(usable(app.to)&&app.expiresAt>now)list(app.to).push({id:app.id,kind:'app',payload:{type:'app',payload:app.payload},expiresAt:app.expiresAt,app:{to:app.to,id:app.id}});
    let touched=false;
    for(const [peer,items] of byPeer){
      const contact=this.contacts.get(peer);if(!contact)continue;
      const sealed=items.map(item=>({item,envelope:sealMailboxItem(this.options.identity,contact.publicKey,item.id,item.payload,this.random)}));
      while(sealed.length){
        const batch:typeof sealed=[];let chars=0;
        while(sealed.length&&batch.length<MAX_MAILBOX_PUT_ITEMS&&(!batch.length||chars+sealed[0]!.envelope.length<=MAX_MAILBOX_BATCH_CHARS)){const next=sealed.shift()!;chars+=next.envelope.length;batch.push(next);}
        if(!this.mailboxReady())return;
        let reply:{accepted:boolean;reason?:'unsupported'|'full'};
        // One recipient's refusal or error must not hold up the others; this one goes the direct way for this session.
        try{reply=await this.requestFrame({type:'mailbox-put',to:peer,items:batch.map(({item,envelope})=>({id:item.id,kind:item.kind,envelope,expiresAt:Math.max(1,Math.floor(item.expiresAt))}))},'mailbox-stored');}
        catch{if(!this.mailboxReady())return;reply={accepted:false,reason:'full'};}
        if(!reply.accepted){this.mailboxRefused.add(peer);this.mailboxApp=this.mailboxApp.filter(x=>x.to!==peer||reply.reason==='full');this.wakePending();break;}
        for(const {item} of batch){
          if(item.definition)this.mailboxDefinitions.add(item.definition);
          if(item.app)this.mailboxApp=this.mailboxApp.filter(x=>!(x.to===item.app!.to&&x.id===item.app!.id));
          const p=item.pending;if(!p||!this.pending.includes(p))continue;
          p.mailboxed=[...new Set([...(p.mailboxed??[]),peer])];touched=true;
          const c=this.conversations.get(p.conversationId);
          const record=p.type==='file'?c?.files.find(f=>f.id===p.messageId&&f.senderId===own):c?.messages.find(m=>m.id===p.messageId&&m.from===own);
          if(record){record.notifiedTo=[...new Set([...(record.notifiedTo??[]),peer])];if('text' in record&&record.status==='pending')record.status='sent';}
        }
      }
    }
    if(touched){await this.durable();this.wakePending();}
  }
  private fetchMailbox():Promise<void>{
    if(this.closing)return Promise.resolve();
    if(this.mailboxFetching){this.mailboxRefetch=true;return this.mailboxFetching;}
    const run=this.track(this.fetchMailboxWork()).finally(()=>{this.mailboxFetching=undefined;if(this.mailboxRefetch&&!this.closing){this.mailboxRefetch=false;void this.fetchMailbox().catch(e=>this.report(e));}});
    this.mailboxFetching=run;return run;
  }
  /** Takes what waits on the server, oldest first; each item is acknowledged only once it is saved here. */
  private async fetchMailboxWork(){
    let after=0;const counted=new Set<string>();const contactsBefore=this.contacts.size;
    for(const request of this.incoming.values())if(request.waiting>0)counted.add(request.user.userId);
    for(const id of counted)this.incoming.get(id)!.waiting=0;
    for(let page=0;page<64&&this.mailboxReady();page++){
      const frame=await this.requestFrame({type:'mailbox-fetch',...(after?{after}:{})},'mailbox');
      const users=new Map(frame.users.map(user=>[user.userId,user]));const acks:MailboxAck[]=[];
      for(const item of frame.items){after=Math.max(after,item.seq);const taken=await this.takeMailboxItem(item,users);if(taken!==undefined)acks.push({from:item.from,id:item.id,delivered:taken});}
      const receipts:MailboxReceipt[]=[];for(const receipt of frame.receipts){await this.mailboxDelivered(receipt);receipts.push(receipt);}
      if(acks.length||receipts.length)await this.requestFrame({type:'mailbox-ack',items:acks,receipts},'mailbox-acked');
      if(!frame.more)break;
    }
    // Requests whose items are gone from the server (taken elsewhere, expired) disappear.
    for(const id of counted){const request=this.incoming.get(id);if(request&&request.waiting===0)this.incoming.delete(id);}
    this.emit();
    // A group roster in this pass can make an earlier sender a member, and so a contact: read their items now.
    if(this.contacts.size!==contactsBefore&&[...this.incoming.values()].some(r=>this.contacts.has(r.user.userId))){for(const id of [...this.incoming.keys()])if(this.contacts.has(id))this.incoming.delete(id);this.mailboxRefetch=true;}
  }
  /** true: saved; false: refused for good (blocked, forged, unknown chat); undefined: leave it on the server for later. */
  private async takeMailboxItem(item:MailboxItem,users:Map<string,DirectoryUser>):Promise<boolean|undefined>{
    const own=this.options.identity.userId;if(item.from===own||this.blocked.has(item.from))return false;
    let contact=this.contacts.get(item.from);
    if(!contact){
      // Someone who is not a contact wrote first: a message request. Nothing is decrypted or saved and
      // they get no wake or direct-connection rights; the item stays on the server until accepted or declined.
      if(this.dropFrom.has(item.from))return false;
      const user=users.get(item.from);if(!user)return undefined;
      try{directoryUserSchema.parse(user);if(user.userId!==item.from||this.moved.has(item.from))return false;}catch{return false;}
      this.addRequest(user,1);return undefined;
    }
    let payload:MailboxPayload;
    try{payload=openMailboxItem(this.options.identity,contact.publicKey,item);}catch{return false;}
    // A contact (say, from a shared group) writing directly after this phone deleted the chat: open it again, as a direct connect would.
    if(payload.type!=='app'&&payload.conversationId===directConversationId(own,item.from)&&!this.conversations.has(payload.conversationId))this.ensureDirect(contact,true);
    const started=Date.now();
    try{
      if(payload.type==='message')return await this.receiveMessage(item.from,{id:payload.id,text:payload.text,from:'peer',timestamp:payload.timestamp,conversationId:payload.conversationId,...(payload.metadata?{metadata:payload.metadata}:{}),status:'received'});
      if(payload.type==='file')return await this.receiveFileNotice(item.from,payload);
      await this.receiveApplication(item.from,payload.payload);return true;
    }catch{
      // A full or locked disk must not cost the message: it stays on the server for the next try.
      return this.persistFailedAt>=started?undefined:false;
    }
  }
  /** The server saw the recipient's phone take this text: the same as a direct delivery receipt. */
  private async mailboxDelivered(receipt:MailboxReceipt){
    const own=this.options.identity.userId;
    const p=this.pending.find(x=>x.messageId===receipt.id&&(x.author??own)===own&&x.type!=='file'&&x.remaining.includes(receipt.to));if(!p)return;
    const target=this.conversations.get(p.conversationId)?.messages.find(m=>m.id===receipt.id&&m.from===own);if(!target)return;
    if(Date.now()<(p.expiresAt??Infinity))await this.acknowledge(p,receipt.to,target);this.wakePending();
  }
  private receiveFileNotice(peerId:string,notice:z.infer<typeof mailboxFileSchema>):Promise<boolean>{return this.closing?Promise.resolve(false):this.track(this.receiveFileNoticeWork(peerId,notice));}
  /** Holds the file's place in the chat. The bytes are checked against the signed origin when they arrive. */
  private async receiveFileNoticeWork(peerId:string,notice:z.infer<typeof mailboxFileSchema>):Promise<boolean>{
    if(!this.validConversation(peerId,notice.conversationId)||this.blocked.has(peerId))return false;
    const c=this.conversations.get(notice.conversationId)!;if(c.removed)return false;
    let timestamp:number,expiresAt:number;
    if(c.kind==='group'){
      if(!c.definition||!notice.metadata)return false;const origin=parseGroupOrigin(notice.metadata,c.definition);
      if(origin.id!==notice.id||origin.type!=='file'||origin.author!==peerId||Date.now()>=origin.expiresAt||(notice.large&&origin.hash!==bulkHash(notice.name,notice.mime,notice.size)))return false;
      timestamp=origin.timestamp;expiresAt=origin.expiresAt;
    }else{
      const timing=parseDirectFileTiming(notice.metadata,notice.id,c.id,Date.now());if(!timing||Date.now()>=timing.expiresAt)return false;
      timestamp=timing.timestamp;expiresAt=timing.expiresAt;
    }
    if(this.isRemoved(c,peerId,notice.id,'file')||c.files.some(f=>f.id===notice.id&&f.senderId===peerId))return true;
    if(!notice.large)this.fileCapacity(notice.size);
    c.files.push({id:notice.id,name:notice.name,mime:notice.mime,size:notice.size,...(notice.large?{large:true as const}:{}),from:'peer',status:'receiving',receivedBytes:0,senderId:peerId,conversationId:c.id,...(notice.metadata?{metadata:notice.metadata}:{}),deliveryStatus:'received',expiresAt,timestamp,waiting:true});
    // The chat shows an unread item now, not only once the bytes arrive; the bytes do not count it again.
    c.unread=Math.min(100,c.unread+1);c.updatedAt=Date.now();c.hidden=undefined;c.implicit=undefined;await this.durable();
    // The sender's phone is woken by its own delivery request; if it is already online, ask it to connect now.
    if(this.contacts.get(peerId)?.online&&this.status==='online')void this.ensurePair(peerId,true).catch(e=>this.report(e));
    return true;
  }
  private expirePending(){return this.closing?Promise.resolve():this.track(this.expirePendingWork());}
  private async expirePendingWork(){
    clearTimeout(this.expiryTimer);this.expiryTimer=undefined;const now=Date.now();const expired=this.pending.filter(p=>p.expiresAt!==undefined&&now>=p.expiresAt);const removed:string[]=[];
    for(const p of expired){const c=this.conversations.get(p.conversationId);if(!c)continue;if(p.type==='file'){const file=c.files.find(f=>f.id===p.messageId&&f.senderId===(p.author??this.options.identity.userId));if(file){file.deliveryStatus='expired';file.status='error';if(file.blobKey)removed.push(file.blobKey);if(file.large)removed.push(attachmentKey(file.senderId,file.id,c.id));file.blobKey=undefined;file.data=undefined;}}else{const message=c.messages.find(m=>m.id===p.messageId&&m.from===(p.author??this.options.identity.userId));if(message)message.status='expired';}this.committed.delete(this.pendingKey(p));}
    if(expired.length){this.pending=this.pending.filter(p=>!expired.includes(p));await this.durable();for(const key of removed){this.blobs.delete(key);await this.options.deleteAttachment?.(key);}}
    if(this.pending.length&&!this.closing){const deadline=Math.min(...this.pending.map(p=>p.expiresAt??Infinity));this.expiryTimer=setTimeout(()=>{void this.expirePending().catch(e=>this.report(e));},Math.max(1,Math.min(2147483647,deadline-Date.now())));}
  }
  private flushPeer(peerId:string){return this.closing?Promise.resolve():this.track(this.flushPeerWork(peerId));}
  private async flushPeerWork(peerId:string){
    const pair=this.pairs.get(peerId);if(!pair||pair.flushing||pair.session.getSnapshot().status!=='connected')return;pair.flushing=true;
    try {
      await this.expirePending();
      for(const c of this.conversations.values())if(c.kind==='group'&&c.memberIds.includes(peerId)&&!pair.definitions.has(c.id)&&(c.definition||c.creatorId===this.options.identity.userId)){await pair.session.sendApplication(this.definition(c));pair.definitions.add(c.id);}
      for(const c of this.conversations.values())if(c.kind==='group'&&c.notifyRemoved?.includes(peerId)&&c.definition){await pair.session.sendApplication(c.definition);c.notifyRemoved=c.notifyRemoved.filter(id=>id!==peerId);if(!c.notifyRemoved.length)c.notifyRemoved=undefined;this.changed();}
      const own=this.options.identity.userId;
      for(const c of this.conversations.values()){
        if(!c.memberIds.includes(peerId))continue;
        const pending=this.pending.filter(p=>p.conversationId===c.id&&p.remaining.includes(peerId)&&this.committed.has(this.pendingKey(p)));
        const records:Array<{type:'message'|'file';item:MessengerMessage|MessengerFile;author:string}>=[];
        for(const p of pending){if(this.viaMailbox(p,peerId))continue;const item=p.type==='file'?c.files.find(f=>f.id===p.messageId&&f.senderId===(p.author??own)):c.messages.find(m=>m.id===p.messageId&&m.from===(p.author??own));if(item)records.push({type:p.type??'message',item,author:p.author??own});}
        // Retained signed history is a bounded anti-entropy source for group peers.
        if(c.kind==='group'&&c.definition){const since=c.joinedAt?.[peerId]??0;for(const m of c.messages)if(m.from!==peerId&&m.from!==own&&c.memberIds.includes(m.from)&&m.timestamp>=since&&m.metadata&&Date.now()<(m.expiresAt??0))records.push({type:'message',item:m,author:m.from});for(const f of c.files)if(f.senderId!==peerId&&f.senderId!==own&&c.memberIds.includes(f.senderId)&&f.timestamp>=since&&f.metadata&&f.blobKey&&Date.now()<(f.expiresAt??0))records.push({type:'file',item:f,author:f.senderId});}
        let routeOk:boolean|undefined;
        for(const {type,item,author} of records){
          if(type==='file'&&(item as MessengerFile).large){if(author===own)this.startBulk(peerId,pair,c,item as MessengerFile);continue;}
          // Files try the direct path first; if ICE finds none, they go through the TURN relay (still end-to-end encrypted).
          if(type==='file'){routeOk??=await this.fileRouteOk(pair);if(!routeOk)continue;}
          if(c.kind==='group'&&(c.receipts??[]).some(r=>r.id===item.id&&r.author===author&&r.recipient===peerId))continue;
          if(c.kind==='group'&&author===own&&!item.metadata&&c.definition){item.metadata=JSON.stringify(signGroupOrigin(this.options.identity,{groupId:c.id,id:item.id,type,timestamp:item.timestamp,expiresAt:item.expiresAt??item.timestamp+OUTBOX_TTL_MS,hash:type==='message'?contentHash('message',(item as MessengerMessage).originalText??(item as MessengerMessage).text):contentHash('file',(await this.getFileData(c.id,item.id,author))!, (item as MessengerFile).name,(item as MessengerFile).mime)}));await this.durable();}const key=c.id+':'+author+':'+item.id;if(Date.now()-(pair.lastSent.get(key)??0)<5000)continue;pair.lastSent.set(key,Date.now());
          try{if(type==='message'){const message=item as MessengerMessage;await pair.session.sendText(message.originalText??message.text,{messageId:message.id,conversationId:c.id,metadata:message.metadata,timestamp:message.timestamp});}
            else{const file=item as MessengerFile;const data=await this.getFileData(c.id,file.id,author);if(!data)throw new Error('Encrypted file bytes are unavailable');await pair.session.sendFile({name:file.name,mime:file.mime,data},{messageId:file.id,conversationId:c.id,metadata:file.metadata});if(author===own){const p=this.pending.find(p=>p.type==='file'&&p.conversationId===c.id&&p.messageId===file.id);if(p&&Date.now()<p.expiresAt!){await this.acknowledge(p,peerId,file);}}}
          }catch(error){pair.lastSent.delete(key);throw error;}
        }
        for(const r of c.readReceipts??[]){if(r.author!==peerId)continue;const key='read:'+c.id+':'+r.author+':'+r.type+':'+r.id+':'+r.reader;if(pair.lastSent.has(key))continue;await pair.session.sendApplication(r);pair.lastSent.set(key,Date.now());}
        for(const change of this.unsentChanges(c,peerId,pair)){await pair.session.sendApplication(change);pair.lastSent.set(this.changeKey(change),Date.now());}
        for(const reaction of this.unsentReactions(c,peerId,pair)){await pair.session.sendApplication(reaction);pair.lastSent.set(this.reactionKey(reaction),Date.now());}
        for(const r of c.receipts??[]){const record=c.messages.find(m=>m.id===r.id&&m.from===r.author)??c.files.find(f=>f.id===r.id&&f.senderId===r.author);if(!record||Date.now()>=(record.expiresAt??0))continue;const key='receipt:'+c.id+':'+r.author+':'+r.id+':'+r.recipient;if(pair.lastSent.has(key))continue;await pair.session.sendApplication(r);pair.lastSent.set(key,Date.now());}
      }
    }catch(error){this.report(error);}finally{pair.flushing=false;this.scheduleOutbox(peerId);}
  }
  private scheduleOutbox(peerId:string){const pair=this.pairs.get(peerId);if(!pair||pair.pump||this.stopped||pair.session.getSnapshot().status!=='connected')return;const relay=[...this.conversations.values()].some(c=>c.kind==='group'&&c.memberIds.includes(peerId)&&(c.messages.some(m=>m.metadata&&Date.now()<(m.expiresAt??0))||c.files.some(f=>f.metadata&&f.blobKey&&Date.now()<(f.expiresAt??0))));if(!this.pending.some(p=>p.remaining.includes(peerId)&&!this.viaMailbox(p,peerId))&&!relay&&![...this.conversations.values()].some(c=>c.memberIds.includes(peerId)&&(this.unsentChanges(c,peerId,pair).length||this.unsentReactions(c,peerId,pair).length)))return;pair.pump=setTimeout(()=>{pair.pump=undefined;void this.flushPeer(peerId);},5000);}
  async sendText(conversationId:string,text:string):Promise<void>{return this.serial(async()=>{
    await this.restore();await this.expirePending();const c=this.conversations.get(conversationId);if(!c)throw new Error('Unknown conversation');if(!text.trim()||text.length>MAX_TEXT_CHARS)throw new Error('Text must contain 1–4000 characters');if(this.pending.filter(p=>p.type!=='file').length>=MAX_PENDING_MESSAGES)throw new Error('Local outbox is full');
    if((c as InternalConversation).removed)throw new Error('You are no longer a member of this group');
    const timestamp=Date.now();const expiresAt=timestamp+OUTBOX_TTL_MS;const id=this.id();const peers=c.memberIds.filter(id=>id!==this.options.identity.userId);const metadata=c.kind==='group'?JSON.stringify(signGroupOrigin(this.options.identity,{groupId:this.definition(c).id,id,type:'message',timestamp,expiresAt,hash:contentHash('message',text)})):undefined;
    const message:MessengerMessage={id,text,from:this.options.identity.userId,timestamp,expiresAt,metadata,status:'pending',conversationId,recipientIds:peers,deliveredTo:[]};const p:PendingMessage={conversationId,messageId:id,remaining:peers,type:'message',author:this.options.identity.userId,createdAt:timestamp,expiresAt};const hidden=c.hidden,implicit=c.implicit;c.hidden=undefined;c.implicit=undefined;c.messages.push(message);c.updatedAt=timestamp;this.pending.push(p);
    try{await this.durable();}catch(error){c.messages=c.messages.filter(m=>m!==message);this.pending=this.pending.filter(item=>item!==p);c.hidden=hidden;c.implicit=implicit;this.dirty=true;throw error;}this.committed.add(this.pendingKey(p));await this.expirePending();this.kick(c);
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
      if(elapsed>=nextWake){nextWake=elapsed+30000;if(kind==='call'&&this.outgoingInvitation)void this.offerCallInvitation(this.outgoingInvitation);else void this.sendWake(peerId,kind,operation.timeout-elapsed,()=>!operation.controller.signal.aborted&&this.now()-operation.started<operation.timeout&&this.pairs.get(peerId)?.session.getSnapshot().status!=='connected');}
      await new Promise<void>((resolve,reject)=>{
        const abort=()=>{clearTimeout(timer);reject(operation.controller.signal.reason??new Error('Operation cancelled'));};
        const timer=setTimeout(()=>{operation.controller.signal.removeEventListener('abort',abort);resolve();},100);
        operation.controller.signal.addEventListener('abort',abort,{once:true});
      });
    }
  }
  async sendFile(conversationId:string,file:{name:string;mime:string;data:Uint8Array}):Promise<void>{return this.serial(async()=>{
    await this.restore();await this.expirePending();if(file.data.length>MAX_FILE_BYTES)throw new Error('File exceeds 5 MiB limit');const c=this.conversations.get(conversationId);if(!c)throw new Error('Unknown conversation');if(!file.name||file.name.length>255||typeof file.mime!=='string'||file.mime.length>255)throw new Error('Invalid file metadata');this.fileCapacity(file.data.length,true);
    if((c as InternalConversation).removed)throw new Error('You are no longer a member of this group');
    const timestamp=Date.now(),expiresAt=timestamp+OUTBOX_TTL_MS,id=this.id(),own=this.options.identity.userId;const key=attachmentKey(own,id,conversationId);const peers=c.memberIds.filter(id=>id!==own);const metadata=c.kind==='group'?JSON.stringify(signGroupOrigin(this.options.identity,{groupId:this.definition(c).id,id,type:'file',timestamp,expiresAt,hash:contentHash('file',file.data,file.name,file.mime)})):encodeDirectFileTiming({id,conversationId,timestamp,expiresAt});
    await this.putBlob(key,file.data);const record:MessengerFile={id,name:file.name,mime:file.mime,size:file.data.length,from:'self',status:'sending',receivedBytes:0,timestamp,senderId:own,conversationId,blobKey:key,metadata,expiresAt,deliveryStatus:'pending',recipientIds:peers,deliveredTo:[]};const p:PendingMessage={conversationId,messageId:id,remaining:peers,type:'file',author:own,createdAt:timestamp,expiresAt};const hidden=c.hidden,implicit=c.implicit;c.hidden=undefined;c.implicit=undefined;c.files.push(record);this.pending.push(p);c.updatedAt=timestamp;
    try{await this.durable();}catch(error){c.files=c.files.filter(f=>f!==record);this.pending=this.pending.filter(item=>item!==p);this.blobs.delete(key);c.hidden=hidden;c.implicit=implicit;this.dirty=true;throw error;}this.committed.add(this.pendingKey(p));await this.expirePending();this.kick(c);
  });}
  /**
   * Queues a large file (up to 1 GiB). `adopt` moves the picked file into app storage under the
   * attachment key before anything is recorded, so the outbox never points at a missing file. It
   * then waits like text, up to 7 days, and streams straight to each recipient over a direct path.
   */
  async sendLargeFile(conversationId:string,file:{name:string;mime:string;size:number},adopt:(key:string)=>Promise<void>):Promise<void>{return this.serial(async()=>{
    await this.restore();await this.expirePending();if(!this.options.bulkFiles)throw new Error('Large files are not supported on this device');
    if(!Number.isInteger(file.size)||file.size<=0||file.size>MAX_BULK_BYTES)throw new Error('File exceeds 1 GiB limit');
    const c=this.conversations.get(conversationId);if(!c)throw new Error('Unknown conversation');if(c.removed)throw new Error('You are no longer a member of this group');
    if(!file.name||file.name.length>255||typeof file.mime!=='string'||file.mime.length>127)throw new Error('Invalid file metadata');
    if(this.pending.filter(p=>p.type==='file').length>=MAX_PENDING_FILES)throw new Error('Local file outbox is full (16 files waiting for delivery); waiting content was preserved');
    const timestamp=Date.now(),expiresAt=timestamp+OUTBOX_TTL_MS,id=this.id(),own=this.options.identity.userId;const key=attachmentKey(own,id,conversationId);const peers=c.memberIds.filter(peer=>peer!==own);
    const metadata=c.kind==='group'?JSON.stringify(signGroupOrigin(this.options.identity,{groupId:this.definition(c).id,id,type:'file',timestamp,expiresAt,hash:bulkHash(file.name,file.mime,file.size)})):encodeDirectFileTiming({id,conversationId,timestamp,expiresAt});
    await adopt(key);
    const record:MessengerFile={id,name:file.name,mime:file.mime,size:file.size,from:'self',status:'sending',receivedBytes:0,timestamp,senderId:own,conversationId,metadata,expiresAt,deliveryStatus:'pending',recipientIds:peers,deliveredTo:[],large:true};
    const p:PendingMessage={conversationId,messageId:id,remaining:peers,type:'file',author:own,createdAt:timestamp,expiresAt};const hidden=c.hidden,implicit=c.implicit;c.hidden=undefined;c.implicit=undefined;c.files.push(record);this.pending.push(p);c.updatedAt=timestamp;
    try{await this.durable();}catch(error){c.files=c.files.filter(f=>f!==record);this.pending=this.pending.filter(item=>item!==p);c.hidden=hidden;c.implicit=implicit;this.dirty=true;throw error;}
    this.committed.add(this.pendingKey(p));await this.expirePending();this.kick(c);
  });}
  /**
   * Files go phone to phone. The direct path is tried first; when the session has run for
   * RELAY_GRACE_MS without one (carrier NAT, strict firewalls), they use the TURN relay, which only
   * forwards the encrypted stream and stores nothing.
   */
  private async fileRouteOk(pair:Pair):Promise<boolean>{
    const route=typeof pair.session.currentRoute==='function'?await pair.session.currentRoute():'direct';
    if(route==='direct'){pair.indirectSince=undefined;return true;}
    pair.indirectSince??=this.now();
    return this.now()-pair.indirectSince>=RELAY_GRACE_MS;
  }
  /** One large file at a time per recipient; the next starts when this one ends, a failed one is retried. */
  private bulkActive=new Set<string>();
  private startBulk(peerId:string,pair:Pair,c:InternalConversation,file:MessengerFile){
    const store=this.options.bulkFiles;if(!store||this.bulkActive.has(peerId)||!pair.session.supportsBulk())return;
    this.bulkActive.add(peerId);const own=this.options.identity.userId;
    void (async()=>{
      let sent=false;let routeWait=false;
      try{
        if(!await this.fileRouteOk(pair)){routeWait=true;return;} // the direct path is still being tried
        const key=attachmentKey(own,file.id,c.id);
        await pair.session.sendBulk({id:file.id,conversationId:c.id,name:file.name,mime:file.mime,size:file.size,metadata:file.metadata},(offset,length)=>store.read(key,file.name,offset,length),()=>this.fileRouteOk(pair));
        sent=true;const p=this.pending.find(item=>item.type==='file'&&item.conversationId===c.id&&item.messageId===file.id&&(item.author??own)===own);
        if(p&&p.remaining.includes(peerId)&&Date.now()<p.expiresAt!)await this.acknowledge(p,peerId,file);
        this.emit();
      }catch(error){if(/free space|did not accept|update LastCall/.test(String((error as Error)?.message)))this.report(error);}
      finally{
        this.bulkActive.delete(peerId);
        if(!this.closing)setTimeout(()=>{void this.flushPeer(peerId).catch(e=>this.report(e));},sent?0:routeWait?RELAY_GRACE_MS/2:30000);
      }
    })();
  }
  private bulkProgress(peerId:string,id:string,bytes:number,direction:'in'|'out'){
    const own=this.options.identity.userId;
    for(const c of this.conversations.values()){const file=c.files.find(f=>f.id===id&&f.large&&(direction==='in'?f.senderId===peerId:f.senderId===own));if(file){file.receivedBytes=Math.min(file.size,bytes);this.emit();return;}}
  }
  private receiveBulkOffer(peerId:string,offer:BulkOffer):Promise<BulkSink|undefined>{return this.closing?Promise.resolve(undefined):this.track(this.receiveBulkOfferWork(peerId,offer));}
  private async receiveBulkOfferWork(peerId:string,offer:BulkOffer):Promise<BulkSink|undefined>{
    const store=this.options.bulkFiles;if(!store||!this.validConversation(peerId,offer.conversationId)||this.blocked.has(peerId))return;
    const c=this.conversations.get(offer.conversationId!)!;if(c.removed)return;
    const origin=this.origin(c,offer.metadata,offer.id,'file',bulkHash(offer.name,offer.mime,offer.size));const timing=c.kind==='direct'?parseDirectFileTiming(offer.metadata,offer.id,c.id,Date.now()):undefined;
    const author=origin?.author??peerId;if(author!==peerId||this.isRemoved(c,author,offer.id,'file'))return; // large files come only from their author, never relayed
    let target=c.files.find(f=>f.id===offer.id&&f.senderId===author);
    if(target&&(!target.large||target.name!==offer.name||target.mime!==offer.mime||target.size!==offer.size))throw new Error('Conflicting file replay');
    if(!target){
      target={id:offer.id,name:offer.name,mime:offer.mime,size:offer.size,from:'peer',status:'receiving',receivedBytes:0,senderId:author,conversationId:c.id,metadata:offer.metadata,large:true,deliveryStatus:'received',expiresAt:origin?.expiresAt??timing?.expiresAt??Date.now()+OUTBOX_TTL_MS,timestamp:origin?.timestamp??timing?.timestamp??Date.now()};
      c.files.push(target);c.updatedAt=Date.now();c.hidden=undefined;c.implicit=undefined;await this.durable();this.emit();
    }
    const file=target;const announced=!!file.waiting;const sink=await store.openIncoming(attachmentKey(author,offer.id,c.id),offer.name,offer.size);file.receivedBytes=sink.offset;if(file.waiting){file.waiting=undefined;this.changed();}else this.emit();
    return {offset:sink.offset,write:bytes=>sink.write(bytes),abort:()=>sink.abort(),pause:()=>sink.pause?.(),finish:async()=>{
      await sink.finish();const fresh=file.status!=='complete';file.status='complete';file.receivedBytes=file.size;
      if(fresh&&!announced){c.unread=Math.min(100,c.unread+1);c.updatedAt=Date.now();}await this.durable();this.emit();
    }};
  }
  private changeKey(change:MessageChange){return 'change:'+change.conversationId+':'+change.author+':'+change.type+':'+change.id+':'+change.revision;}
  /** Each stored change goes once per connected session, and only to a peer that declared support. */
  private unsentChanges(c:InternalConversation,peerId:string,pair:Pair):MessageChange[]{if(!c.changes?.length||!pair.session.supportsMessageChanges())return [];return c.changes.filter(x=>x.author!==peerId&&Date.now()<x.expiresAt&&!pair.lastSent.has(this.changeKey(x)));}
  private reactionKey(r:MessageReaction){return 'reaction:'+r.conversationId+':'+r.author+':'+r.type+':'+r.id+':'+r.reactor+':'+r.revision;}
  /** Every member's latest reaction goes once per connected session to a peer that declared support; the peer's own come from the peer. */
  private unsentReactions(c:InternalConversation,peerId:string,pair:Pair):MessageReaction[]{if(!c.reactions?.length||!pair.session.supportsReactions?.())return [];return c.reactions.filter(x=>x.reactor!==peerId&&Date.now()<x.expiresAt&&!pair.lastSent.has(this.reactionKey(x)));}
  private reactionViews(c:InternalConversation):Map<string,ReactionView[]>{
    const views=new Map<string,ReactionView[]>();
    for(const r of [...(c.reactions??[])].sort((a,b)=>a.reactedAt-b.reactedAt))if(r.emoji){const key=r.type+':'+r.author+':'+r.id;const list=views.get(key)??[];list.push({userId:r.reactor,emoji:r.emoji});views.set(key,list);}
    return views;
  }
  private hasRecord(c:InternalConversation,author:string,id:string,type:'message'|'file'){return type==='file'?c.files.some(f=>f.id===id&&f.senderId===author):c.messages.some(m=>m.id===id&&m.from===author);}
  /** Keeps one record per member and target: the newest revision wins. */
  private putReaction(c:InternalConversation,reaction:MessageReaction){const reactions=(c.reactions??[]).filter(x=>!(x.reactor===reaction.reactor&&x.author===reaction.author&&x.id===reaction.id&&x.type===reaction.type));reactions.push(reaction);while(reactions.length>MAX_REACTIONS){const oldest=reactions.reduce((a,b)=>b.reactedAt<a.reactedAt?b:a);reactions.splice(reactions.indexOf(oldest),1);}c.reactions=reactions;}
  /** Sets, replaces or (without an emoji) removes your reaction. It reaches others directly when their app next connects, within 7 days. */
  async react(conversationId:string,record:{id:string;type:'message'|'file';author:string},emoji?:ReactionEmoji):Promise<void>{return this.serial(async()=>{
    await this.restore();const c=this.conversations.get(conversationId);if(!c)throw new Error('Unknown conversation');if(!this.hasRecord(c,record.author,record.id,record.type))throw new Error('Unknown message');
    const own=this.options.identity.userId;const previous=c.reactions?.find(x=>x.reactor===own&&x.author===record.author&&x.id===record.id&&x.type===record.type);if(previous?.emoji===emoji||(!previous&&!emoji))return;
    const reactedAt=Math.max(Date.now(),(previous?.reactedAt??0));const reaction=signMessageReaction(this.options.identity,{conversationId:c.id,author:record.author,id:record.id,type:record.type,emoji,revision:(previous?.revision??0)+1,reactedAt,expiresAt:reactedAt+OUTBOX_TTL_MS});
    const before=c.reactions;this.putReaction(c,reaction);
    try{await this.durable();}catch(error){c.reactions=before;this.dirty=true;throw error;}this.queueApp(c.memberIds,['reaction',this.reactionKey(reaction)],reaction,reaction.expiresAt);this.kick(c);
  });}
  private async acceptReaction(peerId:string,reaction:MessageReaction){
    const c=this.conversations.get(reaction.conversationId),own=this.options.identity.userId;const publicKey=reaction.reactor===own?this.options.identity.publicKey:this.contacts.get(reaction.reactor)?.publicKey;
    if(!c||!c.memberIds.includes(peerId)||!c.memberIds.includes(reaction.author)||!c.memberIds.includes(reaction.reactor)||!publicKey||(c.kind==='direct'&&reaction.reactor!==peerId&&reaction.reactor!==own)||!verifyMessageReaction(reaction,publicKey))throw new Error('Invalid reaction');
    if(reaction.reactedAt>Date.now()+60000)throw new Error('Reaction is from the future');if(Date.now()>=reaction.expiresAt||this.blocked.has(reaction.reactor))return;
    // A reaction can overtake its message in a group relay; the next session sends it again.
    if(!this.hasRecord(c,reaction.author,reaction.id,reaction.type))return;
    const existing=c.reactions?.find(x=>x.reactor===reaction.reactor&&x.author===reaction.author&&x.id===reaction.id&&x.type===reaction.type);if(existing&&existing.revision>=reaction.revision)return;
    const before=c.reactions;this.putReaction(c,reaction);
    try{await this.durable();}catch(error){c.reactions=before;this.dirty=true;throw error;}
  }
  private isRemoved(c:InternalConversation,author:string,id:string,type:'message'|'file'){return !!c.tombstones?.some(x=>x.author===author&&x.id===id&&x.type===type)||!!c.changes?.some(x=>x.action==='delete'&&x.author===author&&x.id===id&&x.type===type);}
  private putChange(c:InternalConversation,change:MessageChange){const changes=(c.changes??[]).filter(x=>!(x.author===change.author&&x.id===change.id&&x.type===change.type));changes.push(change);while(changes.length>MAX_MESSAGE_CHANGES){const oldest=changes.reduce((a,b)=>b.expiresAt<a.expiresAt?b:a);changes.splice(changes.indexOf(oldest),1);}c.changes=changes;}
  private putTombstone(c:InternalConversation,tombstone:Tombstone){const tombstones=(c.tombstones??[]).filter(x=>!(x.author===tombstone.author&&x.id===tombstone.id&&x.type===tombstone.type));tombstones.push(tombstone);while(tombstones.length>MAX_TOMBSTONES){const oldest=tombstones.reduce((a,b)=>b.expiresAt<a.expiresAt?b:a);tombstones.splice(tombstones.indexOf(oldest),1);}c.tombstones=tombstones;}
  /** Evicts the oldest changes and tombstones to stay inside the budget. False when retained original texts alone exceed it. */
  private fitChangeBudget():boolean{
    const size=(value:unknown)=>utf8.encode(JSON.stringify(value)).length;let total=0;const entries:Array<{expiresAt:number;bytes:number;remove:()=>void}>=[];
    for(const c of this.conversations.values()){
      for(const m of c.messages)if(m.originalText)total+=size(m.originalText);
      for(const change of c.changes??[]){const bytes=size(change);total+=bytes;entries.push({expiresAt:change.expiresAt,bytes,remove:()=>{c.changes=c.changes?.filter(x=>x!==change);}});}
      for(const tombstone of c.tombstones??[]){const bytes=size(tombstone);total+=bytes;entries.push({expiresAt:tombstone.expiresAt,bytes,remove:()=>{c.tombstones=c.tombstones?.filter(x=>x!==tombstone);}});}
    }
    if(total<=MAX_CHANGE_STATE_BYTES)return true;
    for(const entry of entries.sort((a,b)=>a.expiresAt-b.expiresAt)){entry.remove();total-=entry.bytes;if(total<=MAX_CHANGE_STATE_BYTES)return true;}
    return false;
  }
  /** Removes a record and its outbox entry from memory. The caller persists, then forgets the returned blob and keys. */
  private removeRecord(c:InternalConversation,author:string,id:string,type:'message'|'file'):{blobKey?:string;pending:PendingMessage[]}{
    const own=this.options.identity.userId;const pending=this.pending.filter(p=>p.conversationId===c.id&&p.messageId===id&&(p.type??'message')===type&&(p.author??own)===author);this.pending=this.pending.filter(p=>!pending.includes(p));let blobKey:string|undefined;
    if(type==='file'){const file=c.files.find(f=>f.id===id&&f.senderId===author);blobKey=file?.large?attachmentKey(author,id,c.id):file?.blobKey;c.files=c.files.filter(f=>!(f.id===id&&f.senderId===author));}
    else{const message=c.messages.find(m=>m.id===id&&m.from===author);if(message&&author!==own&&!c.readReceipts?.some(r=>r.id===id&&r.type==='message'&&r.author===author&&r.reader===own))c.unread=Math.max(0,c.unread-1);c.messages=c.messages.filter(m=>m!==message);}
    return {blobKey,pending};
  }
  private async forgetRemoved(removed:{blobKeys:Array<string|undefined>;pending:PendingMessage[]}){
    for(const p of removed.pending)this.committed.delete(this.pendingKey(p));
    for(const key of removed.blobKeys)if(key){this.blobs.delete(key);try{await this.options.deleteAttachment?.(key);}catch(error){this.report(error);}}
  }
  private async dropArchive(conversationId:string){if(!this.options.records||!this.records().archives)return;this.archiveQueue=this.archiveQueue.filter(row=>!row.key.startsWith(`a:${conversationId}:`));try{await this.records().dropArchive(`a:${conversationId}:`);}catch(error){this.report(error);}}
  private conversationState(c:InternalConversation){return {messages:c.messages,files:c.files,receipts:c.receipts,readReceipts:c.readReceipts,changes:c.changes,tombstones:c.tombstones,reactions:c.reactions,unread:c.unread,hidden:c.hidden,pending:this.pending};}
  private restoreConversationState(c:InternalConversation,state:ReturnType<MessengerClient['conversationState']>){const {pending,...fields}=state;Object.assign(c,fields);this.pending=pending;this.dirty=true;}
  private signChange(c:InternalConversation,input:{id:string;type:'message'|'file';action:'edit'|'delete';text?:string}):MessageChange{
    const own=this.options.identity.userId;const previous=c.changes?.find(x=>x.author===own&&x.id===input.id&&x.type===input.type);const changedAt=Date.now();
    return signMessageChange(this.options.identity,{conversationId:c.id,...input,revision:(previous?.revision??0)+1,changedAt,expiresAt:changedAt+OUTBOX_TTL_MS});
  }
  /** Replaces the shown text. Every send path keeps using the original text, so signed origins and read receipts stay valid. */
  async editMessage(conversationId:string,messageId:string,text:string):Promise<void>{return this.serial(async()=>{
    await this.restore();const c=this.conversations.get(conversationId);if(!c)throw new Error('Unknown conversation');const own=this.options.identity.userId;const message=c.messages.find(m=>m.id===messageId&&m.from===own);if(!message)throw new Error('Unknown message');
    if(message.status==='expired')throw new Error('This message expired and can no longer be edited');if(!text.trim()||text.length>MAX_TEXT_CHARS)throw new Error('Text must contain 1–4000 characters');if(text===message.text)return;
    const change=this.signChange(c,{id:messageId,type:'message',action:'edit',text});if(JSON.stringify(change).length>MAX_APPLICATION_BODY)throw new Error('The edited text contains too many special characters to send');
    const state=this.conversationState(c);const {text:previousText,originalText,editedAt}=message;const undo=()=>{message.text=previousText;message.originalText=originalText;message.editedAt=editedAt;this.restoreConversationState(c,state);};
    message.originalText??=message.text;message.text=text;message.editedAt=change.changedAt;this.putChange(c,change);
    if(!this.fitChangeBudget()){undo();throw new Error('Local storage for edits is full; delete some edited messages first');}
    try{await this.durable();}catch(error){undo();throw error;}this.queueApp(c.memberIds,['change',this.changeKey(change)],change,change.expiresAt);this.kick(c);
  });}
  /** "everyone" asks the recipients' apps to remove it too; only the author can sign that request. */
  async deleteMessage(conversationId:string,record:{id:string;type:'message'|'file';author:string},scope:'me'|'everyone'):Promise<void>{return this.serial(async()=>{
    await this.restore();const c=this.conversations.get(conversationId);if(!c)throw new Error('Unknown conversation');const own=this.options.identity.userId;if(scope==='everyone'&&record.author!==own)throw new Error('Only your own messages can be deleted for everyone');
    const item=record.type==='file'?c.files.find(f=>f.id===record.id&&f.senderId===record.author):c.messages.find(m=>m.id===record.id&&m.from===record.author);if(!item)throw new Error('Unknown message');
    const state=this.conversationState(c);const expiresAt=item.expiresAt??item.timestamp+OUTBOX_TTL_MS;
    const change=scope==='everyone'?this.signChange(c,{id:record.id,type:record.type,action:'delete'}):undefined;const removed=this.removeRecord(c,record.author,record.id,record.type);
    if(change)this.putChange(c,change);else if(Date.now()<expiresAt)this.putTombstone(c,{id:record.id,author:record.author,type:record.type,expiresAt});this.fitChangeBudget();
    try{await this.durable();}catch(error){this.restoreConversationState(c,state);throw error;}await this.forgetRemoved({blobKeys:[removed.blobKey],pending:removed.pending});if(change){this.queueApp(c.memberIds,['change',this.changeKey(change)],change,change.expiresAt);this.kick(c);}
  });}
  /** Local only: the other side keeps its copy, and tombstones stop replays from bringing the content back. */
  async deleteChat(conversationId:string):Promise<void>{return this.serial(async()=>{
    await this.restore();const c=this.conversations.get(conversationId);if(!c)throw new Error('Unknown conversation');const state=this.conversationState(c);const now=Date.now();
    const pending=this.pending.filter(p=>p.conversationId===c.id);const blobKeys=c.files.map(f=>f.large?attachmentKey(f.senderId,f.id,c.id):f.blobKey);this.pending=this.pending.filter(p=>p.conversationId!==c.id);
    for(const m of c.messages){const expiresAt=m.expiresAt??m.timestamp+OUTBOX_TTL_MS;if(now<expiresAt)this.putTombstone(c,{id:m.id,author:m.from,type:'message',expiresAt});}
    for(const f of c.files){const expiresAt=f.expiresAt??f.timestamp+OUTBOX_TTL_MS;if(now<expiresAt)this.putTombstone(c,{id:f.id,author:f.senderId,type:'file',expiresAt});}
    const archived=c.archived;c.messages=[];c.files=[];c.receipts=undefined;c.readReceipts=undefined;c.reactions=undefined;c.unread=0;c.hidden=true;c.archived=undefined;this.fitChangeBudget();
    try{await this.durable();}catch(error){this.restoreConversationState(c,state);c.archived=archived;throw error;}await this.forgetRemoved({blobKeys,pending});await this.dropArchive(c.id);
  });}
  /** Group membership and persisted blocks both need the contact entry, so those contacts lose only the direct chat. */
  async removeContact(userId:string):Promise<void>{return this.serial(async()=>{
    await this.restore();const own=this.options.identity.userId;if(userId===own||!this.contacts.has(userId))throw new Error('Unknown contact');const id=directConversationId(own,userId);const c=this.conversations.get(id);if(!c||c.kind!=='direct')throw new Error('Unknown contact');
    if(this.pendingIncoming?.callerId===userId)this.clearPendingIncoming(true);if(this.getSnapshot().activeCall?.peerId===userId)this.endCall();
    const contact=this.contacts.get(userId)!,wasVerified=this.verified.has(userId),moved=this.moved.get(userId),allPending=this.pending;const pending=allPending.filter(p=>p.conversationId===id);const inGroup=[...this.conversations.values()].some(g=>g.kind==='group'&&g.memberIds.includes(userId));
    this.conversations.delete(id);this.pending=allPending.filter(p=>p.conversationId!==id);this.verified.delete(userId);this.moved.delete(userId);if(!inGroup&&!this.blocked.has(userId))this.contacts.delete(userId);
    try{await this.durable();}catch(error){this.conversations.set(id,c);this.pending=allPending;this.contacts.set(userId,contact);if(wasVerified)this.verified.add(userId);if(moved)this.moved.set(userId,moved);this.dirty=true;throw error;}
    await this.forgetRemoved({blobKeys:c.files.map(f=>f.large?attachmentKey(f.senderId,f.id,c.id):f.blobKey),pending});await this.dropArchive(c.id);
    const pair=this.pairs.get(userId);if(pair&&!inGroup){this.pairs.delete(userId);clearTimeout(pair.retry);clearTimeout(pair.pump);pair.session.disconnect();}
    try{this.watch();}catch{/* The next directory connection sends the current watch list. */}this.emit();
  });}
  private async acceptMessageChange(peerId:string,change:MessageChange){
    const c=this.conversations.get(change.conversationId),own=this.options.identity.userId;const publicKey=change.author===own?this.options.identity.publicKey:this.contacts.get(change.author)?.publicKey;
    if(!c||!c.memberIds.includes(peerId)||!c.memberIds.includes(change.author)||!publicKey||(c.kind==='direct'&&change.author!==peerId&&change.author!==own)||!verifyMessageChange(change,publicKey))throw new Error('Invalid message change');
    if(change.changedAt>Date.now()+60000)throw new Error('Message change is from the future');if(Date.now()>=change.expiresAt)return;
    const existing=c.changes?.find(x=>x.author===change.author&&x.id===change.id&&x.type===change.type);if(existing&&(existing.action==='delete'||(change.action!=='delete'&&change.revision<=existing.revision)))return;
    const state=this.conversationState(c);let removed:{blobKey?:string;pending:PendingMessage[]}|undefined;let undoEdit=()=>{};
    if(change.action==='delete')removed=this.removeRecord(c,change.author,change.id,change.type);
    else{const message=c.messages.find(m=>m.id===change.id&&m.from===change.author);if(message){const {text,originalText,editedAt}=message;undoEdit=()=>{message.text=text;message.originalText=originalText;message.editedAt=editedAt;};message.originalText??=message.text;message.text=change.text!;message.editedAt=change.changedAt;}}
    this.putChange(c,change);if(!this.fitChangeBudget()&&change.action==='edit'){undoEdit();this.restoreConversationState(c,state);return;}
    await this.durable();if(removed)await this.forgetRemoved({blobKeys:[removed.blobKey],pending:removed.pending});
  }
  private currentOutgoing(invitation:OutgoingInvitation){if(this.outgoingInvitation!==invitation||this.stopped||invitation.operation.controller.signal.aborted||Date.now()>=invitation.expiresAt)return false;if(!invitation.sessionStarted)return this.pendingCall===invitation.operation;const live=this.pairs.get(invitation.peerId)?.session.getSnapshot();return live?.callId===invitation.callId&&live.callState==='outgoing';}
  private rememberEnded(peerId:string,callId:string,expiresAt:number){for(const [key,expiry] of this.endedCalls)if(Date.now()>=expiry)this.endedCalls.delete(key);if(this.endedCalls.size>=128)this.endedCalls.delete(this.endedCalls.keys().next().value!);this.endedCalls.set(peerId+':'+callId,expiresAt);}
  private async offerCallInvitation(invitation:OutgoingInvitation){
    if(!this.currentOutgoing(invitation)||invitation.ringing||invitation.offering||invitation.offered)return;
    invitation.offering=true;
    try{
      const capabilities=await this.getServices();if(!this.currentOutgoing(invitation)||invitation.ringing)return;
      if(!capabilities.callInviteV1||!capabilities.serverEpoch){await this.sendWake(invitation.peerId,'call',invitation.expiresAt-Date.now(),()=>this.currentOutgoing(invitation)&&!invitation.ringing);return;}
      invitation.serverEpoch=capabilities.serverEpoch;const contact=this.contacts.get(invitation.peerId);if(!contact)return;
      const invite=encryptCallPush(this.options.identity,contact.publicKey,invitation,capabilities.serverEpoch,{conversationId:invitation.conversationId,video:invitation.video},this.random);
      if(!this.currentOutgoing(invitation)||invitation.ringing)return;invitation.offered=true;
      const state=await this.requestFrame({type:'call-offer',to:invitation.peerId,callId:invitation.callId,issuedAt:invitation.issuedAt,expiresAt:invitation.expiresAt,serverEpoch:capabilities.serverEpoch,invite},'call-state');
      if(this.outgoingInvitation===invitation)this.handleCallState(state);
    }catch{/* Optional push never starts media or marks a call connected. */}finally{invitation.offering=false;}
  }
  private callAction(call:OpenedCallPush|OutgoingInvitation,action:'accept'|'decline'|'cancel'|'end'):Promise<CallState|undefined>{
    const otherId='callerId'in call?call.callerId:call.peerId;if(!call.serverEpoch||this.status!=='online')return Promise.resolve(undefined);
    return this.requestFrame({type:'call-action',otherId,callId:call.callId,serverEpoch:call.serverEpoch,issuedAt:call.issuedAt,expiresAt:call.expiresAt,action},'call-state');
  }
  private clearPendingIncoming(endSession:boolean){const incoming=this.pendingIncoming;this.pendingIncoming=undefined;clearTimeout(this.incomingExpiry);this.incomingExpiry=undefined;if(incoming){this.rememberEnded(incoming.callerId,incoming.callId,incoming.expiresAt);if(endSession){const session=this.pairs.get(incoming.callerId)?.session;if(session?.getSnapshot().callId===incoming.callId)session.endCall();}}this.emit();}
  private handleCallState(state:CallState){
    const own=this.options.identity.userId;if(state.callerId!==own&&state.calleeId!==own)return;const stateKey=state.callerId+':'+state.callId;const previous=this.callStates.get(stateKey);if(previous&&previous.serverEpoch===state.serverEpoch&&previous.revision>state.revision)return;if(this.callStates.size>=128&&!this.callStates.has(stateKey))this.callStates.delete(this.callStates.keys().next().value!);this.callStates.set(stateKey,{...state});if(state.state==='ended')this.rememberEnded(state.callerId===own?state.calleeId:state.callerId,state.callId,state.expiresAt);
    const incoming=this.pendingIncoming;
    if(incoming&&state.callId===incoming.callId&&state.callerId===incoming.callerId&&state.calleeId===own){
      const live=this.pairs.get(incoming.callerId)?.session.getSnapshot();
      if(state.state==='unknown'||state.serverEpoch!==incoming.serverEpoch){if(live?.callId!==incoming.callId||live.callState!=='active')this.clearPendingIncoming(true);return;}
      if(state.revision<incoming.revision)return;incoming.revision=state.revision;
      if(state.state==='ended'){this.clearPendingIncoming(true);return;}
    }
    const outgoing=this.outgoingInvitation;
    if(outgoing&&state.callId===outgoing.callId&&state.callerId===own&&state.calleeId===outgoing.peerId&&state.serverEpoch===outgoing.serverEpoch&&state.revision>=outgoing.revision){outgoing.revision=state.revision;if(state.state==='ringing'||state.state==='accepted'){outgoing.ringing=true;clearTimeout(outgoing.timer);}else if(state.state==='ended'){this.endCall();return;}}
    this.emit();
  }
  /** Terminal push data is only a reason to fetch authenticated current state. */
  async refreshCallState(callId:string,otherId:string,serverEpoch:string):Promise<CallState>{this.assertActive();const state=await this.requestFrame({type:'call-state-get',callId,otherId,serverEpoch},'call-state');const incoming=this.pendingIncoming;if(state.state==='unknown'&&state.callId===callId&&((state.callerId===this.options.identity.userId&&state.calleeId===otherId)||(state.callerId===otherId&&state.calleeId===this.options.identity.userId))&&incoming?.callId===callId&&incoming.callerId===otherId&&incoming.serverEpoch===serverEpoch){const live=this.pairs.get(otherId)?.session.getSnapshot();if(live?.callId!==callId||live.callState!=='active')this.clearPendingIncoming(true);}else this.handleCallState(state);return state;}
  openCallPush(envelope:string,intent:WakeIntent,signal?:AbortSignal):Promise<PendingIncomingCall>{this.assertActive();return this.track(this.openCallPushWork(envelope,intent,signal));}
  private async openCallPushWork(envelope:string,intent:WakeIntent,signal?:AbortSignal):Promise<PendingIncomingCall>{
    const check=()=>{this.assertActive();if(signal?.aborted)throw signal.reason??new Error('Call wake cancelled');};check();await this.restore();check();const header=callPushEnvelopeSchema.parse(JSON.parse(callPushSchema.parse(envelope)));const contact=this.contacts.get(header.senderId);if(!contact)throw new Error('Unknown call sender');if(this.blocked.has(header.senderId))throw new Error('Caller is blocked');
    const invitation=decryptCallPush(this.options.identity,contact.publicKey,envelope,intent);const conversation=this.conversations.get(invitation.conversationId);if(!conversation||conversation.kind!=='direct'||!conversation.memberIds.includes(invitation.callerId)||!conversation.memberIds.includes(this.options.identity.userId))throw new Error('Unknown direct call conversation');
    if((this.endedCalls.get(invitation.callerId+':'+invitation.callId)??0)>Date.now())throw new Error('Call was already ended');
    const active=this.getSnapshot().activeCall;if(active&&(active.peerId!==invitation.callerId||active.session.callId!==invitation.callId||active.session.callVideo!==invitation.video))throw new Error('Another call is already active');
    if(this.status!=='online')await this.beforeCallDeadline(invitation,this.connect(),signal);check();
    const capabilities=await this.beforeCallDeadline(invitation,this.getServices(),signal);check();if(!capabilities.callInviteV1||capabilities.serverEpoch!==invitation.serverEpoch)throw new Error('Call server epoch changed');
    const state=await this.beforeCallDeadline(invitation,this.requestFrame({type:'call-received',callerId:invitation.callerId,callId:invitation.callId,serverEpoch:invitation.serverEpoch},'call-state'),signal);check();
    if(state.callerId!==invitation.callerId||state.calleeId!==this.options.identity.userId||state.callId!==invitation.callId||state.serverEpoch!==invitation.serverEpoch||state.issuedAt!==invitation.issuedAt||state.expiresAt!==invitation.expiresAt||!['ringing','accepted'].includes(state.state)||Date.now()>=invitation.expiresAt)throw new Error('Call invitation is no longer current');
    if((this.endedCalls.get(invitation.callerId+':'+invitation.callId)??0)>Date.now())throw new Error('Call was already ended');
    const latest=this.callStates.get(invitation.callerId+':'+invitation.callId);if(latest&&(latest.serverEpoch!==invitation.serverEpoch||latest.state==='ended'||latest.state==='unknown'))throw new Error('Call invitation is no longer current');
    const live=this.getSnapshot().activeCall;if(live&&(live.peerId!==invitation.callerId||live.session.callId!==invitation.callId||live.session.callVideo!==invitation.video||(live.session.callExpiresAt!==undefined&&live.session.callExpiresAt!==invitation.expiresAt)))throw new Error('Another call is already active');
    if(this.pendingIncoming?.callId===invitation.callId&&this.pendingIncoming.callerId===invitation.callerId)return {...this.pendingIncoming};
    this.pendingIncoming={...invitation,state:'ringing',revision:state.revision};clearTimeout(this.incomingExpiry);
    this.incomingExpiry=setTimeout(()=>{if(this.pendingIncoming?.callId===invitation.callId){const snapshot=this.pairs.get(invitation.callerId)?.session.getSnapshot();this.clearPendingIncoming(snapshot?.callState!=='active');}},Math.max(1,invitation.expiresAt-Date.now()));
    this.emit();void this.ensurePair(invitation.callerId,true).catch(e=>this.report(e));return {...this.pendingIncoming};
  }
  async startCall(conversationId:string,video=false):Promise<void>{
    const c=this.conversations.get(conversationId);if(!c||c.kind!=='direct')throw new Error('Group calls are not implemented');if(this.getSnapshot().activeCall)throw new Error('Another call is already active');
    const previous=this.outgoingInvitation;if(previous){clearTimeout(previous.timer);clearTimeout(previous.expiry);}const peerId=c.memberIds.find(id=>id!==this.options.identity.userId)!;if(this.blocked.has(peerId))throw new Error('Contact is blocked');const operation=this.operation(conversationId,CALL_INVITE_TTL_MS,peerId);const issuedAt=Date.now();
    const invitation:OutgoingInvitation={callId:this.id(),issuedAt,expiresAt:issuedAt+CALL_INVITE_TTL_MS,peerId,conversationId,video,offered:false,offering:false,ringing:false,sessionStarted:false,revision:0,operation};this.outgoingInvitation=invitation;this.pendingCall=operation;
    invitation.timer=setTimeout(()=>{void this.offerCallInvitation(invitation);},2500);invitation.expiry=setTimeout(()=>{if(this.outgoingInvitation===invitation){const live=this.pairs.get(peerId)?.session.getSnapshot();if(live?.callState!=='active')this.endCall();}},CALL_INVITE_TTL_MS);this.emit();
    try{
      const pair=await this.waitForPeer(peerId,operation,'call');this.assertOperation(operation);if([...this.pairs.values()].some(p=>p.session.getSnapshot().callState!=='idle'))throw new Error('Another call is already active');
      let abort!:()=>void;const cancelled=new Promise<never>((_resolve,reject)=>{abort=()=>{pair.session.endCall();reject(operation.controller.signal.reason??new Error('Call cancelled'));};operation.controller.signal.addEventListener('abort',abort,{once:true});});
      try{invitation.sessionStarted=true;await Promise.race([pair.session.startCall(video,invitation),cancelled]);this.assertOperation(operation);}finally{operation.controller.signal.removeEventListener('abort',abort);}
    }catch(error){if(this.outgoingInvitation===invitation){void this.callAction(invitation,'cancel').catch(()=>{});this.outgoingInvitation=undefined;clearTimeout(invitation.timer);clearTimeout(invitation.expiry);}throw error;}
    finally{clearTimeout(operation.timer);if(this.pendingCall===operation)this.pendingCall=undefined;this.emit();}
  }
  private async beforeCallDeadline<T>(call:CallInvitation,work:Promise<T>,signal?:AbortSignal):Promise<T>{
    let timer:ReturnType<typeof setTimeout>|undefined;let abort:(()=>void)|undefined;
    try{return await Promise.race([work,new Promise<never>((_resolve,reject)=>{timer=setTimeout(()=>reject(new Error('Call invitation expired')),Math.max(0,call.expiresAt-Date.now()));abort=()=>reject(signal?.reason??new Error('Call wake cancelled'));if(signal?.aborted)abort();else signal?.addEventListener('abort',abort,{once:true});})]);}
    finally{clearTimeout(timer);if(abort)signal?.removeEventListener('abort',abort);}
  }
  async acceptCall():Promise<void>{
    const incoming=this.pendingIncoming;if(!incoming){const active=this.getSnapshot().activeCall;if(!active||active.session.callState!=='incoming')throw new Error('No incoming call');await this.pairs.get(active.peerId)!.session.acceptCall();return;}
    if(incoming.state==='accepted')throw new Error('Call answer is already pending');incoming.state='accepted';this.emit();
    return this.track((async()=>{
      try{const state=await this.beforeCallDeadline(incoming,this.callAction(incoming,'accept'));if(!state||state.state!=='accepted'||state.serverEpoch!==incoming.serverEpoch||state.callId!==incoming.callId||state.callerId!==incoming.callerId||state.calleeId!==this.options.identity.userId||state.issuedAt!==incoming.issuedAt||state.expiresAt!==incoming.expiresAt)throw new Error('Call answer is no longer current');
        while(this.pendingIncoming===incoming&&Date.now()<incoming.expiresAt&&!this.closing){const session=this.pairs.get(incoming.callerId)?.session,snapshot=session?.getSnapshot();if(snapshot?.callId===incoming.callId&&snapshot.callState==='incoming'&&snapshot.callVideo===incoming.video&&snapshot.callExpiresAt===incoming.expiresAt){await this.beforeCallDeadline(incoming,session!.acceptCall());if(this.pendingIncoming===incoming){clearTimeout(this.incomingExpiry);this.incomingExpiry=undefined;this.pendingIncoming=undefined;this.emit();}return;}await new Promise<void>(resolve=>setTimeout(resolve,100));}
        throw new Error('Call connection expired or was cancelled');
      }catch(error){if(this.pendingIncoming===incoming)this.clearPendingIncoming(true);throw error;}
    })());
  }
  rejectCall():void{const incoming=this.pendingIncoming;if(incoming){void this.callAction(incoming,'decline').catch(()=>{});this.clearPendingIncoming(true);return;}const active=this.getSnapshot().activeCall;if(active)this.pairs.get(active.peerId)?.session.rejectCall();}
  endCall():void{
    const invitation=this.outgoingInvitation;this.outgoingInvitation=undefined;if(invitation){clearTimeout(invitation.timer);clearTimeout(invitation.expiry);this.rememberEnded(invitation.peerId,invitation.callId,invitation.expiresAt);void this.callAction(invitation,'cancel').catch(()=>{});this.lastWake.delete('call:'+invitation.peerId);}
    const incoming=this.pendingIncoming;if(incoming){void this.callAction(incoming,'end').catch(()=>{});this.clearPendingIncoming(true);}const pending=this.pendingCall;this.pendingCall=undefined;if(pending){clearTimeout(pending.timer);pending.controller.abort(new Error('Call cancelled'));}const active=this.getSnapshot().activeCall;if(active)this.pairs.get(active.peerId)?.session.endCall();else if(pending)this.pairs.get(pending.peerId!)?.session.endCall();this.emit();
  }
  setMuted(muted:boolean):void{const active=this.getSnapshot().activeCall;if(active)this.pairs.get(active.peerId)?.session.setMuted(muted);}
  /** Turns the camera on or off in the active call (audio to video and back). */
  async setCallVideo(on:boolean):Promise<void>{const active=this.getSnapshot().activeCall;if(!active)throw new Error('No active call');const session=this.pairs.get(active.peerId)?.session;if(!session)throw new Error('No active call');await session.setVideo(on);}
  /** Called only by a foreground, focused chat; notification previews never call this. */
  markRead(conversationId:string):Promise<void>{if(this.closing)return Promise.resolve();return this.serial(async()=>{
    await this.restore();const c=this.conversations.get(conversationId);if(!c)return;
    // Snapshot only content already presented when reading began; later arrivals
    // must not ride an earlier persistence checkpoint into a false read receipt.
    const own=this.options.identity.userId,seenUnread=c.unread;
    const messages=c.messages.filter(m=>m.from!==own&&m.status==='received');
    const files=c.files.filter(f=>f.senderId!==own&&f.deliveryStatus==='received'&&f.status==='complete'&&f.blobKey);
    // Content presented so far must be on disk before a receipt for it; persist() is a no-op when
    // nothing changed, so opening an already-read chat no longer re-encrypts the whole history.
    await this.persist();const receipts=c.readReceipts??=[];
    const created:ReadReceipt[]=[];
    for(const message of messages)if(!receipts.some(r=>r.id===message.id&&r.type==='message'&&r.author===message.from&&r.reader===own))created.push(signReadReceipt(this.options.identity,{conversationId:c.id,author:message.from,id:message.id,type:'message',hash:contentHash('message',message.originalText??message.text)}));
    for(const file of files)if(!receipts.some(r=>r.id===file.id&&r.type==='file'&&r.author===file.senderId&&r.reader===own)){
      const data=await this.getFileData(c.id,file.id,file.senderId);if(data)created.push(signReadReceipt(this.options.identity,{conversationId:c.id,author:file.senderId,id:file.id,type:'file',hash:contentHash('file',data,file.name,file.mime)}));
    }
    const unread=c.unread;c.unread=Math.max(0,c.unread-seenUnread);
    if(!created.length&&c.unread===unread)return;
    receipts.push(...created);
    try{await this.durable();}catch(error){c.unread=unread;c.readReceipts=receipts.filter(r=>!created.includes(r));this.dirty=true;throw error;}
    for(const r of created)this.queueApp([r.author],['read',c.id,r.author,r.type,r.id,r.reader],r,Date.now()+OUTBOX_TTL_MS);
    void this.postMailbox().catch(()=>{/* The direct path still carries receipts. */});
    for(const author of new Set(created.map(r=>r.author)))this.wakePeer(author);
  });}
  private async acceptReadReceipt(peerId:string,receipt:ReadReceipt){
    const c=this.conversations.get(receipt.conversationId),own=this.options.identity.userId;
    const publicKey=receipt.reader===own?this.options.identity.publicKey:this.contacts.get(receipt.reader)?.publicKey;
    if(!c||!c.memberIds.includes(peerId)||!c.memberIds.includes(receipt.reader)||receipt.reader===receipt.author||!publicKey||!verifyReadReceipt(receipt,publicKey))throw new Error('Invalid read receipt');
    const record=receipt.type==='message'?c.messages.find(m=>m.id===receipt.id&&m.from===receipt.author):c.files.find(f=>f.id===receipt.id&&f.senderId===receipt.author);
    if(receipt.author!==own)throw new Error('Unknown read receipt origin');if(!record)return;if(!record.recipientIds?.includes(receipt.reader))throw new Error('Unknown read receipt origin');
    const hash='text'in record?contentHash('message',record.originalText??record.text):await this.getFileData(c.id,record.id,receipt.author).then(data=>data?contentHash('file',data,record.name,record.mime):undefined);
    if(hash!==receipt.hash)throw new Error('Read receipt content mismatch');
    if(record.readBy?.includes(receipt.reader)){await this.persist();return;}
    const previous=record.readBy;record.readBy=[...new Set([...(previous??[]),receipt.reader])];
    const receipts=c.readReceipts??=[];const duplicate=receipts.some(r=>r.id===receipt.id&&r.type===receipt.type&&r.author===receipt.author&&r.reader===receipt.reader);if(!duplicate)receipts.push(receipt);
    try{const pending=this.pending.find(p=>p.conversationId===c.id&&p.messageId===receipt.id&&(p.type??'message')===receipt.type);if(pending)await this.acknowledge(pending,receipt.reader,record);else await this.durable();}
    catch(error){record.readBy=previous;if(!duplicate)c.readReceipts=receipts.filter(r=>r!==receipt);this.dirty=true;throw error;}
  }
  /**
   * A message over the in-memory limit goes to the encrypted archive (same database, written in the
   * same transaction as the trimmed history) instead of being lost. A store without an archive drops it as before.
   */
  private archiveMessage(c:InternalConversation,message:MessengerMessage){
    if(!this.options.records||!this.records().archives)return;
    this.archiveQueue.push({key:archiveKey(c.id,message),json:JSON.stringify(message)});c.archived=(c.archived??0)+1;
  }
  /**
   * Keeps what was typed in a chat but not sent, as Telegram does. Saved with the history (encrypted);
   * pass `announce` when leaving the chat so the chat list shows the draft. Typing alone does not re-render.
   */
  setDraft(conversationId:string,text:string,announce=false):void{
    const c=this.conversations.get(conversationId);if(!c||this.closing)return;
    const next=text.trim()?text.slice(0,MAX_TEXT_CHARS):undefined;
    if(c.draft!==next){c.draft=next;this.dirty=true;this.scheduleSave();}
    if(announce)this.emit();
  }
  /** Older messages of a chat from the archive, newest first; pass the last `cursor` to read further back. Read-only. */
  async loadEarlier(conversationId:string,cursor?:string,limit=50):Promise<{messages:MessengerMessage[];cursor?:string}>{
    await this.restore();const c=this.conversations.get(conversationId);
    if(!c||!c.archived||!this.options.records||!this.records().archives)return {messages:[]};
    const rows=await this.records().readArchive(`a:${conversationId}:`,cursor,Math.max(1,Math.min(200,limit)));
    const messages=rows.map(row=>messageSchema.parse(JSON.parse(row.json))).filter(m=>m.conversationId===conversationId);
    return {messages,...(rows.length?{cursor:rows.at(-1)!.key}:{})};
  }
  private trimHistory(){
    const now=Date.now();for(const c of this.conversations.values()){if(c.changes?.some(x=>now>=x.expiresAt))c.changes=c.changes.filter(x=>now<x.expiresAt);if(c.tombstones?.some(x=>now>=x.expiresAt))c.tombstones=c.tombstones.filter(x=>now<x.expiresAt);}
    for(const c of this.conversations.values()){while(c.files.filter(f=>!f.blobKey).length>MAX_FILE_RECORDS_WITHOUT_DATA){const index=c.files.findIndex(f=>!f.blobKey&&f.deliveryStatus==='expired');if(index<0)break;c.files.splice(index,1);}if(c.receipts)c.receipts=c.receipts.filter(r=>c.messages.some(m=>m.id===r.id&&m.from===r.author)||c.files.some(f=>f.id===r.id&&f.senderId===r.author));}
    const pending=new Set([...this.pending.map(p=>p.conversationId+':'+p.messageId),...this.protectedReceive]);
    for(const c of this.conversations.values())while(c.messages.length>100){const index=c.messages.findIndex(m=>!pending.has(c.id+':'+m.id));if(index<0)break;this.archiveMessage(c,c.messages.splice(index,1)[0]!);}
    let count=[...this.conversations.values()].reduce((n,c)=>n+c.messages.length,0);
    while(count>MAX_HISTORY_MESSAGES){let oldest:InternalConversation|undefined;let index=-1;let timestamp=Infinity;for(const c of this.conversations.values())for(let i=0;i<c.messages.length;i++){const m=c.messages[i]!;if(!pending.has(c.id+':'+m.id)&&m.timestamp<timestamp){oldest=c;index=i;timestamp=m.timestamp;}}if(!oldest)break;this.archiveMessage(oldest,oldest.messages.splice(index,1)[0]!);count--;}
    for(const c of this.conversations.values())if(c.readReceipts)c.readReceipts=c.readReceipts.filter(r=>r.type==='message'?c.messages.some(m=>m.id===r.id&&m.from===r.author):c.files.some(f=>f.id===r.id&&f.senderId===r.author));
    // A reaction lives as long as its message; a taken-back one only until every peer had a week to hear about it.
    for(const c of this.conversations.values())if(c.reactions){c.reactions=c.reactions.filter(r=>(r.emoji||now<r.expiresAt)&&this.hasRecord(c,r.author,r.id,r.type));if(!c.reactions.length)c.reactions=undefined;}
    const all=[...this.conversations.values()].flatMap(c=>(c.reactions??[]).map(r=>({c,r})));
    if(all.length>MAX_TOTAL_REACTIONS){const drop=new Set(all.sort((a,b)=>a.r.reactedAt-b.r.reactedAt).slice(0,all.length-MAX_TOTAL_REACTIONS).map(x=>x.r));for(const c of this.conversations.values())if(c.reactions)c.reactions=c.reactions.filter(r=>!drop.has(r));}
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
    if(this.outgoingInvitation||this.pendingIncoming||this.pendingCall)this.endCall();clearTimeout(this.expiryTimer);this.expiryTimer=undefined;
    this.stopped=true;++this.epoch;this.cancelOpening?.();this.cancelOpening=undefined;clearTimeout(this.wakeTimer);this.wakeTimer=undefined;clearTimeout(this.reconnect);this.reconnect=undefined;
    const socket=this.socket;this.socket=undefined;this.services=undefined;this.servicesRequest=undefined;this.wakeCapabilitiesRequest=undefined;if(socket){socket.onmessage=null;socket.onclose=null;socket.onerror=null;socket.close();}
    for(const request of this.requests.values()){clearTimeout(request.timer);request.reject(new Error('Disconnected'));}this.requests.clear();
    for(const pair of this.pairs.values()){clearTimeout(pair.retry);clearTimeout(pair.pump);pair.session.disconnect();}this.pairs.clear();
    for(const [id,user] of this.contacts)this.contacts.set(id,{...user,online:false});this.status='offline';clearTimeout(this.savedTimer);this.savedTimer=undefined;void this.persist().catch(error=>this.report(error));this.emit();
  }
}
