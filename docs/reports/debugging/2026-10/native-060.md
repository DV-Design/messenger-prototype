# LastCall 0.6.0 native acceptance

Date: 2026-10-30. Own preserved LastCall_Delivery Android API36 emulator, Owner0,
ARM64 and synthetic Chrome peer, actual public signaling/directory, Firebase and
TURN configuration. No human messages. Identity/history survived same-signature
upgrades. Diagnostic builds are not public artifacts.

## Proven before final publication

- Android secure PIN lock: internal call candidate presented managed Telecom
  incoming UI; explicit headset answer worked without PIN/unlocking the app.
  Bidirectional audio RTP continued >16seconds (inbound720/outbound726 packets
  at the measured16s point, later growing beyond2500 in both directions).
  Remote hangup removed active microphone FGS. This is packet evidence, not
  audible intelligibility: emulator audio output was disabled.
- Cold encrypted preview with sender then disconnected: native device decrypted
  and posted readable Russian message+emoji on secure lockscreen. Sender's full
  message remained pending, correctly distinguishing preview from durable ACK.
- Root cause of hanging cold-wake cleanup reproduced: Expo NOP headless task
  had already completed while LastCall's JS timer needed an active RN task.
  After app-owned pending-task fix, native TaskService start13:58:43.848 and
  finish13:58:57.747 were observed; subsequent windows finished11.7s after Expo
  start, including native setup and the9s application budget. Directory presence
  returned offline after cleanup. No temporary trace instrumentation retained.
- Actual text notification tap after cold wake/cleanup opened the exact saved
  synthetic DM. Verified app package, chat-back control and unique foreground/
  cold-timer fixture messages; both then obtained durable delivery ACK.
- Actual file notification showed `Файл: lastcall-background-qa.txt`. Tapping
  opened the same sender's DM and the received35-byte saved file. Sender saw
  complete/delivered. No external URL was used as a destination.
- Public deployment smokes passed normal DNS/TLS/WSS, authenticated encrypted
  exchange, directory search/presence and independent pair connections.
  Host and running container main.js SHA256 match.
- Removed only the retired stopped lastcall-coturn container after confirming
  native LaunchAgent PID33461 owns3478UDP/TCP and5349TCP. External config and
  certificates retained; native relay stays running.

- Fullscreen/adaptive-video candidate locked-call regression passed: secure=true,
  showing=true, InCallActivity, explicit headset answer, active audioFGS132; RTP
  grew to937 inbound/940outbound packets >18s. Remote hangup cleaned audioFGS.
  A subsequent cold call rang again and hardware decline returned both peers idle.

- Final permission-fix APK recorded a30s voice note (262003bytes), showed native
  preview duration30s and play/pause progress, then sent over P2P; browser receiver
  reports complete/received with retainedbytes. No native capture after Home is enabled.

## Final release verification and handoff

Final root check passed:54mobile+59server+151core=264tests, lint/typecheck/build,
Android+iOS JavaScript exports. Chrome9PASS/1explicit TURNskip. Native release/R8
build passed. After the final workspace-core change, the bundle task was explicitly
rerun before assembling, avoiding a Gradle input-cache omission for external
workspace sources. APK metadata/signature/hash and public downloads are checked
at publication and recorded in artifacts/README.md. Both public HTTPS hostnames
serve exact54887217bytes/SHA256
`43f0f5f50bc1f09f785c10e795724e1ed45608a1cf9ada67ed9afd3aa1ed1a0f`;
landing/tasks/research also match repository bytes.

User explicitly takes UI acceptance on2026-10-30. Further UI testing stopped at
that request. Circle capture source/native modules are installed and unit gates
pass, but actual circle finalize/playback and final fullscreen video/camera remain
for phones. The emulator initially had no front camera; with emulated front it
reported synthetic audio I/O errors and a delayed recorder finalization. This is
not claimed as a successful native circle test. msg-46e/msg-si6 retain acceptance
work; physical Android/iOS and carriers remainmsg-3z9/msg-9rr.

Temporary ownQA PIN was cleared, Wi-Fi/data restored, only the LastCall_Delivery
emulator and own synthetic browser were stopped. No personal devices/users or
unrelated services were modified. No native trace or Firebase Admin key is shipped.

## Limits

Physical Android/Russian operators, OEM battery restrictions, audible quality and
adaptation under real changing carrier bandwidth remain unverified. Video UI
requires foreground/unlock; PIN is not bypassed. Camera access on a locked video
answer depends on Android's eligibility rules and is tested separately. iOS has
JS export only, with no signedIPA/APNs/CallKit. Force-stop suppresses Android push
until manual launch. No network or reachable holder means no full immediate P2P
delivery. Large transfers can outlast the bounded wake and remain in sender queue.
