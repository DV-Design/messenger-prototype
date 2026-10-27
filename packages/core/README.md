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
