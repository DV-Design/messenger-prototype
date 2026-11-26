#!/bin/bash
# Mac watchdog for the Italy-primary setup (launchd, KeepAlive). Modes in $STATE/mode:
#   standby  - Italy serves; the router forwards to it; the local server is stopped.
#   promoted - Italy was down (from the Mac and from the RU relay) for 2 minutes; the local server
#              runs from the latest replica and the router points to it. When Italy is back, its
#              server is stopped at once (one primary only); after 10 stable minutes the Mac's data
#              goes back to Italy and Italy is the primary again.
set -uo pipefail
export PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin
STATE="${LASTCALL_FAILOVER_STATE:-$HOME/server/lastcall-failover}"
VOLUME=messenger-public_directory
ITALY_HEALTH=https://p2p-it.lienad.ru:4443/health
log() { echo "$(date '+%F %T') $*"; }
notify() {
  local plist="$HOME/Library/LaunchAgents/ru.lienad.ddns.plist" token chat
  token=$(/usr/libexec/PlistBuddy -c 'Print :EnvironmentVariables:TG_BOT_TOKEN' "$plist" 2>/dev/null) || return 0
  chat=$(/usr/libexec/PlistBuddy -c 'Print :EnvironmentVariables:TG_CHAT_ID' "$plist" 2>/dev/null) || return 0
  curl -s -m 10 -X POST "https://api.telegram.org/bot$token/sendMessage" --data-urlencode "chat_id=$chat" --data-urlencode "text=LastCall: $1" >/dev/null || true
}
mode() { cat "$STATE/mode" 2>/dev/null || echo standby; }
set_mode() { echo "$1" > "$STATE/mode"; }
route() { # $1: lastcall-tunnel | messenger-local
  printf 'upstream lastcall_active { server %s:8787 max_fails=0; }\n' "$1" > "$STATE/upstream.conf.new" && mv "$STATE/upstream.conf.new" "$STATE/upstream.conf"
  docker exec messenger-router nginx -s reload >/dev/null 2>&1 || docker restart messenger-router >/dev/null
  log "routing to $1"
}
italy_api() { curl -s -m 5 "$ITALY_HEALTH" | grep -q '"ok"'; }
italy_from_ru() { ssh -o BatchMode=yes -o ConnectTimeout=8 ru-relay "curl -s -m 5 $ITALY_HEALTH" 2>/dev/null | grep -q '"ok"'; }
italy_host() { ssh -o BatchMode=yes -o ConnectTimeout=8 independence true >/dev/null 2>&1; }
local_health() { docker exec messenger-local node -e "fetch('http://127.0.0.1:8787/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" >/dev/null 2>&1; }

promote() {
  local latest="$STATE/replicas/latest.sqlite"
  [ -e "$latest" ] || { log "no replica, cannot promote"; notify "Италия недоступна, но копии базы нет — Mac не может подменить сервер"; return 1; }
  log "promoting the Mac from $(readlink "$latest")"
  docker run --rm -v "$VOLUME":/data -v "$STATE/replicas":/r:ro alpine:3.22 sh -c \
    'cp "/r/$(readlink /r/latest.sqlite || echo latest.sqlite)" /data/directory.sqlite.new && rm -f /data/directory.sqlite-wal /data/directory.sqlite-shm && mv /data/directory.sqlite.new /data/directory.sqlite && chown 1000:1000 /data/directory.sqlite' || return 1
  docker start messenger-local >/dev/null || return 1
  for _ in $(seq 1 30); do local_health && break; sleep 2; done
  local_health || { log "local server did not start"; return 1; }
  route messenger-local; set_mode promoted
  notify "Италия недоступна 2 минуты (и с Mac, и из России). Сервер переключён на Mac, данные из копии $(readlink "$latest")."
}
failback() {
  log "failing back to Italy"
  docker stop messenger-local >/dev/null 2>&1
  local copy="$STATE/failback-$(date +%Y%m%d-%H%M).sqlite"
  docker run --rm -v "$VOLUME":/data -v "$STATE":/s alpine:3.22 sh -c \
    "apk add --no-cache sqlite >/dev/null && sqlite3 /data/directory.sqlite \".backup /s/$(basename "$copy")\"" || { docker start messenger-local >/dev/null; return 1; }
  [ "$(sqlite3 "file:$copy?immutable=1" 'PRAGMA quick_check;')" = ok ] || { docker start messenger-local >/dev/null; return 1; }
  ssh -o BatchMode=yes independence 'sudo -n install -d -m 0700 /var/lib/lastcall-backup && sudo -n tee /var/lib/lastcall-backup/from-mac.sqlite >/dev/null && sudo -n docker stop lastcall-server >/dev/null; V=/var/lib/docker/volumes/lastcall_data/_data; sudo -n cp $V/directory.sqlite /var/lib/lastcall-backup/before-failback.sqlite 2>/dev/null; sudo -n rm -f $V/directory.sqlite-wal $V/directory.sqlite-shm && sudo -n install -o 1000 -g 1000 -m 0644 /var/lib/lastcall-backup/from-mac.sqlite $V/directory.sqlite && sudo -n docker start lastcall-server >/dev/null' < "$copy" || { docker start messenger-local >/dev/null; return 1; }
  for _ in $(seq 1 30); do italy_api && break; sleep 2; done
  italy_api || { log "Italy did not come up after the copy; staying on the Mac"; docker start messenger-local >/dev/null; return 1; }
  route lastcall-tunnel; set_mode standby
  notify "Италия снова в работе 10 минут. Данные с Mac перенесены, сервер снова в Италии."
}

mkdir -p "$STATE"; [ -f "$STATE/upstream.conf" ] || route lastcall-tunnel
down=0; back=0
log "watchdog started in mode $(mode)"
while true; do
  case "$(mode)" in
    standby)
      if italy_api; then down=0
      else
        down=$((down + 15))
        if [ "$down" -ge 120 ]; then
          if italy_from_ru; then log "Italy unreachable from the Mac but fine from the RU relay; not promoting"; down=60
          else promote || down=60; down=0; fi
        fi
      fi ;;
    promoted)
      # Italy's own server must not take clients while the Mac holds the data.
      if italy_api; then ssh -o BatchMode=yes -o ConnectTimeout=8 independence 'sudo -n docker stop lastcall-server >/dev/null' && log "stopped the Italian server (the Mac is primary)"; fi
      if italy_host; then back=$((back + 15)); else back=0; fi
      if [ "$back" -ge 600 ]; then failback || back=300; [ "$(mode)" = standby ] && back=0; fi ;;
  esac
  sleep 15
done
