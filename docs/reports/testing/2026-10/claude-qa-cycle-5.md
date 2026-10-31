# Claude QA cycle5/6 — narrow source review PASS

2026-10-31. Same frozen candidate0.7.1/code11, base df467ab with working diff.
APK SHA256 e9c20142970f91c04f606546bbbddb981b72c37630bb81e6cb020054b70735d9.
Agent lastcall-release-tester; session84e8d66a-8cf6-4555-9d6c-bda2605795ff; cost$0.640369.

All three required skills explicitly read: READ_FALLBACK. Tests this invocation:
NOT_RUN, as allocated. No rebuild, source edits, recursive agents or deployment.

## Completed evidence reviewed from cycle4

340unit PASS/0fail:80mobile+71server+189core. Browser11PASS/1authenticated-TURN
skip/0fail, including66s actual video RTP. All types/builds/Android+iOS JS exports
PASS; lint0errors/one existing VoiceNote warning. Native release assembly PASS.
These commands ran in cycle4, whose final review response timed out. They were
not re-executed or misattributed to cycle5. See [cycle4](claude-qa-cycle-4.md).

## Bounded source-review result

PASS within the following CODE_TRACE scope; no actionable finding:

- Core openCallPush requires pinned contact, encrypted envelope authentication,
  direct membership, original deadline, current server epoch and a matching
  authenticated call-received result before publishing pendingIncoming/UI.
- Terminal FCM metadata only triggers a matching authenticated state fetch; it
  cannot locally issue an end command.
- Registry timing/tombstones and client endedCalls prevent late invitation
  resurrection. Server inserts offer before forwarding/pushing it.
- Native answer remains pending until core callState=active. UUID-bound audio
  activation clears only that pending deadline; the call-only Activity remains
  visible during while-in-use microphone/camera service startup.
- UI/audio cleanup is scoped to the live UUID; stale callbacks/timers cannot
  terminate a newer call. Existing targeted controller/lease tests support this.

Reviewed priority files: mobile call-push-model/system-call-model and native
AudioService/CallActivity/CallUiService; core messenger call control; server
call-registry and corresponding tests. This was not an exhaustive whole-project
review. Codex independently read these modified paths and the generated logs.

## Limits and stop decision

Native locked-screen/FCM behavior, physical Pixel/Vivo, Russian carriers, perceived
voice/video quality and iOS/APNs are NOT_TESTED by this review. No native UI claim.
One allocation remains. No cycle7; a changed-build retest may consume cycle6 only.
