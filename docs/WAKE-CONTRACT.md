# Direct-first wake and bounded Android background sync

## Status: 0.6.0/code9, 2026-10-30

0.6.0 adds encrypted text/file-name previews, authenticated notification routes,
managed Android lockscreen calls, voice notes and video circles. This supersedes
the earlier generic-only FCM requirement. Own AndroidAPI36 emulator evidence is
recorded in [native acceptance](reports/debugging/2026-10/native-060.md): secure
lock text preview, actual text/file tap routes and explicit locked audio answer
with >18s bidirectional RTP. Physical devices/OEM/carriers and iOS remain separate.

## Prior 0.5.1 native evidence

Production FCM and authenticated TURN are configured. Android 0.5.0/code6 has
actually received a generic notification after Home and ordinary process death;
tapping opened the client and a waiting peer text received a durable recipient
ACK. This was not force-stop, automatic headless synchronization, physical-phone
carrier acceptance or native incoming-call ringing.

Android 0.5.1/code7 adds the bounded background path below. On the project's Android
emulator, the final APK process was confirmed absent after ordinary process
termination. Real FCM cold-started background sync without tapping or foreground
UI: text and a 35-byte file received durable ACK at 5728ms in one measured run,
over a direct route. This is not physical-phone, locked-screen or carrier acceptance.
Separate foreground takeover after a cold wake completed both ACKs at 6786ms,
recovering from one transient session error. After offline force-stop and manual
launch, saved text/file entries remained visible and the profile was preserved;
force-stop was a persistence test, not successful push delivery in that state.
Do not infer broader success from provider acceptance,
a token registration, source implementation or unit tests. APNs/PushKit/CallKit
remain separate; managed Android calls have emulator acceptance; physical phones remain unverified.

## Content and delivery boundary

FCM/server never receive plaintext message text, file names/bytes, media, SDP or
private identity seeds. In 0.6.0, a bounded encrypted text or file-name preview may transit the
server and provider by explicit user direction. FCM may transiently queue that
ciphertext until TTL<=60s. It is content handling, not the old claim that no chat
content ever reaches FCM; no server DB mailbox or full-history queue is added.
Visible envelope headers include sender/recipient IDs, version, kind, intentId and
expiry. Profiles/public device keys/display names, push tokens, consent and quotas
remain directory metadata. Signaling forwards opaque encrypted SDP/candidates;
TURN forwards encrypted traffic without a chat archive. The private installation
seed remains only on the device.

Sender-held encrypted text/files wait up to seven days; retries/restart/
peer forwarding preserve original expiry. There is no server content mailbox.
Only successful recipient persistence permits a real peer ACK. FCM acceptance
never marks content delivered. See [outbox contract](OUTBOX-CONTRACT.md).

Core strict wake frame retains legacy `{type:'wake',to}` and the all-or-none
triple `kind:'message'|'file'|'call', intentId:32hex, expiresAt:safe integer ms`.
Optional `preview:string` is accepted only with a complete matching message/file intent; other
extra fields and partial triples fail validation. Direct transfer starts first;
after 2500ms without ACK the manager may request wake. Generic wake keeps its
30s recipient cooldown; preview retries are keyed by recipient/item with
bounded retry, and calls/preview use independent dedup/quota checks so an earlier
data notice does not hide a new call/message. Actual ACK, expiry or sender
disconnect stops unnecessary wake; wall-clock rollback does not strand retry.

Each intent lasts at most 60s for message/file, 30s for call; expiry is checked
again before provider invocation. Expiry-cleaned dedup is bounded to 4096 sender+
recipient+intent entries, with no persistent intent/content queue. Consent,
hourly quotas and concurrency limits remain mandatory: sender 120/hour, global
1000/hour, preview recipient 240/hour, typed-call recipient 120/hour, at most
8 concurrent provider requests. A new typed call has its own intent, independent
of the prior call's 30s cooldown; finishing/cancelling its pending operation clears
the sender's call cooldown. Replaying an intent remains deduplicated. A directory profile
alone does not authorize unsolicited unlimited wake. Calls have a local outgoing
state before connecting; cancellation/expiry forbids late auto-start. Microphone
acquisition remains an explicit call action, never a push background action.

## Application data-channel readiness

Native WebRTC 155 can expose an already-open data channel before the JavaScript
wrapper has installed its receive handlers. In the reproduced failure the initial
text and file-start/chunks were absent, while file-end arrived; waiting for that
file's content ACK then blocked queued text retries. Transport-open alone therefore
does not establish application readiness.

