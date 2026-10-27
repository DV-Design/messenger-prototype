#!/bin/sh
set -eu
# Never enable shell tracing: the shared secret must not appear in logs/argv.
case "${TURN_SHARED_SECRET:-}" in
  ''|*[!A-Za-z0-9]*) echo 'TURN_SHARED_SECRET must be a random alphanumeric value (at least 32 characters)' >&2; exit 1 ;;
esac
if [ "${#TURN_SHARED_SECRET}" -lt 32 ]; then echo 'TURN_SHARED_SECRET is too short' >&2; exit 1; fi
case "${TURN_EXTERNAL_IP:-127.0.0.1}" in
  *[!0-9a-fA-F.:]*) echo 'TURN_EXTERNAL_IP must be an IP address' >&2; exit 1 ;;
esac
umask 077
cp /local/turnserver.conf /tmp/turnserver.conf
printf '\nstatic-auth-secret=%s\nexternal-ip=%s\n' "$TURN_SHARED_SECRET" "${TURN_EXTERNAL_IP:-127.0.0.1}" >> /tmp/turnserver.conf
# Explicit laboratory opt-in only; never enable for a publicly reachable TURN instance.
if [ "${TURN_ALLOW_LOOPBACK:-false}" = true ]; then
  exec turnserver -c /tmp/turnserver.conf --allow-loopback-peers
fi
exec turnserver -c /tmp/turnserver.conf
