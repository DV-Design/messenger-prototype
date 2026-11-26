# Italy primary, Mac standby

The primary server runs on Independence (Italy) at `https://p2p-it.lienad.ru:4443`
(`/opt/lastcall`: `lastcall-server` + Caddy with the `*.lienad.ru` wildcard cert, coturn on 3478/5349).
The Mac keeps `p2p.lienad.ru` working and stands by.

## How traffic flows

- Apps 1.0.48+ learn the server list after sign-in (`CLIENT_ENDPOINTS`, sent only to signed-in clients
  that ask with `endpointsV1`), try Italy first and fall back to `p2p.lienad.ru`. The account key stays
  `p2p.lienad.ru`, so local history is unaffected.
- `p2p.lienad.ru` on the Mac: shared proxy → `messenger-signaling:8787`, which is now the nginx `router`
  here. In standby it forwards to `lastcall-tunnel` (ssh `-L` to Italy `127.0.0.1:8787` as the restricted
  user `lastcall-relay`), so older apps and people who cannot reach port 4443 see the same server.
- TURN: Italy's TURN is listed after the Mac's in `TURN_URLS` (same static secret).

## Jobs on the Mac (launchd)

| Agent | Script | What |
|---|---|---|
| `ru.lienad.lastcall-replicate` | `replicate.sh` every 600 s | sqlite `.backup` on Italy, copied to `~/server/lastcall-failover/replicas/`, `quick_check`, keeps 144 (one day); skipped unless mode is `standby` |
| `ru.lienad.lastcall-watchdog` | `watchdog.sh`, KeepAlive | mode in `~/server/lastcall-failover/mode` |

Watchdog:

- `standby`: Italy API checked every 15 s. Down for 120 s from here **and** from the RU relay → promote:
  latest replica into the `messenger-public_directory` volume, start `messenger-local`, route to it,
  Telegram note. Mode `promoted`.
- `promoted`: if the Italy API answers again it is stopped (one writer only). Once Italy has been
  reachable for 600 s → failback: Mac DB backed up, uploaded to Italy, Italy started, route to the
  tunnel, `messenger-local` stopped. Mode `standby`.
- Data written to Italy after the last replica (up to 10 minutes) is lost on promote.

Logs: `~/Library/Logs/lastcall-{replicate,watchdog}.log`.

## Manual commands

```bash
cat ~/server/lastcall-failover/mode
docker compose -f infra/failover/compose.yaml up -d      # router + tunnel
docker exec messenger-router nginx -s reload
launchctl kickstart -k gui/$(id -u)/ru.lienad.lastcall-watchdog
```

Secrets stay out of the repo: tunnel key in `~/.config/lastcall/tunnel/`, wildcard cert in
`~/.config/lastcall/lego/`, Italy server env in `/opt/lastcall/secrets/` (root only).

## Known limits

- The shared nginx-stream on the Mac does not pass the client address (PROXY protocol off), so every
  connection through `p2p.lienad.ru` looks like it comes from the Mac; direct connections to Italy keep
  the real address.
- The wildcard cert expires 2027-02-24: renew with lego and copy to Italy (`/opt/lastcall/certs`,
  `/etc/lastcall-turn`) before then.
