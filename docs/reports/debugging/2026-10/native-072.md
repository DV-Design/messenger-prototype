# LastCall 0.7.2/code12 — focused Android native acceptance

Date: 2026-10-31. Main-agent native acceptance, separate from independent Claude QA.
Candidate: `artifacts/LastCall-0.7.2.apk`, 54,979,729 bytes, SHA256
`d5d0839ad0004c6476710e2ad4369c67f322d0c87ad418f1d1689a82bd73a951`. Package `dev.messenger.prototype`, min24/target36/compile37,
ARM64, unchanged test signing certificate `fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c`.

## Build and environment

`npm run build:apk` passed native Java compilation and release/R8 assembly.
The helper forced the current JavaScript bundle and verified packaged
`assets/app.config`: `nativeFcmConfigured=true`, version0.7.2, versionCode12.
Build evidence: ignored `.tmp/current/release-072.log`.

Only the project's isolated Android17/API37.2 AVD `LastCall_17_QA`, serial
`emulator-5572`, was used. In-place upgrade retained synthetic installation
`qa_native_071_1031` and its history. Counterparty: synthetic browser
`qa_071_50352117`, fake browser media, emulator `-no-audio`. No physical phones,
human accounts, router or other applications/services were changed.

## Observed native results

- **Outgoing native → browser:** own call UI reached active/direct. Browser
  audio RTP:1241 packets received/1230 sent. «Звук» showed «Громкая связь»
  selected; Android confirmed active communication device `speaker` and
  `MODE_IN_COMMUNICATION` (3), app owner PID3190/UID10230.
- **Incoming browser → native:** accepted through LastCall's own app UI,
  active/direct. Fresh audio SSRC counters:669 packets received/665 sent.
  The same stats also retained old SSRC counters1258/1236; these were not added
  to fresh-call totals. Native chooser again showed selected «Громкая связь»;
  Android confirmed `speaker`, mode3, with system owner PID661/UID1000 observed
  on this incoming Telecom path. This is not evidence that the app owned the
  incoming mode request.
- Platform logs exposed no earpiece; no Bluetooth device was connected. The
  chooser correctly offered the available speaker. **Switching earpiece↔speaker,
  Bluetooth or wired hardware was not exercised.**
- After end, main observed no AudioService/CallUiService and mode0/ownerPID0.
  Existing call lifetime/deadline code was not replaced by this routing change.
- **Voice recording:** native UI contained the accessible component «Звуковая
  дорожка записи с микрофона» at5s, with Stop/Cancel, no unavailable-meter label.
  A roughly13-second M4A/audio-mp4 recording was finalized and delivered to the
  browser:108744 bytes, complete/received, MP4 container check true. An interim
  encrypted-saving state was visible. Presence of the component is not proof
  of amplitude reaction to a real speaker or heard quality on this muted AVD.
- **Mixed timeline:** native UI order was `QA_072_BEFORE` → voice106.2KB,
  «Доставлено» → `QA_072_AFTER` → received `lastcall-background-qa.txt`35B →
  `QA_072_AFTER_FILE`. Voice and ordinary file occupied chronological rows,
  followed by newer text, rather than an attachment footer.

Ignored evidence under `.tmp/current/native-072/`:
`outgoing-audio.txt`, `incoming-audio.txt`, `outgoing-rtp.json`,
`incoming-rtp.json`, `outgoing-picker.json`, `incoming-picker.json`,
`voice-recording.json`, `voice-received.json`, `mixed-timeline.json`.
The owned browser and AVD were stopped after testing; no PIN was set in this run.

## Independent gates and publication

[Claude cycle1/6](../../testing/2026-10/media-audio/claude-qa-cycle-1.md) passed
`npm run check` and `npm run test:e2e`:363 unit tests (95mobile/71server/197core),
11 browser passes/1 authenticated-TURN environment skip, types/builds and
Android+iOS JavaScript exports. Lint:0 errors/1 pre-existing VoiceNote warning.
The tester did not perform native acceptance; the evidence above belongs to main.
A skip and JS export do not establish native TURN/iOS acceptance.

Main atomically published the binary and preview alias, then downloaded the
primary, alternate and alias HTTPS URLs in full. All three matched the exact
54,979,729 bytes and SHA256 above. Historical0.7.1 remains available.

## Remaining acceptance

Physical Android metering response, heard speech, incoming/outgoing audio/video
route switches and headset hotplug remain `msg-qlk`. iOS native audio routing is
absent (`msg-uhw`); APNs/CallKit remain unconfigured. Physical Pixel/Vivo video,
Russian carriers/handover, DPI and OEM battery behavior remain existing open work
(`msg-si6`, `msg-3z9`, `msg-9rr`). No fresh lockscreen/background-call or physical
video acceptance is claimed here; [0.7.1 evidence](native-071-cycle7.md) remains
historical. See [focused phone tasks](../../../TESTING-RU.md).
