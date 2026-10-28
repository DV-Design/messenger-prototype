# LastCall TURN on the existing Mac/router

Opt-in coturn 4.7.0 deployment, separate from signaling and the shared Caddy
network. The relay forwards encrypted WebRTC packets; it does not save chat
content. Do not advertise it to clients until an authenticated allocation and
actual forced-relay text/file/audio transfer succeed from outside the LAN.

## Ports and NAT

Reserve the Mac's LAN address `192.168.1.26`. Forward these Huawei-router WAN
ports to the **same ports** on that address, and allow them through the Mac
firewall/Docker Desktop:

| WAN port | Protocol | LAN target |
|---|---|---|
| 3478 | UDP and TCP | 192.168.1.26:3478 |
| 5349 | TCP | 192.168.1.26:5349 |
| 49160–49200 | UDP | 192.168.1.26:49160–49200 |

Do not change ports 80/443, shared proxy routes or other applications. Use the
current public IPv4, not a private WAN/CGNAT address; `178.222.108.208` was observed
at preparation time and must be rechecked. DNS `p2p.lienad.ru` must resolve there.
If the router WAN IP differs from the public IP, another NAT/ISP restriction may
require an additional forward or a public address from the ISP.

The startup script derives the single container IPv4 and writes
`external-ip=PUBLIC/CONTAINER` to a private tmpfs config. Every relay port must
survive both Docker Desktop NAT and router NAT unchanged. LAN tests may depend
on router NAT hairpin support; a local success/failure is not an external test.

## Private configuration and launch

Use the existing ignored `infra/.env.public-turn`, mode 0600, with these names:
`TURN_SHARED_SECRET` (random 32–128 alphanumeric characters), `TURN_EXTERNAL_IP`,
`TURN_TLS_DIR` (absolute existing directory containing `fullchain.pem` and
`privkey.pem`), `TURN_RUN_UID=501`, `TURN_RUN_GID=20`. UID/GID must match the
certificate owner on this Mac. Keep the directory 0700 and files 0600; never
mount the complete Caddy certificate volume or make its keys public.

The certificate must be trusted for `p2p.lienad.ru`, match its key and have at
least one day remaining. Runtime verifies the chain against the pinned image's
CA store. Renew/copy certificates before expiry. No missing bind source is
created automatically. Do not print resolved Compose configuration: it includes
the shared secret. Use `config --quiet`.

```sh
docker compose --env-file infra/.env.public-turn -p lastcall-turn -f infra/public/compose.turn.yaml --profile turn config --quiet
docker compose --env-file infra/.env.public-turn -p lastcall-turn -f infra/public/compose.turn.yaml --profile turn run --rm --no-deps coturn --check
docker compose --env-file infra/.env.public-turn -p lastcall-turn -f infra/public/compose.turn.yaml --profile turn up -d coturn
```

`--check` validates inputs/TLS identity and renders the config; it is not a coturn
syntax parser or a relay test. Actual isolated startup of this exact config was
also checked without published host ports: no parser errors, TLS 1.2 and trusted
hostname verification succeeded, TLS 1.1 received a server protocol-version alert.
Coturn 4.7.0 already requires TLS 1.2 or newer; obsolete `no-tlsv1_1` is rejected,
and `no-tlsv1` can be parsed as an abbreviation for `no-tlsv1_2`. Do not add them.
The Compose healthcheck proves process liveness only.

After external verification, signaling must receive the same REST secret and:

```text
TURN_URLS=turn:p2p.lienad.ru:3478?transport=udp,turn:p2p.lienad.ru:3478?transport=tcp,turns:p2p.lienad.ru:5349?transport=tcp
TURN_TTL_SECONDS=600
```

Keep `REQUIRE_ICE_AUTH=1`; anonymous HTTP `/ice` stays STUN-only. Recreate only
LastCall signaling with its explicit private env/optional Firebase override;
preserve its database volume. Test each TURN URL separately using authenticated
credentials: a working UDP URL must not mask a broken TCP/TLS fallback. Verify
`route=relay`, exact file bytes, bidirectional chat and increasing inbound audio
RTP packets on both participants. Invalid credentials and private-peer targets
must be rejected. An open TLS port or a relay candidate alone proves less.

