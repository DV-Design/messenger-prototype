# Large files (over 5 MiB, up to 1 GiB), phone to phone

Since 1.0.30. Files up to 5 MiB keep the old path (sealed blob in app storage, re-sent by group
members). Anything larger takes this path; voice notes and video circles stay under 5 MiB.

## Where the bytes live

- **Sender:** the picked file is moved (or copied) into the app's private documents,
  `lastcall-bulk/<attachment key>/<name>`, before the outbox records it. It is read back in
  64 KiB chunks and never loaded whole. Unlike small files it is not re-encrypted at rest: it sits
  in the app sandbox like any downloaded file.
- **Recipient:** chunks are written to `<name>.part` and renamed when complete. A cut transfer
  resumes from the `.part` size. A free-space check runs before accepting.
- Deleting the message, the chat or the account deletes the folder. An undelivered file expires
  after 7 days like text, and its copy is deleted too.

## Transfer

- Only between two clients that advertise `a=x-lastcall-bulk:1` in the authenticated SDP. Older
  clients tear the session down on unknown sealed frames, so nothing large is ever sent to them;
  the file waits until the recipient updates or 7 days pass.
- **Direct path only.** Before each attempt the sender reads the selected ICE pair; if it goes
  through TURN, nothing is sent and the file waits for a later attempt (every 30 s while the
  peer is connected, and on every reconnect). The server never stores or relays the file.
- `bulk-offer` (sealed, end-to-end) carries name, type, size, signed metadata and a fresh random
  32-byte key. The recipient answers `bulk-want` with the offset it already has. Data goes as
  binary messages `[0xB1][id 16][offset 8][XChaCha20-Poly1305 ciphertext]`, with the nonce from
  the offset and the id and offset as associated data. The recipient confirms every 1 MiB
  (`bulk-progress`); the sender keeps at most 6 MiB unconfirmed, so a slow disk never fills
  memory. `bulk-end` / `bulk-ack` close it; the file counts as delivered only on `bulk-ack`.
- One large file at a time per recipient; texts keep flowing between chunks on the same channel.
- Groups: the author sends to each member directly (no relaying by other members). The signed
  group origin pins name, type and size (`lastcall/bulk/v1`), since hashing a gigabyte in JS is
  not practical; the bytes are authenticated per transfer by the chunk cipher.

## Verified

- Unit: chunk cipher (tamper, wrong key, moved offset), session streaming with resume and refusal,
  messenger queueing, direct-only routing and acknowledgement.
- `tests/e2e/large-file.spec.ts`: two Chrome instances over real WebRTC, 12 MiB byte for byte,
  ~11.7 MiB/s on a Mac.
- Emulator: picking a 9 MB file queues it with one tick and opens it from the sender's chat.

Not verified: a real phone-to-phone transfer (Hermes speed of the JS cipher and of binary
data-channel messages is unknown), carrier CGNAT where no direct path exists, Android killing
the app during a long transfer (it resumes on the next connection).
