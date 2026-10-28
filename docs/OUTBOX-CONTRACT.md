# Sender-held delivery and peer group sync (0.5)

User direction: persist text and files on sender devices until recipient acknowledgement,
with a seven-day deadline. Coordination server and FCM never receive chat content.
Phone uninstall, OS suspension, or an unavailable network do not imply guaranteed delivery.

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
transfer/retry, bounded capacity, no content in server/push. Run check/e2e/native build.
