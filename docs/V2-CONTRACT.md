# Version 0.2: persistent user presence and multi-conversation P2P

User explicitly corrected the prototype: persistent server coordination for all users,
direct content/media, familiar Telegram/WhatsApp-style UI. No bots/channels/backups.
User asks not to spend heavily on UI tests; validate functional multi-client scenarios.

## Ownership

- Core agent: packages/core only, including directory schemas, identity helpers,
  MessengerClient, PeerSession extensions and meaningful core tests.
- Server agent: apps/server only, directory SQLite persistence + WS /directory,
  existing /signal retained, relevant server tests. No core or infra edits.
- Mobile agent: apps/mobile only, native familiar UI, SecureStore identity, encrypted
  local state adapter, Expo Router, version0.2.0/versionCode2. Main installs deps.
- Main: stable public gateway /messenger on lienad.ru, root/infra/docs, installation,
  independent verification, release APK/deployment/commit/push.

Read existing code and history before edits. Do not edit another owner's files,
root manifests/lock, generated Android/iOS dirs, or unrelated services.

## Gateway and existing transport

Primary base URL: https://lienad.ru/messenger (existing hostname resolves normally).
All core fetch/WS paths MUST preserve a base URL path, e.g. /messenger/ice,
/messenger/signal, /messenger/directory. New endpointUrl(base,path) helper exported.
Caddy strips /messenger before proxying. Legacy p2p.lienad.ru remains compatible.
Existing two-peer rooms are private transport sessions, not a global app limitation.
Manager retains independent sessions to different contacts; backing out of a chat
MUST NOT disconnect all sessions or directory presence.

## User identity and directory (freeze names)

DeviceIdentity = {privateKey:string,publicKey:string,userId:string}; Ed25519 seed
32-byte hex and public key64hex; userId=SHA256(publicKey bytes)64hex.
DirectoryUser = {userId,publicKey,username,displayName,online:boolean,lastSeen:number}.
username regex ^[a-z0-9_]{3,24}$, displayName1..48 chars. Stable usernames are unique.
No phone/SMS required in preview. Seed stored in platform SecureStore, never server.
Core exports createDeviceIdentity(randomBytes?), userIdFromPublicKey(publicKey),
authenticationPayload(challenge,publicKey,username,displayName):Uint8Array,
signAuthentication(identity,challenge,username,displayName):string,
verifyAuthentication(publicKey,challenge,username,displayName,signature):boolean,
conversationInvite(identity,remotePublicKey):string. Use audited noble-curves
Ed25519/X25519+domain-separated HKDF, not a new cryptographic primitive.
Authentication payload = UTF8(JSON.stringify(['messenger-directory/v1',challenge,
publicKey,username,displayName])). Challenge random32hexbytes, one-time, 15s expiry.
Server uses helpers, checks userId matches key, persists profiles in node:sqlite;
online and socket ownership are ephemeral. Persistence is directory metadata only.
No production ratchet/key transparency claim; contact keys pinned by userId.

Directory WS /directory, schemas directoryClientFrameSchema/directoryServerFrameSchema:
server challenge: {type:'challenge',challenge:string64hex}
client authenticate: {type:'authenticate',publicKey,username,displayName,signature128hex}
server ready: {type:'ready',self:DirectoryUser}
client search: {type:'search',query:string0..24,requestId:string32hex}
client lookup: {type:'lookup',userIds:string64hex[],requestId:string32hex} max200
server results: {type:'results',requestId,users:DirectoryUser[]} max200
client watch: {type:'watch',userIds:string64hex[]} max200; replace subscriptions
server presence: {type:'presence',user:DirectoryUser} only subscribed users
client connect: {type:'connect',to:string64hex}
server connect: {type:'connect',from:DirectoryUser} only authenticated sender
server error: {type:'error',code:string,message:string,requestId?:string32hex}
Optional client ping/server pong only if necessary; WS protocol heartbeat sufficient.
Unknown/invalid frames rejected; bounds/rate limits apply. No chat/file/media payload
is accepted on directory WS. Offline peer => error code peer-offline.
One live directory socket per identity; replacement must not let old close mark new
socket offline. Username conflicts code username-taken. Store DB path via
DIRECTORY_DB_PATH, default :memory: in tests, persistent volume in public deployment.
Raise public-config peer capacity deliberately (currently proxy shares one IP),
without blindly trusting X-Forwarded-For. Server options add bounds via env if needed.

