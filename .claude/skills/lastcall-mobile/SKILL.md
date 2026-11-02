---
name: lastcall-mobile
description: Develop, debug, build, and test the LastCall React Native/Expo mobile app. Use for Android/iOS UI work, WebRTC calls/video, Expo config plugins, FCM/background wake, Metro/ADB debugging, native builds, and mobile QA in this repository.
---

# LastCall mobile

Read `AGENTS.md`, `README.md`, `docs/WAKE-CONTRACT.md`, and `tasks.md` before changing code. This is an Expo SDK 58 / React Native 0.88 app with native WebRTC 155, Expo Router, and a minimal signaling server. Android is the primary tested platform; iOS has no APNs/PiP yet.

## Commands

```bash
# From the repository root
npm run check                 # lint + typecheck + unit + export
npm run test:e2e              # Playwright browser/probe tests
npm run build:apk             # release APK; requires MESSENGER_GOOGLE_SERVICES_FILE

# Mobile-focused
npm run -w @messenger/mobile typecheck
npm run -w @messenger/mobile lint
npm run -w @messenger/mobile test
npx expo-doctor
npx tsc -p apps/mobile/tsconfig.tests.json --noEmit
```

Use `npx expo install` for Expo-compatible dependency versions. Never hand-edit generated `android/` or `ios/`; use config plugins.

## Android emulator/device

```bash
export PATH="$HOME/Library/Android/sdk/platform-tools:$HOME/Library/Android/sdk/emulator:$PATH"
adb devices
emulator -list-avds
emulator -avd MicControl_API36_16K
```

`adb` and `emulator` are also symlinked into `~/.local/bin`.

## MCP / tools

- `context7` — versioned Expo/React Native docs; fetch Expo SDK 58 docs, not memory.
- `metro-mcp` — Metro/Hermes inspection, console/network/errors, JS evaluation, device control, screenshots, UI automation. Start Metro first (`npm run -w @messenger/mobile start`). Hermes allows one CDP debugger; use metro-mcp's `open_devtools`, not Metro's `j`.
- `expo` — official Expo MCP; run `/mcp` once to authenticate. Gives docs and EAS build/workflow tools.
- `playwright` — browser/probe tests and local web flows.

## Key files

| Area | Files |
|---|---|
| Call UI/video | `apps/mobile/src/components/CallOverlay.tsx`, `src/call-camera*.ts`, `src/call-pip*.ts`, `src/video-controls-model.ts` |
| WebRTC core | `packages/core/src/session.ts` (`makePeer`, `ontrack`, `acquireMedia`, `stopCall`) |
| Calls/push | `apps/mobile/src/system-calls.ts`, `src/call-pushes.ts`, `src/call-push-model.ts` |
| Background messages | `src/background-notifications.ts`, `src/wake-model.ts`, `src/notifications.ts`, `src/push-previews.ts`, `src/runtime.ts` |
| Server wake/FCM | `apps/server/src/services.ts`, `src/providers.ts`, `src/directory.ts` |
| Contracts | `docs/WAKE-CONTRACT.md`, `docs/OUTBOX-CONTRACT.md`, `docs/DELIVERY-FIX-CONTRACT.md` |

## Debugging heuristics

### Video shows the local camera in an incoming call

Check both layers:
1. `PeerSession.makePeer().ontrack` only stores `event.streams[0]`. On some WebRTC implementations `event.streams` is empty and the remote stream is never set, so the UI falls back to the local stream. Build a remote `MediaStream` from `event.track` when `streams[0]` is missing, and add later tracks to the same remote stream.
2. `CallOverlay` renders `remoteVideo ? remote : local` in the main `RTCView`. For an incoming/active call, do not show the self-view as the main stage when no remote video exists. Show an avatar/waiting state; render the local preview only as the small PiP once remote video is present (or for an outgoing preview before the remote answers).

Always clean up local tracks on end; receiver tracks belong to the reusable peer connection and must not be stopped by `stopCall`.

### Messages do not arrive when the app is closed/sleeping

Trace the wake path:
1. Notification permission: `nativePushToken()` currently gates token retrieval on `Notifications.getPermissionsAsync().granted`. Data-only FCM wake does not require POST_NOTIFICATIONS; background sync should still register without it. Only previews/notifications need permission.
2. Task registration: `ensureBackgroundNotifications()` must run before/independent of token registration; `PushBridge` must not skip it when permission is denied.
3. Sender side: `MessengerClient.wakePending()` waits 2.5s before wake; if the sender is suspended immediately after sending, no wake is sent. Consider immediate/bounded wake when no connected pair exists, or a native outbox path.
4. Server: `services.wake()` needs a registered token with `background_sync`, recipient consent, non-expired intent, and a configured FCM provider. Check `services.push` and server logs; FCM data must be high-priority data-only for background sync.
5. Recipient background: the task connects to the directory and peer, then drains the sender-held outbox. If the sender is offline, P2P cannot complete; the server has no content mailbox by design. State this limit explicitly and do not claim delivery without a recipient ACK.

Do not add a server content mailbox without an explicit user decision. Prefer encrypted preview/FCM or a bounded encrypted outbox only if the user authorizes the contract change.

## Testing with the Claude worker

Use the previously created Claude Code worker for independent test/review passes:

```bash
claude -p --agent codex-claude-worker \
  --permission-mode acceptEdits --permission-prompts none \
  --allowedTools "Read,Grep,Glob,Bash(git diff *),Bash(npm test),Bash(npm run *)" \
  "Run the LastCall mobile tests and review the video/background-message changes. Report failures with file:line."
```

Codex can also call it through `claude_worker.claude_task` via MCP. Do not let the worker commit or push.

## Guardrails

- `npm run check` and `npm run test:e2e` must pass before accepting changes.
- Build Android when SDK/JDK available; report iOS accurately (no Xcode/signing).
- Preserve the relay-only policy, clean up camera/microphone tracks, and never commit secrets or recordings.
- Record follow-up work in Beads; update `tasks.md` with artifact links.
