#!/bin/sh
# Fetch only LastCall's certificate, never mount/read the complete Caddy data tree.
set +x
set -eu
umask 077
fail() { printf '%s\n' "$1" >&2; exit 1; }
[ "$#" -eq 0 ] || fail 'Usage: TURN_TLS_DIR=/absolute/private/directory refresh-turn-cert.sh'
case "${TURN_TLS_DIR:-}" in /*) ;; *) fail 'TURN_TLS_DIR must be an existing absolute directory' ;; esac
[ -d "$TURN_TLS_DIR" ] && [ ! -L "$TURN_TLS_DIR" ] && [ -w "$TURN_TLS_DIR" ] || fail 'Certificate directory must exist, be writable and not be a symlink'
stage=$(mktemp -d "$TURN_TLS_DIR/.refresh.XXXXXX")
trap 'rm -rf "$stage"' EXIT HUP INT TERM
source_dir=/data/caddy/certificates/acme-v02.api.letsencrypt.org-directory/p2p.lienad.ru
docker exec caddy cat "$source_dir/p2p.lienad.ru.crt" > "$stage/fullchain.pem"
docker exec caddy cat "$source_dir/p2p.lienad.ru.key" > "$stage/privkey.pem"
openssl x509 -in "$stage/fullchain.pem" -noout -checkend 86400 -checkhost p2p.lienad.ru >/dev/null 2>&1 || fail 'Refusing invalid, near-expiry or wrong-host certificate'
openssl verify -verify_hostname p2p.lienad.ru -untrusted "$stage/fullchain.pem" "$stage/fullchain.pem" >/dev/null 2>&1 || fail 'Refusing untrusted certificate chain or hostname'
openssl pkey -passin pass: -in "$stage/privkey.pem" -check -noout >/dev/null 2>&1 || fail 'Refusing invalid or encrypted key'
cert_key=$(openssl x509 -in "$stage/fullchain.pem" -pubkey -noout | openssl pkey -pubin -outform DER | openssl dgst -sha256)
private_key=$(openssl pkey -passin pass: -in "$stage/privkey.pem" -pubout -outform DER | openssl dgst -sha256)
[ "$cert_key" = "$private_key" ] || fail 'Refusing certificate/key mismatch'
unset cert_key private_key
chmod 600 "$stage/fullchain.pem" "$stage/privkey.pem"
if cmp -s "$stage/fullchain.pem" "$TURN_TLS_DIR/fullchain.pem" && cmp -s "$stage/privkey.pem" "$TURN_TLS_DIR/privkey.pem"; then printf '%s\n' 'LastCall TURN certificate unchanged'; exit 0; fi
# Rename both files inside the existing mounted directory; a directory swap would
# leave a Docker bind mount pointing at the old inode. Coturn reads on restart.
[ ! -f "$TURN_TLS_DIR/fullchain.pem" ] || cp -p "$TURN_TLS_DIR/fullchain.pem" "$stage/previous-fullchain.pem"
[ ! -f "$TURN_TLS_DIR/privkey.pem" ] || cp -p "$TURN_TLS_DIR/privkey.pem" "$stage/previous-privkey.pem"
mv "$stage/fullchain.pem" "$TURN_TLS_DIR/fullchain.pem"
if ! mv "$stage/privkey.pem" "$TURN_TLS_DIR/privkey.pem"; then
  [ ! -f "$stage/previous-fullchain.pem" ] || mv "$stage/previous-fullchain.pem" "$TURN_TLS_DIR/fullchain.pem"
  fail 'Key replacement failed; previous certificate restored'
fi
if [ "$(docker inspect lastcall-coturn --format '{{.State.Running}}' 2>/dev/null || true)" = true ]; then
  docker restart lastcall-coturn >/dev/null || fail 'Certificates updated but TURN restart failed; inspect lastcall-coturn'
  printf '%s\n' 'LastCall TURN certificate updated; only lastcall-coturn restarted'
else printf '%s\n' 'LastCall TURN certificate updated; TURN is not running'; fi
