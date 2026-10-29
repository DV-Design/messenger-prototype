# Direct-first wake and bounded Android background sync

## Status: 0.5.1/code7, 2026-10-29

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
and Android system incoming-call integration are separate.

## Content and delivery boundary

FCM carries no chat text, file bytes/names, media, SDP, identity keys or sender
names. The coordination server retains profiles, public device keys, display
names, push tokens, consent and quotas; signaling forwards opaque encrypted
SDP/candidate envelopes without storing chat payload. TURN forwards encrypted
traffic without a chat archive. The private identity seed never leaves the device.
Sender-held encrypted text/files wait up to seven days; retries/restart/
peer forwarding preserve original expiry. There is no server content mailbox.
Only successful recipient persistence permits a real peer ACK. FCM acceptance
never marks content delivered. See [outbox contract](OUTBOX-CONTRACT.md).

Core strict wake frame retains legacy `{type:'wake',to}` and the all-or-none
triple `kind:'message'|'file'|'call', intentId:32hex, expiresAt:safe integer ms`.
Partial triples and extra content fail validation. Direct transfer starts first;
after 2500ms without ACK the manager may request a generic wake. Per-recipient
cooldown is at least 30s, separately for calls/data. Actual ACK, expiry or sender
disconnect stops unnecessary wake; wall-clock rollback does not strand retry.

Each intent lasts at most 60s for message/file, 30s for call; expiry is checked
again before provider invocation. Expiry-cleaned dedup is bounded to 4096 sender+
recipient+intent entries, with no persistent intent/content queue. Consent,
hourly quotas and concurrency limits remain mandatory. A directory profile
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
optional `backgroundSync:boolean`. Absent/false keeps legacy notification+data.
Only a client with successful native background-task registration sends true;
a token rotation/re-registration must accurately reflect current capability.
The server applies the stored capability per target token, not globally to all
installed clients. Existing 0.5 clients keep their tap-to-open notification.

FCM data always contains `kind:'lastcall-wake'` and, for typed intents,
`intentKind`, `intentId`, `expiresAt` strings. Legacy delivery includes generic
`notification` title/body. Opted-in delivery omits that top-level notification
and supplies generic visible presentation fields in data for the Android handler.
Neither form contains content. Both retain high priority, short remaining TTL,
collapse behavior and `lastcall-messages` channel. Call copy invites opening
LastCall; it is not an OS incoming-call screen.

## Native execution boundary

Define the SDK58 TaskManager task at module scope before loading Router. Register
it once through Notifications; registration failure must not opt a token into
the data-only path. Parse bounded raw/serialized task, receipt and tap payloads;
reject malformed/expired intents and deduplicate callback sources. Show only a
generic notification; never log token/intent payloads or personal data.

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
strict schemas and no-content provider tests. New focused tests cover successful/
failed task opt-in, malformed/expired/deduplicated intent, bounded work/storage
drain, existing-identity-only startup and foreground takeover. Native testing
must separately establish tray receipt, no-tap durable ACK, small-file bytes,
ordinary process death, persistent history and cleanup without microphone use.
