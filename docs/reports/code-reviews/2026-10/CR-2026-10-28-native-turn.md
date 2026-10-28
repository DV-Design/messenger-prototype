# Native TURN and external smoke review

Date: 2026-10-28. Reviewed native launcher/plist/runbook, TURN runbook additions,
dispatch-only workflow and relay verifier in the main context after reading
existing configuration/session/tests and history8070e4f.

Verdict: PASS. Native relay and authenticated production advertisement are active.

## Findings addressed

Docker's generic published UDP echo failed for host-originated packets while
native echo and container-internal echo passed. After router forwarding, Docker
TURN/TCP carried real file bytes; the evidence does not prove every Docker UDP
path is broken. Native coturn removes that extra NAT path and its native/public
STUN replies now succeed. Only the LastCall Docker relay was stopped.

The first smoke reused one credential across all protocols; TCP failed at connect
while UDP/TLS and an isolated TCP run passed. Quota exhaustion was a hypothesis,
not confirmed by error codes. The final verifier uses six distinct bounded
credentials, matching separate client ICE issuance, and records safe failure
states/counters. It preserves all three transport and byte/audio assertions.

## Security and scope

Launcher validates literal allowlisted env keys without eval/source, private
file ownership/modes, canonical bound IPv4, trusted TLS identity/chain/key and
expiry before an atomic0600 runtime config. It runs non-root and clears inherited
secrets before exec. The plist contains paths only and applies per-process limits;
logs use OS-managed syslog. Exactly one relay backend owns the ports.

External workflow is manual only with read-only repository permissions. It
receives only six short-lived HMAC client credentials via an encrypted secret,
never the relay shared secret. Its host/ports are allowlisted, identity lifetime
is bounded to15min, and exceptions/SDP/invitations/credentials are not logged.
Each protocol requires two forced-relay routes, two text ACKs, an exact30KB file,
increasing inbound audio RTP bytes on both peers and stopped tracks after hangup.
CI additionally requires a different public IPv4 from the relay host.

## Main-context verification

- `npm run check`: PASS160 tests, lint/types/JS exports/builds.
- Baseline full browser suite:9 PASS,1 explicit TURN skip,26.7s.
- Focused native forced-relay UDP and TCP tests: PASS7.8s/7.9s.
- New six-credential verifier: UDP/TCP/TLS3/3 PASS through public hostname;
  per protocol two ACKs,30,000 exact bytes, growing inbound audio on both peers,
  track cleanup. This initial run uses the host network, so is a hairpin test.
- Main native syntax/plist/render check, worker malformed-input checks, and
  source/diff review: PASS. User LaunchAgent running as UID501, Docker relay stopped.
- Native UDP valid auth succeeded; loopback permission denied403; wrong password
  denied401. Host and public STUN transaction IDs matched.

## External verification and production activation

[External job40782070981](https://github.com/DV-Design/messenger-prototype/actions/runs/40782070981)
ran on revision5088fce from Azure IPv4 `52.173.179.40`, distinct from the relay
host. All three transports passed with two relay routes, two text ACKs, matching
30,000-byte file hash, stopped tracks and these inbound audio byte increases:

| Transport | Peer A | Peer B |
|---|---:|---:|
| UDP | 622 | 412 |
| TCP | 678 | 410 |
| TLS | 641 | 427 |

The temporary encrypted repository client-credential secret was deleted after
completion; the shared server secret never left the Mac. The final verifier now
compares egress against the approved hostname's current DNS addresses, avoiding
a stale hardcoded-IP check after a future ISP address change.

Only LastCall signaling was recreated with the private TURN env file; the
directory volume and shared proxy were preserved. A short startup502 cleared;
HTTPS health is healthy. Anonymous `/ice` still returns STUN only. Authenticated
services report relay=true, push=false, phoneVerification=false; six real
server-issued credentials expire within600s. These credentials independently
passed UDP/TCP/TLS text/file/inbound-audio checks through the public hostname.
Bad-password authentication returned401, private-loopback permission403, and a
TLS1.1 client received an explicit server protocol-version rejection.

Final [job40783143258](https://github.com/DV-Design/messenger-prototype/actions/runs/40783143258)
on revision947f7dc repeated the full external check using only actual credentials
obtained through production directory authentication (600s validity), after the
DNS-based external-origin fix. Azure egress was `52.161.201.81`; UDP/TCP/TLS all
passed, including inbound audio increases654/346,622/343,671/340 bytes respectively.
Its temporary encrypted repository secret was also deleted; secret inventory is
empty. This verifies both the public relay path and production credential wiring.

Published index, testing tasks and architecture notes match repository sources
byte for byte through both HTTPS gateways. The unchanged0.5 APK remains available
with its previous46,380,521-byte length. Provisioning issue msg-bcw is closed;
physical operator feedback is still pending and tracked separately.

Native APK/app sources did not change; no rebuild is claimed.
Certificate/public-IP automation remains msg-0aa and physical Russian operator
validation remains msg-9rr; push setup remains independent msg-3z9.
