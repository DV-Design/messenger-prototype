# LastCall 0.2.1: delivery recovery, contacts and permissions

User reports missing messages; requests device contacts and permission prompts.
No bots/channels/backups. Keep user identity/history and packageId on upgrade.

## Ownership

- Core agent: packages/core delivery reproduction, minimal fixes and regressions.
- Mobile agent: apps/mobile permissions, phonebook, visible chat transport state.
- Native agent: own temporary AVD/harness under .tmp/current/native-delivery and
  diagnostic report only. Existing unrelated AVDs are not used or changed.
- Main: dependency install/lock, independent checks, integration, docs, release,
  infrastructure if evidence requires it. No blind TURN/public network mutations.

## Delivery

Reproduce first. User's exact networks/foreground state requested asynchronously.
Confirmed code regressions: pending text queued during an active flush may never
retry without a future stats event; signaling joined/no answer has no deadline.
Fix with explicit bounded retry independent of statistics and stage deadline.
Do not change receipt ACK into optimistic delivered. Keep content off directory
and signaling server. No server mailbox/relay silently introduced under a strict
P2P requirement. Show direct connection failure in chat, distinguish directory
presence from actual peer connectivity. Collect native runtime evidence against
old and corrected APK; do not label a browser result a phone result.

## Contacts and permissions

Use SDK58 expo-contacts current Contact.getAllDetails API, not removed legacy calls.
Request app-relevant contacts/camera/microphone/photo access through an explicit
setup center, first-run/update offer, sequential OS prompts, denial/settings and
limited permission handling. No unused location/SMS/call-log/all-files access.
Keep camera/microphone config usage strings; false blocks them globally.
Read-only phonebook sync must not write OS contacts or upload raw address book.

Current directory has usernames/public keys, no verified phone numbers. User was
asked whether automatic number matching is required. Until that is resolved,
local phonebook sync + explicit contact/profile link is valid functionality but
must not be presented as automatic WhatsApp-style number discovery. No guessed
name/number ownership. Invite action opens OS share sheet only on user's action.
Mappings store only selected public ID against a hashed local contact key; no
plaintext names/phones persisted outside OS phonebook. Background push remains
separate; OS permissions alone cannot wake a suspended app.

## Verification and release

Focused failing→passing delivery tests, existing core/server/browser gates,
minimal actual native send/receive scenario. No screenshot matrix. Expo lint,
typecheck and Android/iOS JS export. Clean native prebuild only after manifests
freeze, release v0.2.1/code3, same signature and package; inspect final permissions
and embedded bundle, download and compare exact bytes, retain old APK rollback.
Update Beads/tasks/docs honestly, commit and push mandatory.
