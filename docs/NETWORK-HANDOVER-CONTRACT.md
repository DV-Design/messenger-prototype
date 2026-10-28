# Wi-Fi/cellular handover recovery

User request (2026-10-28): diagnose failure without Wi-Fi and retain a session
through a network transition for ten seconds. This extends the 0.5 outbox work.

Observed before changes: public ICE advertises STUN only, with no reachable TURN;
mobile runtime observes AppState but no network-interface changes. PeerSession
immediately destroys PC, transfer state and media tracks on signaling close or
remote peer-left; disconnected ICE has no restart/recovery window. These are
separate from FCM account setup and sender-local storage.

Target: a bounded ten-second recovery window using the same peer identity and
media tracks, immediate network-change notification, fresh signaling and ICE
restart. Do not deliberately end calls during a transient switch. Pending text
and files survive all transport replacement. A real user hangup/disconnect still
cleans up immediately; repeated events must not extend a dead call forever.
After failure, show the real transport error and retain queued content.

Native network observation uses a supported Expo58 module; foreground resume
also rechecks stale routes. Never require Wi-Fi and never use isWifiEnabled as
the reachability gate. Mobile data remains an eligible Internet connection.

Ten seconds is an application recovery budget, not a guarantee that audio can
flow while no network exists or while an OS suspends the process. To support
carrier NAT/filtering the deployment also needs authenticated, reachable TURN,
including a TCP/TLS option and actual forced-relay file/audio tests. Existing
Docker Desktop host is behind NAT; no dedicated public-IP VPS is connected yet.
Do not advertise a lab listener as a working public relay or disable TLS/ICE auth.

Verification: deterministic timer/generation/explicit hangup tests; fresh ICE
credentials in a real two-peer browser call; retain local track objects during
signaling interruption and resume actual peer data; focused native upgrade.
Physical Wi-Fi/cellular cross-operator tests remain separately documented.
