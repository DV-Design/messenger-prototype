# Native LastCall TURN on this Mac

Alternative to Docker's published UDP path, using the maintained Homebrew coturn
4.18.0 binary. **Choose exactly one backend.** Never start native TURN while
`lastcall-coturn` owns the same ports. This installs no global Homebrew service,
changes no VPN/Docker settings, and needs neither root nor privileged ports.

Observed scope: host-to-Docker published UDP echo/STUN failed locally, although
Docker's public TURN-over-TCP test subsequently carried exact file bytes and
chat/call traffic after router forwarding. That does not prove every UDP path
fails. Native TURN removes the Docker NAT hop; verify it independently.

## Inputs and validation

The existing ignored `infra/.env.public-turn` remains the only configuration
source. The launcher accepts literal `KEY=value` (optional surrounding quotes),
never `source`, shell expansion or arbitrary commands. Add:

```text
TURN_LISTEN_IP=192.168.1.26
TURN_EXTERNAL_IP=178.222.108.208
TURN_RUN_UID=501
TURN_RUN_GID=20
```

Keep the existing random shared secret and `TURN_TLS_DIR`; do not copy either
into Git or plist. Recheck public IPv4/DNS when the ISP address changes. The
launcher requires canonical IPv4, a local non-loopback listen address, the
current unprivileged UID/GID, private files owned by that user, trusted TLS for
`p2p.lienad.ru`, matching unencrypted key and at least one day until expiry.
TLS certificate/key and env files must have mode 0600 or stricter.

```sh
/usr/bin/python3 infra/native-turn/start_native_turn.py --check
```

This validates inputs/TLS and writes **only**
`~/.config/lastcall/native-runtime/turnserver.conf` atomically, mode 0600, inside
a 0700 directory. It does not open listeners, parse every coturn option or prove
relay delivery. Missing/invalid data fails closed. It uses the reviewed
`infra/coturn/public-turnserver.conf` quotas and peer denials, replaces cert/key,
pid and log paths, then adds native mapping `PUBLIC_IPV4/LAN_IPV4`. No laboratory
peer exceptions are accepted. Actual startup is required to validate binary
compatibility; do it only after freeing the ports from Docker.

## User LaunchAgent

Render the template from the repository root; paths, not secrets, enter plist:

```sh
/usr/bin/python3 - <<'PY'
from pathlib import Path
import os, plistlib
repo=Path.cwd().resolve()
template=repo/'infra/native-turn/dev.lastcall.turn.plist.in'
data=plistlib.loads(template.read_bytes())
def render(value):
    if isinstance(value,str): return value.replace('@REPO@',str(repo))
    if isinstance(value,list): return [render(v) for v in value]
    if isinstance(value,dict): return {k:render(v) for k,v in value.items()}
    return value
folder=Path.home()/'Library/LaunchAgents'
folder.mkdir(parents=True,exist_ok=True)
target=folder/'dev.lastcall.turn.plist'
with target.open('wb') as output: plistlib.dump(render(data),output)
os.chmod(target,0o600)
print(target)
PY
plutil -lint "$HOME/Library/LaunchAgents/dev.lastcall.turn.plist"
```

Stop only the Docker relay, retaining configuration and all unrelated services:

```sh
docker compose --env-file infra/.env.public-turn -p lastcall-turn -f infra/public/compose.turn.yaml --profile turn stop coturn
launchctl bootstrap "gui/$(id -u)" "$HOME/Library/LaunchAgents/dev.lastcall.turn.plist"
launchctl print "gui/$(id -u)/dev.lastcall.turn"
```

A logged-in GUI session is required for this user agent; it is not an unattended
boot daemon before login. The Python launcher execs coturn, preserving PID and
clearing inherited provider secrets. Crash retries are throttled to 10 seconds;
no parallel custom process supervisor or `brew services` entry is added.

Logs go to macOS syslog, whose retention/rotation is managed by the OS. Standard
output/error are discarded to prevent unbounded LaunchAgent log files. Startup
refusals log a safe reason under `LastCallTURN`; to diagnose interactively use
`--check`, which prints a safe error. Example log inspection:

```sh
log show --last 10m --style compact --predicate 'process == "turnserver" OR eventMessage CONTAINS "LastCall TURN startup refused"'
```

The plist limits file descriptors per process, not the whole user's process
count. Native mode does not enforce Docker CPU/memory/pid cgroups; allocation,
bandwidth and one relay-thread limits remain in coturn. Monitor load before
increasing the small-preview quotas.

## Verify, renew and roll back

Keep the existing router forwards/DHCP reservation described in
[TURN.md](../public/TURN.md). No port 443 or shared proxy change is required.
Before enabling signaling TURN URLs, require authenticated allocation and actual
forced-relay chat, exact file bytes and increasing inbound audio RTP counts for
each UDP/TCP/TLS URL separately. Test from outside the LAN as well as locally;
router hairpin behavior and a relay candidate alone are insufficient evidence.
Verify unauthorized/private-peer requests fail. No carrier/DPI guarantee follows
from local testing.

Certificate renewal requires native backend awareness. The existing Docker
certificate helper cannot restart native TURN; do not schedule it unchanged as
if renewal were complete. After validated certificate replacement, validate the
new native configuration and restart **only** this user agent:

```sh
/usr/bin/python3 infra/native-turn/start_native_turn.py --check
launchctl kickstart -k "gui/$(id -u)/dev.lastcall.turn"
```

That interrupts relayed calls. A backend-aware certificate-refresh scheduler and
expiry alert remain operational follow-up; no scheduler is installed here.

To stop native TURN without touching other applications:

```sh
launchctl bootout "gui/$(id -u)/dev.lastcall.turn"
```

Only after it has stopped may the Docker relay be started again with its explicit
Compose file/profile. Clear signaling TURN advertisement if no verified backend
is reachable; preserve the directory volume, private certificates and shared
secret for controlled rollback. Delete no shared Docker networks or services.
