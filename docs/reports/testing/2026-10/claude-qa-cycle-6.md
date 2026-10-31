# Claude QA cycle6/6 — build/config verification PASS

2026-10-31. Final0.7.1/code11 APK54949881bytes, SHA256
`3d36731251871053711e48e0a9464a9259ffdd0024397d041cc412a253dd2122`.
Agent lastcall-release-tester, session70b3ed0a-28a0-4708-83d4-961836d732fa,
cost$0.270021. All three required skill bodies explicitly read:READ_FALLBACK.

## Allocated checks, once each

- Helper syntax: `bash -n infra/build-android-release.sh`, exit0.
- Missing client config: `env -u MESSENGER_GOOGLE_SERVICES_FILE bash infra/build-android-release.sh`, expected exit1 before prebuild/Gradle.
- Mobile tsc and test-project types on Node24: exit0.
- APK hash/size and allowlisted packaged constants: match. FCM=true, version0.7.1, Android code11, iOS buildNumber11. No external credential file or full config was read/output.

CODE_TRACE review: helper exports the client-config path before all Expo/Gradle
children, explicitly regenerates the JS bundle, and fails its packaged gate if
FCM is false or version/code mismatch. Root build:apk points to this helper;
app.config.ts versions align. No blocking finding. The packaged release gate
intentionally checks Android constants; iOS build alignment was inspected separately.

## Attribution and limits

The full340unit/11browserPASS/1TURNskip results belong to cycle4 and were not
repeated. Cycle5 reviewed unchanged call/security/lifecycle source. Cycle6 covers
only the changed build helper/config/types and final artifact identity. No
positive build, nativeUI, FCM, Android17, Pixel/Vivo, carrier, iOS/APNs or heard
media claim is made by the tester. Main separately built the final artifact and
performs scoped native checks.

PASS for this allocated scope. STOP at6/6; no automatic future tester allocation
and no cycle7. No test weakening, product fixes or recursive agents in review.

## Subsequent main native acceptance

The narrow independent review above passed, but the later main Android17 cold-call
check FAILED. The actual Expo SDK adds dataString:null and the strict call parser
rejects that wrapper. Overall run is paused_limit at6/6, requires_user_resume=true;
no0.7.1 publication. See [native failure](../../debugging/2026-10/native-071.md),
issue msg-el9. This does not relabel the limited build/config checks as native PASS.