## Scope, capacity and certificate renewal

This is a small IPv4 preview: **32 allocations**, **41 UDP relay ports**, four
allocations per generated credential, 256 KiB/s per allocation and 8 MiB/s total
(each direction accounted separately). Bandwidth capacity is allocation reservation, not merely live throughput: the
8 MiB/s cap supports 32 allocations × 256 KiB/s; lowering it can return 486 even
when the link is idle. Port reservations can reduce usable
capacity. A full eight-user mesh is not supported by this capacity promise.
Per-credential quota is not a stable per-user quota because directory requests
issue fresh usernames; authenticated directory rate limits remain necessary.
`no-tcp-relay` disables RFC6062 peer TCP endpoints, while client-to-TURN TCP/TLS
still works with UDP relay endpoints. The server needs no relay TCP port range.

Private, loopback, link-local, CGNAT, documentation, reserved, multicast and all
IPv6 peer targets are denied. This does not block client access to listeners.
There are no allow-list overrides or laboratory loopback switches. The public
server IP remains eligible as a peer so two relay allocations on this instance
can communicate; IP rules cannot distinguish its relay ports from other public
services behind the same router. Keep router forwarding narrow and do not expose
private services on the WAN address. Logs rotate at 2 × 5 MiB and contain traffic
metadata; the secret is absent from process argv and startup logs, although a
Docker administrator can inspect configured environment values.

Refresh the narrowly scoped certificate copy after Caddy renews it:

```sh
TURN_TLS_DIR=/Users/daniel/.config/lastcall/turn-tls infra/public/refresh-turn-cert.sh
```

The helper reads only the two exact `p2p.lienad.ru` Caddy certificate paths,
validates trusted chain/hostname/expiry/key matching before writes, atomically
replaces each staged file and
restarts **only** `lastcall-coturn` if changed and running. This briefly interrupts
relayed calls; a crash between the two file renames fails closed on key mismatch.
The host OpenSSL default CA store must trust the chain; an absent CA store fails
closed before replacement. No global scheduler is installed. Run the helper periodically through an existing
approved scheduler and alert on failure; manual copies alone do not renew TURN.

To stop/roll back only the relay, use the same Compose project/file selection
with `stop coturn`; clear signaling TURN URLs and secret on its next deliberate
recreation. Do not delete directory volumes or shared proxy networks. Router
forwarding must also be removed if permanently withdrawing the relay.

NAT traversal still depends on the ISP, NAT port preservation, firewall and
client transport policy. Port 5349 is not an invisibility/DPI guarantee. Without
a reachable path no reconnect code can guarantee delivery or continuous audio.

Sources: [coturn NAT and peer rules](https://github.com/coturn/coturn/wiki/turnserver),
[coturn 4.7.0 configuration](https://github.com/coturn/coturn/blob/4.7.0/examples/etc/turnserver.conf),
[official Docker image](https://github.com/coturn/coturn/tree/4.7.0/docker/coturn).

## Native macOS alternative

[Native LastCall launcher and user LaunchAgent](../native-turn/README.md) use
maintained Homebrew coturn 4.18.0 on the same LAN IP and forwarded ports, removing
the Docker NAT hop. Exactly one backend may own those ports. Native mode keeps
private REST/TLS configuration and the same peer rules/preview quotas; its logs
use bounded macOS syslog instead of Docker log rotation.

Local generic UDP echo tests showed a host-to-Docker published UDP failure, not
a universal external failure: after router forwarding, public TURN-over-TCP
carried chat, exact file bytes and call traffic in the existing browser test.
Native UDP/TCP/TLS and independent external delivery still require their own
checks. The Docker certificate-refresh helper does not restart the native user
agent; use the native renewal instructions until backend-aware scheduling exists.
