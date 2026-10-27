# Shared foreground prototype core

`PeerSession` runs on browser WebRTC or injected React Native WebRTC bindings. Inject
`rtcFactory`, `getUserMedia` and a cryptographically secure `randomBytes` on mobile.
WebSocket, fetch, URL, TextEncoder and TextDecoder globals must exist in the runtime.
The public API is exported from `src/index.ts` and follows the repository contract.

The 32-byte invitation is a shared secret exchanged through another trusted channel.
Never use a password, put it in the signaling URL or log it. Signaling uses
XChaCha20-Poly1305, per-sender domain-separated HKDF-SHA256 keys, authenticated room
and sender context, encrypted recipient binding and monotonic message sequences.
Recipient binding rejects messages captured for a prior PeerSession identity.
Replay state retains at most 16 sender identities without eviction; use a new
PeerSession after this capacity is reached. This is PSK prototype authentication,
not a Signal ratchet, forward secrecy, independently verified identity or a security
audit. A holder of the invitation can impersonate either participant. WebRTC binds
DTLS fingerprints through that authenticated signaling; payload goes over DTLS/SRTP.

All WebRTC negotiation operations use one serialized queue. Only the initial room
initiator generates offers; its role remains stable while another occupant rejoins.
Only foreground live peers can communicate. There is no durable history/outbox,
background wake guarantee, offline delivery or DPI disguise. A connected data channel
is required before sending chat or starting calls. A file is marked complete for the
sender only after a receiver acknowledgement. Chat entries mean accepted by the local
RTC channel; they are not delivery receipts.

Resource limits: 100 chat entries, four retained file records, each at most 5 MiB;
one incoming and one outgoing transfer; 12 KiB binary content per encoded chunk;
256 KiB data-channel producer backpressure threshold and 120-second transfer deadline.
Completed file bytes returned by snapshots are shared immutable-by-contract buffers:
consumers must not mutate them. Snapshot metadata is copied, but large byte arrays
are intentionally reused to avoid copying a completed file on every stats/chunk event.
File names and MIME types are untrusted: applications must render names as plain text
and never execute files or interpret HTML from peers. Server URLs permit http(s);
use HTTPS/WSS outside local testing.

Media is acquired only on starting/accepting a call. Reject, timeout, hangup and
session close stop local microphone/camera tracks. Receiver tracks are owned by the
reusable peer connection and released on connection close, rather than stopped at
hangup (which breaks repeated calls on a reused transceiver). Hangup removes sender
tracks and hides the remote stream. Incoming or outgoing invitations time out after
45 seconds. Simultaneous invitations may reject each other; retry after both return idle.

Audio encoder targets are 12–32 kbit/s, selected from measured selected-path RTT and
remote-inbound reports of the outbound stream. Inbound packet loss is a diagnostic,
not feedback for the local encoder. `RTCRtpSender.setParameters`, writable encodings,
remote-inbound feedback and detailed candidate stats differ by browser/OS/RN version.
When absent/rejected, the native WebRTC controller continues; the prototype cannot
promise that a requested bitrate was applied. No SDP munging or intelligibility promise.
Candidate route is `unknown` until an active pair is reported; `relay` means at least
one selected candidate is TURN. `relayOnly` rejects an empty TURN configuration and
never silently switches policy to direct.

## Version 0.2 manager

`MessengerClient` adds a persistent coordination directory and independent
`PeerSession` instances per contact. `endpointUrl()` preserves a gateway prefix,
e.g. `https://lienad.ru/messenger` becomes `/messenger/directory`, `/messenger/signal`
and `/messenger/ice`. Navigating away from a chat has no networking side effect.
The caller explicitly disconnects only when signing out or shutting the client down.

A device has an Ed25519 seed in platform secure storage. Directory login signs the
exact one-time server challenge together with public key, username and display name.
Public keys are checked for small-order/torsion points; user IDs hash their public
key. Peers derive deterministic pair invitations via noble Ed25519-to-X25519 key
conversion, X25519 ECDH and domain-separated HKDF. A username is a directory label;
there is no audited key transparency service. These static device keys do not give
forward secrecy or a ratchet. Device-key loss loses access to encrypted local state;
compromise can expose state and deterministic pair secrets.

Directory presence reconnects with 1–30-second backoff. A `session-replaced` response
stops automatic reconnect to avoid two devices displacing each other indefinitely;
the user must reconnect explicitly. Directory network loss leaves existing direct
sessions running. At most 16 pair sessions exist; old idle sessions with no pending
text, active file transfer or call can be evicted. This never evicts a current call.
A new call waits at most 15 seconds for a direct session to become ready. Incoming
calls appear at manager scope, independent of the selected chat. One call at a time
is supported; group calls are explicitly unsupported.

The directory receives profile, search, presence and connection metadata; text,
group definitions, files and media use authenticated peer connections. Groups have
2–8 members and immutable creator-issued definitions sent through ordered P2P
application frames. Every member directly sends to other members. Definitions are
accepted only from their authenticated creator; texts/files require known membership.
If a recipient has not received a definition yet, pending texts retry after it does.
There is no server-side group history, group membership change or group call protocol.

The manager retains at most 100 contacts, 32 groups, 500 text records total (100 per
conversation), and 100 pending outgoing texts. Pending texts are not evicted to make
room for received history. `sendText` serializes an encrypted local-state write before
starting online fanout. Status `delivered` requires a real data-channel text ACK;
for a group it requires every recipient. The ACK confirms receipt by the foreground
client, not a synchronous disk fsync or a push notification. Pending messages retry
on peer availability and at bounded intervals; repeated IDs are deduplicated within
retained history. The server never holds this outbox.

`loadState`/`saveState` exchange sealed strings encrypted with XChaCha20-Poly1305 and
a domain-separated device-seed key. Writes are serialized and ordinary state changes
are throttled. Stored records include bounded profiles, groups, texts and pending
recipient IDs, never a plaintext seed, WebRTC streams or file bytes. Authentication
failure on loading state fails closed and does not overwrite it. Files require all
recipients connected and are not queued. Only the recent eight completed file byte
buffers remain available in manager memory; file metadata is bounded separately and
files are not restored across restarts. Snapshot file buffers remain immutable by
contract and must not be modified by application code.
