# Message reactions

This contract covers the first app version that ships reactions (after 1.0.20). The
server sees none of this: a reaction travels over the same end-to-end encrypted peer
channel as chat content, like the changes in [MESSAGE-CHANGE-CONTRACT.md](MESSAGE-CHANGE-CONTRACT.md).

## Record

A member reacts to a message or file with a signed `message-reaction` application
payload (`packages/core/src/message-reaction.ts`, domain `lastcall/message-reaction/v1`).
It names the conversation, the record's author, id and type, the reactor, an optional
emoji, a revision and a fixed 7-day delivery lifetime.

- One reaction per member per record. Choosing it again takes it back (a record
  without an emoji); choosing another replaces it. The higher revision wins.
- Emoji come from a fixed set of six (`REACTION_EMOJI`). Any other value fails
  validation, so a modified client cannot show free text under a message. Adding an
  emoji needs a new SDP marker, or older apps reject the record.
- Only the reactor's pinned key can sign. In a direct chat only the two members can
  react; in a group a member relays others' signed reactions but cannot forge them.
- A reaction whose record is unknown is dropped; the sender's next session sends it
  again. Reactions from a blocked contact are dropped on receipt and not shown.
- A reaction is shown as long as its record exists and disappears with it. A taken-back
  reaction is kept only until its delivery lifetime ends.
- Local storage keeps at most 1312 reactions per chat and 4000 in all; the oldest go
  first beyond that. The stored state version is 7.

## Delivery

- The `a=x-lastcall-reactions:1` SDP marker declares support. A peer without it
  receives nothing and the reaction waits, because older versions report an unknown
  payload as an error.
- Each stored reaction is sent once per connected session while its lifetime lasts.
  There is no acknowledgement; applying it twice changes nothing.
- A reaction does not send a push and is not part of the server's delivery requests.
  It arrives the next time the two apps connect directly, for example together with a
  message or when the other person opens the app. It does not notify the author.
