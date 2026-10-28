# Code review: current-server TURN preparation

Date: 2026-10-28. Scope: five new opt-in TURN configuration/runbook/refresh files.
History reviewed: existing loopback laboratory and public service configuration;
the latter deliberately remains unchanged and STUN-only.

Verdict: PASS for preparation; NOT a completed mobile-connectivity fix.
No unresolved implementation findings after correcting the allocation bandwidth
reservation and validating the certificate chain before replacement.

## Main-context review

Read all five files. The relay has its own bridge, non-root UID501/GID20,
read-only mounts/root, bounded resources/logs and no shared proxy attachment.
REST secret is validated and rendered privately in tmpfs, absent from argv/logs.
Private/loopback/link-local/reserved/IPv6 peer targets are denied, with no lab
override. LastCall-only certificate copy remains outside Git with 0700/0600 modes.
Certificate refresh validates trust/identity/expiry/key before replacing files;
it restarts only TURN when changed. No scheduler was installed.

The final configuration reserves 256 KiB/s per allocation and 8 MiB/s aggregate
capacity, supporting its configured 32-allocation reservation limit. The 41-port
range and small preview capacity do not promise a complete eight-user relay mesh.

## Validation

- Root `npm run check`: PASS, 160 tests plus lint/type checks/JS exports/builds.
- Root `npm run test:e2e`: 9 PASS, 1 explicit unconfigured-TURN skip, 29.7 seconds.
- Main: Compose `config --quiet`, container `--check`, both scripts ShellCheck,
  unchanged-certificate refresh and `git diff --check`: PASS.
- Worker: 10 invalid IPv4/four invalid secret inputs rejected; actual isolated
  pinned-image startup accepted configuration, verified TLS1.2/hostname/chain,
  and rejected TLS1.1 with protocol-version alert. Main read the implementation.
- Main started only `lastcall-coturn`, then restarted only it after final config;
  process healthy. No directory/proxy/container changes elsewhere.
- Main native Node TLS against LAN5349: TLS1.3, trusted p2p.lienad.ru certificate.
- Main fresh Chrome on the public diagnostic HTTPS origin: authenticated LAN
  TURN/TCP3478 returned relay address178.222.108.208. This is allocation only.
- Main Chrome LAN UDP allocation timed out; native Mac UDP also timed out.
  Worker independently reproduced LAN UDP timeout and successful authenticated
  bridge-internal UDP allocations. External UDP publication needs diagnosis.
- No external forced-relay file/audio success and no physical carrier success.
  No application source changed; the previously verified0.5 APK was not rebuilt.

## Remaining deployment work

User will forward3478UDP/TCP,5349TCP,49160–49200UDP unchanged to192.168.1.26 and
reserve that LAN address. Then validate each TURN transport independently with
actual relay bytes and growing inbound audio RTP counters, including external
phones. Keep signaling STUN-only until reachable transport is established.
Track this in msg-bcw; certificate/public-IP automation in msg-0aa. Server FCM
setup remains separate. Standard TURN/TLS does not establish DPI invisibility.
