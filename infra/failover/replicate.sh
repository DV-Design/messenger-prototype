#!/bin/bash
# Every 10 minutes (launchd): a consistent copy of the Italian server's database comes to the Mac,
# for the standby to start from. Skipped while the Mac itself is the primary.
set -euo pipefail
STATE="${LASTCALL_FAILOVER_STATE:-$HOME/server/lastcall-failover}"
REPLICAS="$STATE/replicas"; mkdir -p "$REPLICAS"; chmod 700 "$STATE" "$REPLICAS"
[ "$(cat "$STATE/mode" 2>/dev/null || echo standby)" = standby ] || exit 0
stamp=$(date +%Y%m%d-%H%M)
part="$REPLICAS/directory-$stamp.sqlite.part"
umask 077
ssh -o BatchMode=yes -o ConnectTimeout=15 independence \
  'sudo -n install -d -m 0700 /var/lib/lastcall-backup && sudo -n sqlite3 /var/lib/docker/volumes/lastcall_data/_data/directory.sqlite ".backup /var/lib/lastcall-backup/copy.sqlite" && sudo -n cat /var/lib/lastcall-backup/copy.sqlite && sudo -n rm -f /var/lib/lastcall-backup/copy.sqlite' > "$part"
[ "$(sqlite3 "file:$part?immutable=1" 'PRAGMA quick_check;')" = ok ] || { rm -f "$part"; echo "$(date) replica failed integrity check" >&2; exit 1; }
mv "$part" "${part%.part}"
ln -sf "$(basename "${part%.part}")" "$REPLICAS/latest.sqlite"
# A day of copies.
ls -1t "$REPLICAS"/directory-*.sqlite 2>/dev/null | tail -n +145 | xargs -r rm -f
echo "$(date) replica $(basename "${part%.part}") $(stat -f%z "${part%.part}") bytes"
