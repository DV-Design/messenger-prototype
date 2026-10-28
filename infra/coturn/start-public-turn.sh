#!/bin/sh
set +x
set -eu
fail() { printf '%s\n' "$1" >&2; exit 1; }
# Never accept arbitrary turnserver arguments or put the shared secret in argv/logs.
case "$#:${1:-}" in 0:|1:--check) ;; *) fail 'Usage: start-public-turn.sh [--check]' ;; esac
case "${TURN_SHARED_SECRET:-}" in ''|*[!A-Za-z0-9]*) fail 'TURN_SHARED_SECRET must be random alphanumeric text (32-128 characters)' ;; esac
[ "${#TURN_SHARED_SECRET}" -ge 32 ] && [ "${#TURN_SHARED_SECRET}" -le 128 ] || fail 'TURN_SHARED_SECRET length must be 32-128 characters'
case "${TURN_TLS_DIR:-}" in /*) ;; *) fail 'TURN_TLS_DIR must be an existing absolute host directory' ;; esac
# Strict public IPv4 only: no injection, shorthand, octal, reserved or local mapping.
printf '%s\n' "${TURN_EXTERNAL_IP:-}" | awk -F. '
 NF!=4 {exit 1}
 {for(i=1;i<=4;i++)if($i!~/^[0-9]+$/||length($i)>3||(length($i)>1&&substr($i,1,1)=="0")||$i>255)exit 1;
  if($1==0||$1==10||$1==127||$1>=224||($1==100&&$2>=64&&$2<=127)||($1==169&&$2==254)||($1==172&&$2>=16&&$2<=31)||($1==192&&($2==168||($2==0&&($3==0||$3==2))||($2==88&&$3==99)))||($1==198&&($2==18||$2==19||($2==51&&$3==100)))||($1==203&&$2==0&&$3==113))exit 1}
 END{if(NR!=1)exit 1}' || fail 'TURN_EXTERNAL_IP must be one canonical public IPv4 address'
for file in /local/public-turnserver.conf /run/coturn-tls/fullchain.pem /run/coturn-tls/privkey.pem; do
  [ -f "$file" ] && [ -s "$file" ] && [ -r "$file" ] || fail 'A required config/certificate file is missing or unreadable'
done
openssl x509 -in /run/coturn-tls/fullchain.pem -noout -checkend 86400 >/dev/null 2>&1 || fail 'TURN certificate is expired, near expiry or not valid for p2p.lienad.ru'
openssl verify -verify_hostname p2p.lienad.ru -untrusted /run/coturn-tls/fullchain.pem /run/coturn-tls/fullchain.pem >/dev/null 2>&1 || fail 'TURN certificate hostname or trusted certificate chain is invalid'
openssl pkey -passin pass: -in /run/coturn-tls/privkey.pem -check -noout >/dev/null 2>&1 || fail 'TURN private key is invalid or encrypted'
cert_key=$(openssl x509 -in /run/coturn-tls/fullchain.pem -pubkey -noout | openssl pkey -pubin -outform DER | openssl dgst -sha256)
private_key=$(openssl pkey -passin pass: -in /run/coturn-tls/privkey.pem -pubout -outform DER | openssl dgst -sha256)
[ "$cert_key" = "$private_key" ] || fail 'TURN certificate does not match its private key'
# One isolated Docker bridge, one IPv4 relay address; no LAN/host networking.
relay_ip=$(hostname -i 2>/dev/null) || fail 'Cannot determine the container IPv4 relay address'
printf '%s\n' "$relay_ip" | awk -F. 'NF!=4{exit 1}{for(i=1;i<=4;i++)if($i!~/^[0-9]+$/||$i>255)exit 1;if($1==0||$1==127||$1>=224)exit 1}' || fail 'Expected exactly one non-loopback container IPv4 address'
umask 077
cp /local/public-turnserver.conf /tmp/lastcall-turnserver.conf
printf '\nstatic-auth-secret=%s\nexternal-ip=%s/%s\nlistening-ip=%s\nrelay-ip=%s\n' "$TURN_SHARED_SECRET" "$TURN_EXTERNAL_IP" "$relay_ip" "$relay_ip" "$relay_ip" >> /tmp/lastcall-turnserver.conf
unset TURN_SHARED_SECRET cert_key private_key
if [ "${1:-}" = --check ]; then printf '%s\n' 'TURN inputs, TLS identity and rendered configuration validated; relay reachability is not tested'; exit 0; fi
exec turnserver -c /tmp/lastcall-turnserver.conf
