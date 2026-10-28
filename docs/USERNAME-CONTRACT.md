# LastCall 0.4: server registration without phone numbers

Latest user instruction supersedes phone verification/discovery. One device
installation key owns one immutable username on each selected server. Server
checks uniqueness and confirms registration before it appears locally as complete.
Display names may repeat. Existing registered profiles, device keys, chat history
and pair identities survive upgrade. Usernames remain ASCII lowercase 3..24
letters/digits/underscore, optional @ stripped by client. No hardware fingerprint
or new password/phone is introduced. Losing the installation key is not recoverable
from a public username alone and may allow a fresh installation identity.

## Ownership and existing dependencies

Core: packages/core. Server: apps/server. Mobile: apps/mobile. Main: docs, root
manifests/lock, deployment, independent verification, APK/publication/git/beads.
Read related code/history first; preserve legacy ready frame and existing clients.
Use existing noble Ed25519/Zod/node:sqlite/SecureStore rather than new auth stacks;
binding/uniqueness/catalog are core product logic. No new dependency expected.

## Immutable identity and authoritative profile

Existing authenticate retains signed username/name input. First valid registration
inserts atomically with UNIQUE username/userId. Existing identity with a different
username returns terminal `device-already-registered`; it must never release or
replace its original username. Same username reconnect returns canonical persisted
profile; reconnect must not rewrite displayName from a stale local cache. Existing
profiles become fixed at their currently stored username; do not regenerate users.

Add signature helpers exported from core:
`profileResolvePayload(challenge,publicKey):Uint8Array` = UTF8 JSON.stringify
(['lastcall/profile-resolve/v1', challenge, publicKey]);
`signProfileResolve(identity,challenge):string`,
`verifyProfileResolve(publicKey,challenge,signature):boolean`.
Use existing strict Ed25519 key validation and a one-time 15s challenge. Resolver
is a separate short-lived WS connection and does not create/publish/authenticate
a new user or change presence. Consume challenge before verification; replay,
cross-purpose signatures and tampering fail.

New client frame `{type:'resolve-profile',publicKey:64hex,signature:128hex}`.
New server frame `{type:'profile',user:DirectoryUser|null}` after valid signature.
No username-only recovery or raw key/identifier in URLs/logs. Helper exported:
`resolveDeviceProfile(serverUrl:string,identity:DeviceIdentity):Promise<DirectoryUser|null>`.
It preserves gateway prefix, checks returned identity, bounds frames/timeouts,
closes socket on success/error/timeout and never silently treats network error as
unregistered. Native global WebSocket compatible. No extra properties in ready.

## Server directory synchronization and search

New authenticated client frame `{type:'list-users',requestId:32hex,cursor?:username}`.
New server frame `{type:'users-page',requestId,users:DirectoryUser[] max100,nextCursor?:username}`.
`DirectoryPage` exported type matching users/nextCursor; no requestId in public type.
`MessengerClient.listUsers(cursor?:string):Promise<DirectoryPage>` uses existing
bounded/correlated requests. Stable keyset order by unique username, fetch101 to
derive next cursor, no offset, no private data. No automatic contacts/chats for all
catalog entries. Authentication mandatory. Existing per-socket quotas apply.

Existing search query max becomes48 (displayName max48); existing results shape
unchanged. Match login prefix or displayName substring with Unicode NFKC+lowercase
case folding on query and name, including Russian uppercase/mixed case; trim query
and strip @ in client. Literal %/_/backslash remain literals, no SQL interpolation.
No complete-directory dump on each keystroke. Offline profiles remain searchable.

Mobile Contacts: server directory distinct from saved chat contacts, page100 with
load-more and refresh. Fetch on focus/reconnect/resume and every30s while focused
and foreground; stop polling off-screen/background. Search over full server query,
debounced, latest request wins. Clear/flag results on server/context change; stale
responses cannot append to a new query/catalog. Don't start P2P until user chooses
an entry. Local cache optional and bounded; don't fabricate directory sync offline.

Mobile bootstrap uses resolver when saved profile is absent and the device key
exists. Registration checks server before confirmation and never offers another
username after a server binding exists. Save canonical ready/resolved profile,
including recovery after failed local profile save; guard double-submit and do not
silently reset identity. Cached profile supports offline history. Reconnect can
refresh canonical name from ready without repetitive saves on every message.

## Phone feature retirement and independent push

Remove active phone/SMS/discovery routes/bridges/buttons from mobile. Phonebook
registration/discovery and contacts permission are no longer required for this
product flow. Remove unused mobile-only phonebook modules/dependency if safe;
do not delete user key/history or silently wipe persisted user data. Keep push,
camera/mic/photos setup. Version0.4.0/code5; config plugins only, no native edits.
Server production config no longer enables SMS.ru; old phone RPCs may stay as
disabled compatibility stubs or isolated legacy code, but public capabilities
must report phoneVerification=false and phoneVerified=false and no real SMS may
be sent. Preserve FCM and authenticated ICE independently. No need for SMS account.
Firebase remains a separate requirement for Android closed-app notifications.

## Validation

Server regressions: same key cannot rename (old username still occupied), concurrent
different keys claim same login onlyonewins, canonical profile survives DB reopen,
resolver valid/unknown/replay/crosspurpose/no registration, pagination complete and
bounded/no duplicates, unauthenticated list denied, Russian name case folding.
Core strict schemas/correlation/resolver cleanup/timeouts/identity mismatch.
Mobile meaningful pure tests for registration outcome/state and catalog request
generation as useful; no screenshot matrix. Root gates and existing Chrome media
checks must pass. Native upgrade, same certificate, signed versioned APK/download
bytes, public search/resolve and tasks verified before commit/push.
