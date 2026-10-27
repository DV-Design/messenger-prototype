# Browser diagnostic client

Run `npm run dev:server` and `npm run dev:probe` from repository root, then open
`http://127.0.0.1:5173` in two separate browser profiles or devices. Each browser
uses the same `@messenger/core` PeerSession as the mobile app. Generate an invite
on the first device and pass it through a trusted channel; paste it on the other.
The password field conceals it on screen. The signaling server receives its hash,
not the invitation itself. Nothing persists in localStorage or a history database.

This is a foreground technical diagnostic UI. Status and route are observations,
not guarantees about encryption audits, DPI resistance or reliable mobile wake.
TURN-only refuses to connect unless GET /ice returns configured TURN URLs.
A direct route exposes IP information to the conversation's participant.
The diagnostic client defaults to the local server; configure an explicit URL for
LAN tests and allow its exact browser Origin on the server.

Chat, bounded file transfer (5 MiB), audio/video invitation/accept/reject, mute and
hangup use public core methods. Files display completion only after core reports
it, and received files download through short-lived blob URLs with octet-stream
content type. Text and file names render as text, never HTML. Browsers may block
autoplay; media controls appear if `play()` is rejected. Camera/microphone require
a trusted browser context (localhost or HTTPS).

`window.__session` is exposed only by Vite's development build to let real-browser
tests inspect snapshots and media tracks. It is absent in production bundles.
The client does not log invitations, signaling payloads or messages.

Run `npm run test:e2e` from root. Playwright uses installed Google Chrome in
headless mode, two isolated browser contexts, fake camera/audio, and explicit local
servers on ports 8799 and 5174. `PW_SERVER_PORT` / `PW_PROBE_PORT` override these.
It tests actual WebRTC, not mocked RTCPeerConnection. Failure traces/screenshots
remain under ignored `.tmp/playwright-results`. The default suite tests direct
connections and TURN-only failure without infrastructure. A successful remote
TURN path needs a separately reachable, authenticated coturn deployment.

For an explicitly provisioned local TURN laboratory, set `PW_TEST_TURN=1` and load
`TURN_URLS` / `TURN_SHARED_SECRET` into the Playwright process environment. The
configuration forwards them to its isolated signaling server only in this mode.
The optional test forces both peers to relay, verifies route selection, exact
file bytes and measured audio RTP bitrate. The no-TURN negative test is skipped
in that mode. Never put actual TURN secrets into test source or command output.
