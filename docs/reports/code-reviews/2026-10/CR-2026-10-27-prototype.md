# Code review: initial messenger prototype

Date: 2026-10-27. Scope: new repository, shared core, signaling, mobile adapters,
browser interoperability and local infrastructure. No pre-existing messenger history.

## Result

Accepted as a foreground laboratory prototype. Not accepted as production secure
messaging or a tested censorship-resistant transport. Native Android build is being
verified in CI because local Gradle exhausted disk space. iOS native build requires
full Xcode/signing; JS exports and native prebuild are separate successful checks.

## Verified corrections

- Preserve responder/initiator role and introduce a surviving responder through
  authenticated renegotiate after the original initiator leaves.
- Protect signaling from sender/recipient/room substitution and bound replay state.
- Stop late microphone/camera streams on cancelled permission operations.
- End local capture on hangup while allowing receiver transceivers to be reused.
- Adjust outbound audio using remote receiver loss rather than local incoming loss.
- Avoid copying completed multi-megabyte buffers on every stats/chunk update.
- Bound WebSocket frames, rooms, rates, pending ICE, file sizes and memory retention.
- Retain only required coturn NET_BIND_SERVICE image capability after discovering
  its file-capability executable could not run with an empty bounding set.

## Checks

- Root lint/typecheck/tests/build passed after storage pressure subsided.
- Core: 15 meaningful crypto, limits, feedback and lifecycle tests.
- Server: 12 real WebSocket/HTTP tests, compiled process startup, Docker build.
- Default browser integration: 5 passed, optional TURN skipped. Real chat, exact
  file bytes, audio/video, repeat calls and both leave/rejoin orders.
- Forced local TURN remains unresolved on this Docker Desktop setup; a separately
  recorded task is required. Do not claim the relay route is verified.

## Follow-up risks

`msg-bkt`: Expo CLI depends on Zod 3 with a known resource-exhaustion advisory;
runtime core/server schema validation uses fixed Zod 4.6.7. Development tools
remain local; do not expose Metro/Vite or unauthenticated TURN provisioning publicly.

Production identity/ratchet, encrypted mailbox, push wake, persistence, resumable
files, operator-network testing and abuse protection are separate tracked work.
