#!/bin/bash
# Daily: renew the *.lienad.ru wildcard (lego, Cloudflare DNS) when due and put it on the Italian
# server (Caddy :4443 and coturn), then refresh the Mac TURN certificate from the Mac's Caddy.
# Services restart only when their certificate actually changed. Secrets are read at run time
# from the DDNS launch agent and never printed.
set -euo pipefail
umask 077
export PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin
REPO=$(cd "$(dirname "$0")/../.." && pwd)
LEGO_DIR=$HOME/.config/lastcall/lego
CRT=$LEGO_DIR/certificates/_.lienad.ru.crt
KEY=$LEGO_DIR/certificates/_.lienad.ru.key
PLIST=$HOME/Library/LaunchAgents/ru.lienad.ddns.plist
ITALY=independence
HOST=p2p-it.lienad.ru

log() { echo "$(date '+%F %T') $*"; }
plist() { /usr/libexec/PlistBuddy -c "Print :EnvironmentVariables:$1" "$PLIST" 2>/dev/null; }
notify() {
  local token chat; token=$(plist TG_BOT_TOKEN) || return 0; chat=$(plist TG_CHAT_ID) || return 0
  curl -s -m 10 -X POST "https://api.telegram.org/bot$token/sendMessage" --data-urlencode "chat_id=$chat" --data-urlencode "text=LastCall: $1" >/dev/null || true
}
failed() { log "FAILED: $1"; notify "certificate renewal failed: $1"; exit 1; }

valid() { # cert key host min-seconds
  openssl x509 -in "$1" -noout -checkend "$4" -checkhost "$3" >/dev/null 2>&1 || return 1
  openssl verify -verify_hostname "$3" -untrusted "$1" "$1" >/dev/null 2>&1 || return 1
  [ "$(openssl x509 -in "$1" -pubkey -noout | openssl pkey -pubin -outform DER | openssl dgst -sha256)" = \
    "$(openssl pkey -passin pass: -in "$2" -pubout -outform DER | openssl dgst -sha256)" ]
}

# 1. Wildcard: lego renews only when fewer than 30 days are left.
CF_DNS_API_TOKEN=$(plist CF_TOKEN) || failed "no Cloudflare token"
export CF_DNS_API_TOKEN
( cd "$LEGO_DIR" && lego run --accept-tos --path . --dns cloudflare --dns.resolvers 1.1.1.1:53 \
    --domains '*.lienad.ru' --renew-days 30 --no-random-sleep --log.format text --log.level warn ) || failed "lego run"
unset CF_DNS_API_TOKEN
valid "$CRT" "$KEY" "$HOST" $((14 * 86400)) || failed "wildcard certificate invalid or expiring in under 14 days"
log "wildcard valid until $(openssl x509 -in "$CRT" -noout -enddate | cut -d= -f2)"

# 2. Italy: copy when its files differ from the Mac copy (also repairs an earlier failed copy).
local_sum=$(shasum -a 256 "$CRT" | cut -d' ' -f1)
remote_sums=$(ssh -o BatchMode=yes -o ConnectTimeout=20 "$ITALY" 'sudo -n sha256sum /opt/lastcall/secrets/certs/crt.pem /etc/lastcall-turn/fullchain.pem' | cut -d' ' -f1 | sort -u) || failed "cannot reach Italy"
if [ "$remote_sums" != "$local_sum" ]; then
  ssh -o BatchMode=yes "$ITALY" 'sudo -n tee /opt/lastcall/secrets/certs/crt.pem.new >/dev/null' < "$CRT" || failed "upload certificate"
  ssh -o BatchMode=yes "$ITALY" 'sudo -n tee /opt/lastcall/secrets/certs/key.pem.new >/dev/null' < "$KEY" || failed "upload key"
  ssh -o BatchMode=yes "$ITALY" 'set -e; D=/opt/lastcall/secrets/certs; T=/etc/lastcall-turn
    [ "$(sudo -n sha256sum $D/crt.pem.new | cut -d" " -f1)" = '"$local_sum"' ]
    sudo -n install -o root -g root -m 0644 $D/crt.pem.new $D/crt.pem
    sudo -n install -o root -g root -m 0600 $D/key.pem.new $D/key.pem
    sudo -n install -o turnserver -g turnserver -m 0644 $D/crt.pem $T/fullchain.pem
    sudo -n install -o turnserver -g turnserver -m 0640 $D/key.pem $T/key.pem
    sudo -n rm -f $D/crt.pem.new $D/key.pem.new
    sudo -n docker restart lastcall-caddy >/dev/null
    sudo -n systemctl restart coturn' || failed "install on Italy"
  sleep 5
  echo | openssl s_client -connect "$HOST:4443" -servername "$HOST" 2>/dev/null | openssl x509 -noout -checkend $((14 * 86400)) >/dev/null || failed "Italy :4443 does not serve the new certificate"
  log "Italy updated (Caddy and coturn restarted)"; notify "certificate *.lienad.ru renewed and installed on Italy"
else
  log "Italy already has this certificate"
fi

# 3. Mac TURN: copied from the Mac's Caddy (p2p.lienad.ru, renewed by Caddy itself).
TURN_TLS_DIR=$HOME/.config/lastcall/turn-tls "$REPO/infra/public/refresh-turn-cert.sh" || failed "Mac TURN certificate refresh"