## Shared MessengerClient public API (freeze names)

MessengerOptions: {serverUrl,identity:DeviceIdentity,username,displayName,
randomBytes?,rtcFactory?,getUserMedia?,onChange?:(MessengerSnapshot)=>void,
loadState?:()=>Promise<string|null>,saveState?:(sealed:string)=>Promise<void>}
Use same platform injections as PeerSession. Persist bounded contacts, groups and
text history encrypted with a domain-separated key derived from device seed.
Never persist plaintext private key in file state; serialize/throttle writes.

MessengerSnapshot = {status:'idle'|'connecting'|'online'|'offline'|'error',
self?:DirectoryUser,contacts:DirectoryUser[],conversations:Conversation[],
activeCall?:{conversationId:string,peerId:string,session:SessionSnapshot},error?:string}
Conversation = {id:string,kind:'direct'|'group',title:string,memberIds:string[],
messages:MessengerMessage[],files:MessengerFile[],unread:number,updatedAt:number,
session?:SessionSnapshot}
MessengerMessage = {id:string,text:string,from:string64hex,timestamp:number,
status:'pending'|'sent'|'delivered'|'received',conversationId:string}
MessengerFile extends SharedFile with {senderId:string,conversationId:string}.
Direct conversation IDs dm:<pairHash64hex>; group IDs group:<random32hex>.

new MessengerClient(options); connect():Promise<void>, disconnect():void,
getSnapshot():MessengerSnapshot, search(query):Promise<DirectoryUser[]>,
addContact(user:DirectoryUser):Promise<string> (returns direct conversation ID),
createGroup(title:string,userIds:string[]):Promise<string>,
sendText(conversationId,text):Promise<void>,
sendFile(conversationId,{name,mime,data:Uint8Array}):Promise<void>,
startCall(conversationId,video?):Promise<void>, acceptCall():Promise<void>,
rejectCall():void,endCall():void,setMuted(boolean):void,markRead(conversationId):void.

On connect authenticate directory, restore state, watch contacts, reconnect with
bounded backoff. On demand/remote connect create deterministic pair PeerSession
from ECDH-derived invitation; no user copy/paste per conversation. Auto-reconnect
after connectivity loss. Pending text stays local; send after peer comes online.
No false delivered marks: extend data protocol with text acknowledgements.
Avoid connect-notification ping-pong; incoming connect ensures session without
echoing connect. Already connected sessions remain alive on chat/tab switches.
Pending groups: small groups max8 members; group definition sent directly through
authenticated P2P application frames, not readable server payload. Creator-only
definitions, membership validated, direct fanout of text/files to members. Group
calls not implemented in this milestone (explicit UI disable, no pretend control).
Preserve old PeerSession methods, probe and tests. Optional conversationId/messageId
for text/file and bounded application frames are allowed extensions; core agent
chooses exact internal API without breaking old public call sites.

## Mobile UI

Familiar light native interface, standard fonts, avatars, chat rows, message previews,
timestamps/unread counters; chat screen bubbles and bottom attachment/composer bar.
Contact search by @username, new-group selection, profile/settings separate from chat.
No large diagnostics/server/secret panels on main screen. Technical connection
details under settings only. Global incoming call presentation independent of open
chat. Expo Router required by local AGENTS.md; use current SDK58 versioned docs.
SecureStore stores identity/profile, Expo FileSystem persists SEALED core state.
Do not clear presence when navigating. Background delivery still constrained by
OS; do not voluntarily disconnect just because another screen is open. No claim
of APNs/FCM or always-on background service in this build.

## Validation

DNS failure reproduced with default resolver. Primary gateway must work with normal
DNS and TLS (no curl --resolve, fixed-IP TLS bypass or advice to disable TLS).
Backend functional tests: >=3 identities, search/presence, spoofed auth rejection,
username uniqueness, replacement/reconnect and database reopen. Core: identity,
shared secret symmetry, prefix paths, bounded encrypted persistence, message ACKs.
Integration: 3 live clients, A-B and A-C sessions independent, group text fanout,
remote call notification while another chat is open. Existing media tests kept;
no screenshot matrix, no broad UI test expansion. Build standalone APKv0.2.0 with
same signing cert, publish atomic download, keep old installer rollback copy.
