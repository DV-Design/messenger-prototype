# Connection choice after the 0.2 delivery report

The user explicitly selected P2P first with an encrypted relay fallback. The
current deployment still advertises STUN only: no public TURN has been deployed
or validated. The directory is not a content relay or offline mailbox.

Actual native0.2 QA proved both directions work with a reachable direct browser
peer, while another Chrome candidate-privacy configuration remained waiting. This
does not establish the user's network conditions. The user clarified that their
missed messages occur when the recipient backgrounds or closes LastCall.

A practical availability option is direct-first ICE with an authenticated TURN
fallback when NAT/firewall prevents direct candidates. TURN forwards encrypted
DTLS/SRTP packets; the relay does not terminate peer content encryption, but
content traffic does traverse a relay and it incurs bandwidth cost/metadata.
This fallback is now authorized. Never advertise TURN-only availability or
DPI invisibility merely because a TLS listener answers.

Deployment still required: deploy a separate narrowly scoped relay, short-lived authenticated
credentials issued only after signed identity authentication, per-identity/relay
quotas, no private/loopback peer targets, correct external relay address/port
reachability, validated TLS for a dedicated hostname. Test forced-relay exact
bytes and actual audio, then cross-operator physical phones. A Docker Desktop
loopback test previously failed and is not a production relay recipe.

Until deployed: report actual connection failure, preserve pending text
and retry, explain that some network pairs remain unavailable. Permissions alone
cannot create a NAT path or wake an OS-suspended process. Push/background/offline
content custody are separate design decisions.

Primary transport reference: https://webrtc.org/getting-started/turn-server

2026-10-28 preparation: the user selected the current Mac and will apply router
forwarding personally. An isolated authenticated coturn instance now runs with
LastCall-only TLS files outside Git; see [deployment/ports](../infra/public/TURN.md).
LAN TCP authenticated allocation and TLS trust succeeded. Native host/LAN UDP
requests timed out, while bridge-internal authenticated UDP allocation succeeded;
the Docker Desktop UDP publication path remains under investigation. Router WAN
forwarding and external forced-relay content/audio are not verified. Signaling
continues to advertise STUN only; this checkpoint does not resolve msg-bcw.

Coturn behind NAT needs an external relay address and identical external/internal
UDP relay port mappings, in addition to the TLS listener. The existing host is
Docker Desktop behind a router; TCP 443 is already shared by other services. A
dedicated Linux host with a public IP is the simplest deployment option; no such
host/account is connected for this project. Do not change unrelated services or
advertise the old loopback-only laboratory recipe as a public fallback.
Reference: https://github.com/coturn/coturn/blob/master/man/man1/turnserver.1
