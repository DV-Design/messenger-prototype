# Editing and deleting messages, chats and contacts

This contract covers 1.0.11 and later. The server sees none of this: a change travels
over the same end-to-end encrypted peer channel as chat content.

## Message change

An author changes their own message with a signed `message-change` application
payload (`packages/core/src/message-change.ts`, domain `lastcall/message-change/v1`).
It names the conversation, author, record and type, an action (`edit` with new text
or `delete`), a revision and a fixed 7-day lifetime.

- Only the author's pinned key can sign. A member cannot change another author's
  record, and a relaying member cannot alter a signed change.
- The latest change per record is stored. A delete always wins. Otherwise a higher
  revision wins, and an equal or lower one is ignored.
- A change that arrives before its message is applied when the message arrives.
- Delivery has no acknowledgement. Each stored change is sent once per connected
  session until it expires, and applying it twice changes nothing. Group members relay
  signed changes the way they relay signed messages.
- The `a=x-lastcall-message-change:1` SDP marker declares support. A peer without it
  receives nothing, because older versions report an unknown payload as a false
  "contact unreachable" notice. The change stays stored until it expires.

## Original text

An edited record keeps `originalText`. Every send path and every read receipt uses it,
so signed group origins and read receipts stay valid after an edit. A read receipt
therefore proves that the message was read, not which revision was read. The text from
before the edit stays in encrypted local storage on the devices that hold the message
until that message is deleted or trimmed from history.

## Local removal

- Delete for me removes the record and its outbox entry from this device. A tombstone
  blocks replays until the record's own 7-day deadline.
- Delete for everyone also removes the local copy and stores a signed delete for all
  recipients, including when the message still looked undelivered, because the ack may
  have been lost.
- Delete chat clears history, attachments and queued content on this device, adds
  tombstones and hides the chat. It sends nothing. A new message brings the chat back.
- Delete contact removes the direct chat, its queue and the verification, and closes
  the session. The contact entry stays when the person is blocked or shares a group,
  because the block and the group need it. Only the direct chat goes in that case.
- A chat created by someone else's connection attempt stays hidden until a message
  arrives or the owner opens it, so a removed contact does not reappear as an empty
  chat. It does reappear when that person writes again; blocking stops that.

## Limits

- The other device applies a change only when both devices are online within 7 days of
  the change. There is no server mailbox, and a change is not pushed by itself.
- A deletion is a request. A modified app or an older version keeps the original, and
  the other person may already have read or copied it. A version without the marker
  never receives changes.
- Deleting a chat or a contact is local. The other person keeps their copy. Deleting a
  contact also drops changes to that direct chat that have not been sent yet.
- If a stored change was dropped at the budget limit, the author's next change to that
  record starts at revision 1 again, and a peer holding a higher revision ignores it.
- Leaving a group does not exist. Members keep sending to you, and a new message brings
  a deleted group chat back.
- Retained original texts, stored changes and tombstones share a 1 MiB budget across all
  chats, so that the encrypted state stays under its 8 MiB limit. At the limit the oldest
  changes and tombstones are dropped first, which can leave a stale copy on a peer or
  allow a replay. An edit is refused when original texts alone fill the budget.
- Text deleted from the app can remain in the current session's memory until that
  session ends. Files already saved or shared outside the app are not reachable.