Both updated peers opt in through the experimental LastCall SDP attribute
`a=x-lastcall-data-ready:1` inside authenticated encrypted signaling. The attribute
is removed before native SDP processing. This is a private experimental capability,
not an IANA-registered SDP attribute or a new security/identity mechanism. Install
handlers first and handle a channel that is already open. For negotiated support,
exchange `ready`/`ready-ack` with a random per-channel challenge, retry every 250ms,
and fail after 5s; bound readiness traffic to 64 frames per 5s. Connection reporting,
content sends and recovery completion wait for that readiness exchange. It never
replaces a recipient's separate durable content ACK.

No new readiness frame is sent to a legacy peer; mixed versions retain the previous
behavior. Both endpoints must update to 0.5.1 for this protection. The final APK
passed the cold-wake text/small-file emulator case above; larger files, physical
devices and carrier behavior require separate verification.
[RFC8832](https://www.rfc-editor.org/rfc/rfc8832.html) permits application data before
DCEP ACK; [RFC8866](https://www.rfc-editor.org/rfc/rfc8866.html) requires ignoring
unknown attributes and defines attribute registration. These standards explain the
boundary; they do not prove this native implementation passes its acceptance tests.

## Per-token compatibility

Authenticated `push-register` retains the legacy token/requestId shape and adds
optional `backgroundSync:boolean` and separate `messagePreview:boolean`. Both
are per-token, default false in DB migration/re-registration. Absent/false preserves
legacy notification+data. `messagePreview` requires successful background task and
native preview presentation preparation; registration failure must leave it off.
Only a client with successful native background-task registration sends true;
a token rotation/re-registration must accurately reflect current capability.
The server applies the stored capability per target token, not globally to all
installed clients. Existing 0.5 clients keep their tap-to-open notification.

FCM data always contains `kind:'lastcall-wake'` and, for typed intents,
`intentKind`, `intentId`, `expiresAt` strings. Legacy delivery includes generic
`notification` title/body. Opted-in delivery omits that top-level notification
and supplies generic visible presentation fields in data for the Android handler.
Published 0.5.1 tokens keep the generic path even when a new sender supplies a
preview; the server does not forward preview to an incapable token. Generic data
keeps the established channel/collapse/TTL behavior. An opted-in 0.6.0 preview uses
high-priority data-only FCM with `preview` ciphertext, never plaintext presentation
fields. The recipient decrypts and posts its local notification. FCM acceptance,
preview decryption and notification display are never a content ACK.

## Encrypted text and file-name preview contract

Use the existing pair secret with domain-separated HKDF and XChaCha20-Poly1305.
Authenticate version, sender/recipient IDs, kind, intentId and original deadline
as AAD; use a fresh 24-byte nonce. The encrypted payload contains only existing
conversationId, messageId, preview kind, bounded text or file name and truncated flag.
No file bytes, voice samples or video frames travel in FCM. Limit message text to 800 UTF-8 bytes,
never split a Unicode code point; JSON escaping/1100-byte plaintext budget may
truncate earlier. Bound serialized opaque envelope to 3000 UTF-8 bytes and the
complete provider data object to 4096 bytes. Preview accompanies only matching
message/file intents; calls retain generic wake. Incapable recipients retain generic
file wake. Provider TTL is capped 60s; an existing
5s clock-skew allowance in validation must not extend provider storage.

Server validates bounded header/intent/authenticated sender/recipient binding,
expiry, target capability, consent and quotas before forwarding; it never decrypts
or stores the envelope in the directory database. The recipient must load its
existing identity, pin-check sender key and verify an existing conversation's
membership before decryption/display. Unknown pairs/groups, tamper, expired/mixed
intent or unavailable key storage fail closed. Do not create users/chats or insert
a preview as durable history. Original P2P record plus durable ACK remains the only
delivery boundary. Deduplicate notification identity by server/identity scope,
original sender, conversation and message, so preview and P2P receipt update one
notification without duplicate alerts.

## Authenticated local routing after a notification tap

Tapping a text or file notification must resolve the existing direct chat, or the
actual group for a group item, on both warm and cold startup. Restore the saved
identity/profile/state before resolving a cold route. Validate authenticated preview
or trusted local-notification context, server/identity scope, pinned sender and
existing conversation membership; reject forged/stale cross-account targets.
Never open a payload URL or create a conversation from untrusted identifiers.
A generic legacy notification may open the app without an exact chat target.
Routing is not receipt: do not insert preview content, create a content ACK or
claim file bytes are present merely because its name was displayed. Test both
text/file and direct/group cold/warm paths separately from P2P delivery.

## Android lockscreen and managed incoming calls

Native message notifications must set `VISIBILITY_PUBLIC` themselves; setting an
Expo notification channel alone does not prove secure-lockscreen visibility.
Android notification/channel/privacy settings can hide all or some content. This
is a user-requested plaintext display on their device, not plaintext FCM transport.
Native adapter secure-lockscreen audio acceptance is recorded in the linked report.

CallKeep 4.6.1 supplies managed Telecom/ConnectionService UI, not media/signaling.
The user must enable the LastCall phone account once through the foreground
Settings button, grant `READ_PHONE_NUMBERS`/`CALL_PHONE` and pregrant microphone
access. Do not request `READ_CONTACTS` or `READ_CALL_LOG`, change username
registration or demand a default-dialer replacement. A live authenticated incoming
session callId is required to ring; push alone must not create a ringing call.
Reject forged/expired/cancelled invites and stale native actions; a second call
must not reuse the previous answer/end event.

Ringing service uses `phoneCall` type 4 without microphone capture. Only an explicit
answer with `RECORD_AUDIO` already granted can start audio service with
`phoneCall|microphone` type 132 and then call accept/WebRTC microphone acquisition.
Cancellation, reject, end, timeout and failed answer must stop services, remove
native calls and release runtime ownership. The ordinary cold 9s sync window is
not a call-lifetime guarantee: live calls need manager pinning and a native
ReactHost lease. The SDK58 app-loader delegate is wrapped through the generated
manifest provider: queue host invalidation only while a real call lease is held,
then delegate cleanup after release. No edits to installed node_modules are used.
API 36 locked ringing beyond 12s, answer with real audio RTP beyond 15s,
reject/cancel/second-call and complete service/host cleanup still need final
0.6.0 APK acceptance; source or a 0.5.2 candidate does not establish that pass.

Primary references: [FCM data/encryption/4KB](https://firebase.google.com/docs/cloud-messaging/customize-messages/set-message-type),
[FCM TTL](https://firebase.google.com/docs/cloud-messaging/customize-messages/setting-message-lifespan),
[CallKeep 4.6.1](https://github.com/react-native-webrtc/react-native-callkeep/releases/tag/4.6.1),
[Android notification privacy](https://developer.android.com/develop/ui/compose/notifications/create-notification#set-lock-screen-visibility),
[Android service types](https://developer.android.com/develop/background-work/services/fgs/service-types).

## Native execution boundary

Define the SDK58 TaskManager task at module scope before loading Router. Register
it once through Notifications; registration failure must not opt a token into
the data-only path. Parse bounded raw/serialized task, receipt and tap payloads;
reject malformed/expired intents and deduplicate callback sources. Display only
generic fallback or authenticated locally decrypted preview; never log tokens,
envelopes, decrypted text, SDP or private account details.

Reuse the existing installation profile, key and encrypted storage in the same
Android ReactHost runtime. A cold task must not create an identity or registration,
show permission prompts, open a microphone or auto-answer. Keep one runtime owner
and transfer ownership safely when foreground opens; avoid concurrent storage
writers, replacing a live UI manager or tearing down UI-owned transports.

The target transport window is at most 9s, bounded further by intent expiry;
then await encrypted storage drain before task-owned cleanup within the short
OS execution budget (target total 15s). Timeout is not delivery. Large/slow files
may need later attempts from the seven-day sender queue; no continuous headless
WebRTC process or whole-file completion within one wake is promised. Existing
SecureStore accessibility and user identity must not be weakened or regenerated.

Force-stop needs a manual launch; no network, a powered-off device, OS battery
policy or unavailable sender may prevent delivery. Physical phones, locked state,
ordinary process death and cellular networks require their own acceptance.

## Verification

Retain legacy generic-notification+tap behavior, consent/quota/TTL/cancellation,
strict schemas and no-plaintext/no-mailbox provider tests. Add encrypted preview
AEAD/size/Unicode/escaping/expiry/header/capability/membership/dedup checks with no
preview-driven ACK, bounded file-name preview, scoped cold/warm chat routing and
voice/circle attachment queue semantics. Native acceptance must separately cover PUBLIC text/file names on secure
lockscreen, no-tap cold preview versus full ACK, phone-account enable, locked
answer/reject/end/second-call/caller-cancel and service/runtime cleanup. New focused tests cover successful/
failed task opt-in, malformed/expired/deduplicated intent, bounded work/storage
drain, existing-identity-only startup and foreground takeover. Native testing
must separately establish tray receipt, no-tap durable ACK, small-file bytes,
ordinary process death, persistent history and cleanup without microphone use.
Voice/video capture is a separate explicit foreground action, never part of a
push task; see [attachment/media contract](OUTBOX-CONTRACT.md).
