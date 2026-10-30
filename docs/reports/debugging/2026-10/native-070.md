# LastCall0.7.0/code10 — focused native call evidence

Date:2026-10-30. Device: own AndroidAPI36 ARM64 AVD `LastCall_Delivery`, owner0 only. The existing QA installation was upgraded in place; username/identity/history were retained. No human contacts were messaged. Other device users were not altered. Emulator audio output was disabled: RTP counts establish transport, not heard intelligibility.

## Build and package

- Expo SDK58 Android prebuild with the external Firebase Android client configuration; Firebase Admin key remained server-only.
- Explicit `:app:createBundleReleaseJsAndAssets --rerun-tasks` generated the current core JS, avoiding the tracked external-core Gradle input issue(msg-vi6).
- First native compile exposed missing app-classpath LocalBroadcastManager and an android.app.Person/AndroidX CallStyle mismatch. Fixed through the development worker using the existing AndroidX Person and a same-process weak native-module action dispatcher; no new dependency or installed-library edit.
- Final `:app:assembleRelease -PreactNativeArchitectures=arm64-v8a --no-daemon` passed in2m27s. Native template/prebuild sources are tracked; generated Android remains ignored.
- APK bytes54909341; SHA256 `ad39f92a0542ea5b90e05a3678a5475c1a8cddab2342f961a0f280da5757582f`.
- Package `dev.messenger.prototype`, code10, version0.7.0, minAPI24/target36, ARM64. Same certificate SHA256 `fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c`.
- APK contains current read-receipt/video-stat/self-managed JS markers and no PEM private-key marker. Signature verification passed. No phone-number/call-log/CALL_PHONE/READ_PHONE_STATE permission is requested in the merged package.

## PIN-locked incoming and answer

1. Existing QA receiver opened once, then Home and PIN lock. Sender was a separate Chrome fake-media QA client using production signaling/FCM and the unchanged native TURN deployment.
2. `LastCallCallActivity` became top resumed activity while `mKeyguardShowing=true`; native incoming service was present and active-audio service absent. It was LastCall's call-only surface, not the Phone app. Its accessibility tree showed caller and answer/decline controls, no chats.
3. An explicit tap on the own “ПРИНЯТЬ” button established `callState=active`, direct route and LastCallAudioService. Initial sender stats:22 inbound audio packets and22 outbound. A later sample reached2629 inbound/2626 outbound with audio service still active after the short wake window; incoming and setup services were absent. This is bidirectional RTP, not a recording or audible-quality assertion.
4. Unanswered calls exercised native expiry and UUID-scoped onReject; caller returned idle and the incoming UI/service disappeared. No microphone service ran merely from ringing.

A first selector missed Android's uppercase button text; one subsequent sampling attempt did not capture an incoming surface. Neither is counted as successful answer evidence. The final clean attempt explicitly ended any prior caller operation, observed the own UI, tapped the actual visible control and measured the active stream. No product-code change or additional independent QA allocation was made during these acceptance checks.

## Ordinary process death

After ending the conversation, `am kill --user 0` terminated the background receiver. Its old PID3514 was confirmed absent before calling. A real wake started new PID4717; LastCall's own incoming activity appeared above the still-PIN-locked screen at12.95s in the bounded sample. This was ordinary process death, **not force-stop**. Background samples in this environment showed roughly10.75–12.95s to the incoming UI, not universal instant ringing.

Ignored diagnostic artifacts: `.tmp/current/native-delivery/native-070-ring.json`, `native-070-answer-clean.json`, `native-070-process-death.json`; raw keys/tokens/SDP were neither printed nor published. The synthetic PIN was cleared, the test browser closed and the own emulator stopped after the check. Installation data was preserved.

## Automated and public verification

Claude tester cycle3/6:292 unit tests,10 browser passes/1 authenticated-TURNskip, lint/typechecks/all JS builds passed. See the separate [QA report](../../testing/2026-10/claude-qa-cycle-3.md). Local monitor regression suite10/10 passed.

Primary, alternate and preview-alias HTTPS APK downloads independently returned exactly54909341 bytes and the same SHA256 above. The server did not require a product deployment for these mobile/core changes.

## Not established

Physical Android/OEM battery policy/Russian carriers, Android7 fallback, denied-FSI behavior, actual native video rendering/quality under constrained links, heard voice quality, iOS/APNs/CallKit and DPI claims remain separate acceptance work. Existing tracked issues msg-3z9/msg-9rr/msg-si6 retain this scope. Both endpoints should update in place; old strict encrypted-state schemas are not a downgrade guarantee.
