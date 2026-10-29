# Background P2P push review

Date:2026-10-29. Reviewer: main agent. Scope: final0.5.1 diff against f588992.
Prior related history, wake/outbox/handover contracts and mobile entry/storage
were inspected before implementation. Main independently read delegated changes
and ran final root/native/integration checks.

## Result

No remaining release-blocking issue found in the reviewed scope. The main
discovered native data-loss bug was reproduced and corrected before acceptance.
Platform delivery guarantees remain explicitly limited.

## Risk-focused review

- Optional strict backgroundSync capability defaults to legacy behavior.
  SQLite additive migration preserves old tokens and resets capability on
  legacy registration/token replacement. Tests cover existing databases and
  opted-in/legacy real HTTP service paths. Auth, consent, TTL/quota/dedup and
  invalid-token removal remain enforced.
- FCM high-priority data payload carries only generic notification text and
  bounded intent metadata; no chat/file body, sender name, SDP or device seed.
  Dedicated least-privilege server credential is outside all shipped artifacts.
- SDK58 task-manager is installed through Expo's versioned dependency resolver;
  global task definition precedes Router. Task capability is advertised only
  after registration succeeds. Unconfigured iOS remains disabled.
- Cold task reads an existing bound identity only. Bounded parsing rejects
  malformed, excessive, duplicate and expired wake data, including expired
  calls. No task starts microphone/media or creates a new registration.
- Shared foreground/headless owner serializes adapter initialization/disposal.
  Terminal shutdown stops transport input, drains in-flight receives, blob,
  enqueue/history/expiry work and final persistence before replacement. Final
  storage failure rejects. Delayed-storage/reentrant-shutdown tests cover this
  boundary; native takeover completed with the existing identity.
- Authenticated signaling is bound to the captured PC and peer before queued
  dispatch. Channel readiness is bilateral and bounded: nonce32hex,
  retry250ms/deadline5s,64control frames/5s. Native SDP is stripped of the
  experimental attribute; unsupported peers receive no new control frames.
  Cleanup clears timers; same-channel handover remains gated by real ICE state.
  Ready ACK never substitutes for persisted-content ACK.

## Validation

`npm run check`:195tests pass (20mobile,50server,125core), lint/typecheck,
native JS exports/server build. `npm run test:e2e`:9pass,1explicit TURN skip.
Final release build, same signing certificate and real FCM cold text/file
no-tap ACK plus offline persistence verified; see
[native evidence](../../debugging/2026-10/native-051-push.md).

Open issues: physical Android/Russian-carrier and battery-policy acceptance,
iOS/APNs/system calls, long transfer continuation/chunk resume, TURN maintenance
and mesh capacity. Server profile/public-key storage is documented; no server
message/file mailbox was added.
