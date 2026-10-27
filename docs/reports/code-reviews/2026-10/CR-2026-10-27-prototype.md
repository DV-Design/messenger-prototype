# Code review: initial messenger prototype

Date: 2026-10-27. Scope: new repository, shared core, signaling, mobile adapters,
browser interoperability and local infrastructure. No pre-existing messenger history.

## Result

Accepted as a foreground laboratory prototype. Not accepted as production secure
messaging or a tested censorship-resistant transport. Native Android build is being
verified in CI; a local standalone release subsequently passed after disk pressure
was resolved and the narrow dependency fix below was applied. iOS native build requires
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

## Public preview addition

The user explicitly authorized Internet publication. Independent verification of
the isolated HTTPS deployment passed: valid TLS, health/ICE response and a real
two-peer authenticated encrypted WSS exchange. Public discovery uses explicitly
selected STUN endpoints; no unauthenticated TURN credentials are issued. The
existing proxy is shared, so current limits intentionally support a small preview.

Native release inspection found an orphan Dav1d JNI bridge in the pinned Jitsi
155.0.1 AAR. A narrow generated ProGuard rule suppresses exactly the absent nested
interface; the working native decoder factory is retained and R8 stays enabled.
See mobile README for bytecode evidence and upstream references. This does not
claim an AV1 device-runtime test. Android system backup is explicitly disabled.
Final APK signature, package, minimum SDK, ARM64 ABI and embedded JS were inspected;
public HTTPS APK download matched the local binary byte for byte. The artifact
record includes its digest. Physical-device testing is still outstanding.
