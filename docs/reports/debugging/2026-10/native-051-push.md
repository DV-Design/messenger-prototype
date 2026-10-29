# Android 0.5.1: background push acceptance

Date: 2026-10-29. Package `dev.messenger.prototype`, versionCode7, ARM64.
Scope: our preserved LastCall_Delivery Android emulator Owner0 and our synthetic
Chrome peer, real public directory/signaling and Firebase. No human test messages.
This evidence does not certify physical phones, Russian operators or iOS.

## Configuration

Firebase project `lastcall-f8b4c` is active. Dedicated `lastcall-push` service
account has only `roles/firebasecloudmessaging.admin`. Its JSON credential is
external to Git/APK/static hosting, mode0600 in a mode0700 directory and mounted
read-only into signaling. Android client configuration is separate. Actual FCM
registration, provider delivery and tray/tap behavior were verified before the
new headless path. No phone/SMS service was enabled.

## Reproduced cause and fix

Before the readiness fix, real native cold text/file batches failed: channel
open was observed, but receiver JS saw only file-end; initial text, file-start
and chunk events preceded listener installation. Text retry could rescue a
single message, whereas the 120-second file ACK wait stalled the peer flush.
Temporary content-free diagnostic instrumentation was removed before release.

Updated peers negotiate an authenticated experimental session SDP capability
and exchange bounded channel readiness challenges before sending payload.
Native already-open channels are handled explicitly. Readiness is independent
of the durable message/file delivery ACK. Both endpoints must update for this
protection; legacy peers keep the old wire behavior.

## Final native acceptance

- Upgrade with the existing certificate preserved the identity and history.
- Foreground text received a durable delivery ACK through the public service.
- Home, then ordinary `am kill` (not force-stop): process absence confirmed.
  Sending text plus a35-byte file caused real FCM to start the native task.
  Recipient online at4921ms, connected at5323ms, both durable ACKs at5728ms.
  Launcher remained foreground throughout; no notification tap or manual open.
- After task cleanup, disable both networks; force-stop only for this separate
  persistence check, then manually open. The cold-batch text and
  `lastcall-background-qa.txt`,35B/received were present offline in the saved chat.
  Both network services were restored.
- Another cold push followed by manual foreground opening when recipient went
  online completed text/file ACKs at6786ms. A transient route error recovered
  automatically; no second identity or duplicate saved entries appeared.
- Generic LastCall tray notification observed without exposing message content.
- Final signaling image rebuilt/deployed with profiles preserved. Public TLS/WSS
  and authenticated directory smokes passed; services report push=true/relay=true,
  phoneVerification=false. Native foreground text ACK passed after rollout.
- Both versioned public HTTPS APK downloads match46,427,337bytes and SHA256
  `c454eeb8f057b8ab74dccfa6dbfe6b93358b6a9739001a9f5cb8e5999973dec7`.
  Packaged bundle contains no temporary QA trace or server credential material.

Safe timing logs/UI hierarchies remain ignored local QA artifacts. No private
key, push token, raw SDP or human content is included in this report.

## Gates and limits

Final Node24 root check passed:20mobile+50server+125core=195tests, lint,
typecheck, Android/iOS JS exports and server build. Chrome integration:
9passed/1explicit TURN skip. Android release/R8 build passed,820tasks/29s.
The separate earlier external TURN run remains the relay transport evidence.

Transport wake window is9seconds plus awaited durable cleanup; Android controls
whether/when a task runs. Force-stop requires manual opening. Sender must be
reachable with retained data; unavailable peers cannot deliver immediately.
Large files/poor links can outlast a wake, remain pending and retry whole files.
No WorkManager/long-running transfer service, chunk resume, APNs or native
system incoming-call screen is claimed. These remain follow-up work.
