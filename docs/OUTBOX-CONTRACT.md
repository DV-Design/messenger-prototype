# Sender-held delivery and peer group sync (0.6.0)

User direction: persist text and files on sender devices until recipient acknowledgement,
with a seven-day deadline. The coordination server has no chat-content mailbox.

0.6.0 changes the earlier content-free-push requirement by explicit user direction:
a short message or file-name preview may transit the server/FCM as an authenticated encrypted
opaque envelope, with provider TTL<=60s. Plaintext is never exposed to them; this
is transient encrypted-content handling, not “no content ever reaches FCM”.
The encrypted text is capped at 800 UTF-8 bytes (possibly earlier JSON-escape
truncation), envelope 3000 bytes and total FCM data 4096 bytes. Sender/recipient IDs,
intent/type/expiry headers remain visible. No file/media bytes or full-history
mailbox are introduced. Existing contact pins and conversation membership must
validate before displaying the decrypted preview. Preview receipt/display never
creates a durable chat record or sends content ACK; full P2P persistence and
seven-day/per-recipient queue semantics below remain authoritative. See the
[0.6.0 wake contract](WAKE-CONTRACT.md). See the native acceptance report for exact verified scope.
Phone uninstall, OS suspension, or an unavailable network do not imply guaranteed delivery.

## Voice notes and video circles (0.6.0)

Voice notes and circles use the same encrypted `sendFile` path and durable ACK;
there is no server media storage or separate queue. Voice is AAC/M4A, maximum
120 seconds. Circles are maximum 30 seconds, targeting 480p/600 kbit/s. Both must
pass the actual 5 MiB byte check before enqueue. Encoder targets do not guarantee
file size on every phone. Capture starts explicitly in a foreground chat, then
stop/preview/send/cancel; no push-triggered or background recording.

After send, sender-local encrypted bytes persist for up to seven days from the
original enqueue, with retry under the same ID and full-file retransmission.
Group peers may supply verified retained media like other files. All records,
including delivered media, count against 16 stored blobs / 40 MiB total. Quota
failure preserves prior waiting content. Before send, a local draft must be
discardable; cancel, capture failure and leaving the recorder must release
camera/microphone/player resources and remove temporary capture/preview copies.
Inline voice playback and circular video presentation are client UI; no read or
playback event substitutes for a delivery ACK. Legacy clients may display the
media as ordinary files. Native codec/playback/cancel/permission-denial and
offline enqueue/restart/retry acceptance remains pending on the final 0.6.0 APK.

Implementation ownership: session/protocol durable-receipt boundary; manager outbox and
authenticated group synchronization; mobile encrypted attachment adapter and queue UI.
All changes preserve installation identity, 0.4 encrypted state, and existing calls.

Receipt means the receiving manager successfully saved encrypted history and attachment
bytes. Promise-capable `onMessage`, `onApplication`, and new `onFile` are awaited on a
bounded ordered data receive queue before text/file ACK. Failures send no ACK. Replays
retry persistence rather than acknowledging an unsaved in-memory item. Generation guards
prevent stale ACK after disconnect. Session callbacks remain optional for probe usage.

Session optional text/file `metadata?: string` (bounded 12,000 characters) carries a
manager-validated signed group origin envelope. `ChatMessage`/`SharedFile` expose it;
`sendText` accepts metadata and original timestamp, `sendFile` metadata. Existing frames
without metadata remain valid. Completed/retried file IDs must not permanently exhaust
session capacity. File byte integrity is checked by manager before durable receipt.

Manager options add `saveAttachment(key,sealed):Promise<void>`,
`loadAttachment(key):Promise<string|null>`, `deleteAttachment(key):Promise<void>`.
Keys are 64 lowercase hex, ciphertext only. Core exports `sealAttachment(identity,key,data)`
and `openAttachment(identity,key,sealed)` with authenticated identity/key binding and
5 MiB plaintext maximum. Mobile owns these helpers in persistence.ts and index export.
Encrypted metadata state remains separate from blobs. Fail closed when configured durable
storage fails; optional in-memory mode remains for browser interoperability tests.

Outbox entries retain original createdAt/expiresAt, type, recipient set and real per-member
ACK progress across restart. No 60-second file eviction; sendFile resolves after durable
enqueue, transmission runs independently and retries with the same ID. Deadline is seven
days from original creation, never extended by retry/restart/relay. Expiration produces a
visible failed/expired item, stops retry/push and frees pending content; never says delivered.
Bound file count/total byte usage and reject new items explicitly without dropping waiting
content. Preserve current 5 MiB per-file preview limit. Blob cleanup only after metadata
durably no longer references it; do not delete history files on successful delivery.

Immutable groups remain max eight members. Peers synchronize retained, signed author
records and verified file blobs directly; a member can supply a missing item while original
sender is offline. Bind original author, group, ID, timestamp/deadline and payload/hash in
Ed25519 signatures using existing maintained noble dependencies. Forwarded roster requires
creator signature; arbitrary peers cannot forge origin, change roster, or extend retention.
Deduplicate author+ID, check current immutable membership, bound relay queues, avoid loops,
and never allow a relay receipt to impersonate the final recipient ACK. New members/key
rotation are outside this immutable-group version. Retained history limits remain explicit.

Tests: restart sender/receiver, durable write failure blocks ACK even on replay, offline
recipient returns before seven days, exact TTL boundary, partial group ACK, original sender
offline peer sync, tampered signatures/hash rejection, file bytes across restart, duplicate
transfer/retry, bounded capacity, no plaintext or persistent chat mailbox on server/push,
strict preview opt-in/bounds/AEAD binding/expiry and no preview-generated ACK. Run check/e2e/native build.
