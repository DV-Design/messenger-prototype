# Connection choice after the 0.2 delivery report

Current policy remains direct content only. Existing public /ice advertises STUN,
no TURN. The directory is not a content relay or offline mailbox.

Actual native0.2 QA proved both directions work with a reachable direct browser
peer, while another Chrome candidate-privacy configuration remained waiting. This
does not establish the user's exact cause; their networks/status are still needed.

A practical availability option is direct-first ICE with an authenticated TURN
fallback when NAT/firewall prevents direct candidates. TURN forwards encrypted
DTLS/SRTP packets; the relay does not terminate peer content encryption, but
content traffic does traverse a relay and it incurs bandwidth cost/metadata.
That would change the user's strict server-coordination-only requirement and
must be a deliberate product choice. Never advertise TURN-only availability or
DPI invisibility merely because a TLS listener answers.

If selected: deploy a separate narrowly scoped relay, short-lived authenticated
credentials issued only after signed identity authentication, per-identity/relay
quotas, no private/loopback peer targets, correct external relay address/port
reachability, validated TLS for a dedicated hostname. Test forced-relay exact
bytes and actual audio, then cross-operator physical phones. A Docker Desktop
loopback test previously failed and is not a production relay recipe.

If direct-only retained: report actual connection failure, preserve pending text
and retry, explain that some network pairs remain unavailable. Permissions alone
cannot create a NAT path or wake an OS-suspended process. Push/background/offline
content custody are separate design decisions.

Primary transport reference: https://webrtc.org/getting-started/turn-server
