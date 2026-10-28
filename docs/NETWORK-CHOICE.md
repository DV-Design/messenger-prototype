# P2P first, authenticated relay fallback

## Current checkpoint — 2026-10-28

The public LastCall deployment now advertises authenticated TURN over UDP, TCP
and TLS after signed directory authentication. It prefers direct WebRTC and can
use the authorized encrypted relay fallback when NAT/firewall blocks a direct
route. The unchanged Android 0.5.0/code6 APK supports this; restart both apps to
refresh cached ICE settings. Anonymous HTTP `GET /ice` intentionally remains
STUN-only (`REQUIRE_ICE_AUTH=1`). Production credentials expire after 600 seconds.

Only native Homebrew coturn 4.18.0, user LaunchAgent `dev.lastcall.turn`, runs on
the Mac. Docker `lastcall-coturn` is stopped. The user forwarded 3478 UDP/TCP,
5349 TCP and 49160–49200 UDP to identical ports on `192.168.1.26`. The active
signaling deployment explicitly uses `infra/.env.public-turn`; omitting that file
on recreation would disable fallback. [Native runbook](../infra/native-turn/README.md),
[service configuration](../infra/public/SERVICES.md).

Each public hostname transport passed forced-relay bidirectional text with real
ACK, exact 30 KB file bytes, increasing inbound audio RTP bytes on both peers,
and track cleanup. Independent external Azure runner
[40782070981](https://github.com/DV-Design/messenger-prototype/actions/runs/40782070981),
commit `5088fce`, passed **3/3 UDP/TCP/TLS** on 2026-10-28 22:43–22:44 UTC.
The private workflow is accessible to the repository owner. A further local
verification used actual production-issued 600-second credentials and passed
all three transports. [Review and evidence](reports/code-reviews/2026-10/CR-2026-10-28-native-turn.md).

The directory and push do not receive chat content. TURN physically forwards
encrypted DTLS/SRTP packets without terminating peer content encryption or
creating a chat archive. It consumes server bandwidth and exposes traffic
metadata. The sender-held seven-day text/file queue and signed group peer sync
remain on devices; TURN is not an offline mailbox.

This establishes an external relay path, not universal mobile availability or
DPI invisibility. Physical Russian-operator tests remain `msg-9rr`; certificate
and public-IP maintenance automation remains `msg-0aa`. Server FCM and iOS/APNs
are still disabled/unconfigured, so this transport work does not fix background
notifications or system incoming calls. The ten-second recovery budget is not
a promise of uninterrupted audio when no usable network exists.

## Historical evidence and deployment choice

The native 0.2 investigation proved direct transfer with reachable browser host
candidates; a different Chrome privacy configuration remained waiting. That did
not establish conditions on the user's phones. The user also clarified missed
messages when the recipient backgrounds or closes LastCall, a separate OS/push
availability concern.

Initial Docker preparation passed LAN TCP allocation and trusted TLS, while
host-to-Docker published UDP failed even for a generic echo/STUN probe.
Bridge-internal authenticated UDP allocation did work. After router forwarding,
Docker public TURN-over-TCP carried actual text/file/audio; the local UDP failure
therefore was not evidence that every external path failed. Switching only the
LastCall relay to native coturn removed the Docker NAT hop. The completed native
and independent external checks above supersede the earlier STUN-only checkpoint.

Coturn behind NAT needs a correct public relay address and identical mapped UDP
relay ports as well as its listener ports. Existing TCP 443 remains shared by
other applications and was not repurposed. A listener or relay candidate alone
is weaker evidence than forced-relay bytes and received audio RTP.

Primary references: [WebRTC TURN](https://webrtc.org/getting-started/turn-server),
[coturn configuration](https://github.com/coturn/coturn/blob/master/man/man1/turnserver.1).
