# Direct delivery first, short-lived wake intents second

0.5 supersedes the sender-memory file wait below: durable sender-held text/files
wait up to seven days, restore after restart and retry per recipient. An individual
push intent still expires within60s (call30s); FCM never carries the content or
the seven-day queue. See [active outbox contract](OUTBOX-CONTRACT.md). The old
60s file-memory-only readiness behavior below records the 0.4 checkpoint only.

Extends the active 0.4 username/branding milestone after the latest user request.
No chat/media/file payload is accepted or stored by the coordination server.
It retains profiles/device push tokens/consent/quotas only. Content queue stays
on sender; no offline mailbox. Always-instant delivery under offline/OS suspension
is impossible. FCM/APNs acceptance is never a recipient ACK.

Core/server strict wake frame retains legacy `{type:'wake',to}` and adds an all-or-
none triple: `kind:'message'|'file'|'call', intentId:32hex, expiresAt:positive safe
integer milliseconds`. Partial triples/extra content are rejected. Export
`WakeKind`, `WakeIntent={kind,intentId,expiresAt}` and schema from core. No server
receipt frame. Existing ready/old clients stay compatible.

Text: attempt ordinary P2P/outbox immediately. Only after 2500ms without recipient
ACK request generic message wake. Collapse per recipient at most once/30s, stop
after ACK; each intent expires <=60s and retries get a fresh bounded intent ID.
Clock rollback must not strand pending text indefinitely. No content in intent.

Files/calls: try P2P immediately, then wake only if not ready after direct grace.
File content remains bounded sender memory, <=existing 5MiB/file limits, wait<=60s;
no claim of persisted resumable files. Call intent lifetime <=30s, local outgoing
state and cancellation must exist before transport connects; hangup/disconnect/
deadline prevents delayed auto-call or push. Do not open microphone before actual
call startup. No promise of native background ringing: FCM/APNs+CallKit/Android
system-call integration remain separate from typed wake control-plane support.

Server: validate unexpired input and clamp future deadline to own now+60s for
message/file, +30s call; recheck immediately before provider. Legacy no-triple
keeps generic60s behavior. PushProvider.sendWake(token,intent?:WakeIntent) retains
one-arg compatibility. Expiry-cleaned bounded dedup map<=4096 keys for sender+
recipient+intentId, no content/no persistent queue. Existing consent/hourly quotas
and concurrency apply; call cooldown separate from message/file so data alert
does not suppress call. FCM TTL remaining milliseconds, generic type-specific
body and existing data.kind='lastcall-wake' plus intentKind/intentId/expiresAt strings.
No names/phone/SDP/filenames/text. No late incoming-call claim after expiry.

Tests: immediate direct attempt before wake, ACK-within-grace suppresses all push,
pending retries bounded, call cancellation/deadline/no late start, file wait bounded,
strict metadata schema, expiry/dedup/quota/consent/type-specific generic payload,
no provider acceptance marks delivered. Old media/username tests retained.
