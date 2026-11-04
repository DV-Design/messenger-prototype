# Native check of store build 1.0.12 / code26 (2026-11-04)

Two Android 16 (API 36) Google APIs emulators with existing accounts on the production server
`p2p.lienad.ru`. Builds were universal APKs made from the store AABs and signed with the upload
key, so this is not the Play-signed delivery path. Audio was disabled on the emulators.

| Check | Result |
| --- | --- |
| Upgrade 1.0.8 to 1.0.9 to 1.0.12 with an account, chats and a group | History and account kept; email reminder shown |
| 1.0.9 and 1.0.12 connect (new SDP marker on native WebRTC) | Connected, no false "unreachable" notice |
| Text 1.0.9 to 1.0.12 and back, both online | Arrived in about 2.5 s each way |
| Text from 1.0.9 to a stopped 1.0.12 | FCM started the process; notification with decrypted text in 6 s |
| Text from 1.0.12 to a stopped 1.0.9 | Same, 6 s; one tick on the sender while the receiver stayed in the background |
| Text between two 1.0.12, receiver stopped | Notification in 6 s |
| Call from 1.0.12 to a stopped 1.0.9 | Incoming call notification in about 4 s |
| Call from 1.0.9 to a stopped 1.0.12, answered from the notification | Caller shows "In call", remote tracks on both sides |
| Call between two 1.0.12, receiver stopped, answered | Caller shows "In call", remote tracks |
| Edit (1.0.12 to 1.0.12) | Peer shows new text and "edited" in 2.2 s |
| Delete for everyone | Removed on the peer in 2 s |
| Delete for me, then restart the app | Stays deleted; the author keeps the message |
| Delete chat and delete contact dialogs | Open with the expected text; cancelled, so the action itself is covered only by automated tests |
| App crashes in logcat | None |

"Stopped" means Home, then `am kill` with no process left. It is not Android force-stop.

## Not covered

- Heard call audio and video.
- The Play-signed build, real phones and carrier networks.
- New registration with email in the native app, including letters to Gmail.
- A 1.0.8 peer: the old client in this check was 1.0.9, and 1.0.8 has the same connection code.

## Notes

After a receiver leaves, the sender can see "The server is connected, but the contact is
unreachable" for an offline contact when the transport deadline passes. This wording is older
than this release and delivery is not affected.
