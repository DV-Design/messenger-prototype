#!/usr/bin/env python3
"""Every 30 minutes: a consistent SQLite copy of ru-store, encrypted with age to the owner's public
key (the private key exists only on the owner's Mac), kept for one day. Italy fetches the newest one."""
import os
import sqlite3
import subprocess
import tempfile
import time
from pathlib import Path

DB = os.environ.get('RU_STORE_DB', '/var/lib/lastcall-ru/ru.sqlite')
BACKUPS = Path(os.environ.get('RU_STORE_BACKUPS', '/var/lib/lastcall-ru/backups'))
RECIPIENT = Path(os.environ.get('RU_STORE_AGE_RECIPIENT', '/etc/lastcall-ru/backup.age.pub')).read_text().strip()
KEEP = 48

BACKUPS.mkdir(parents=True, exist_ok=True, mode=0o700)
stamp = time.strftime('%Y%m%d-%H%M', time.gmtime())
with tempfile.TemporaryDirectory(dir=BACKUPS) as work:
    plain = Path(work) / 'copy.sqlite'
    source = sqlite3.connect(DB, timeout=10)
    target = sqlite3.connect(plain)
    with target:
        source.backup(target)
    target.close(); source.close()
    if sqlite3.connect(plain).execute('PRAGMA quick_check').fetchone()[0] != 'ok':
        raise SystemExit('quick_check failed; no backup written')
    out = BACKUPS / f'ru-{stamp}.sqlite.age'
    subprocess.run(['age', '-r', RECIPIENT, '-o', str(out) + '.part', str(plain)], check=True)
    os.replace(str(out) + '.part', out)
for old in sorted(BACKUPS.glob('ru-*.sqlite.age'))[:-KEEP]:
    old.unlink()
print(f'backup ru-{stamp}.sqlite.age')
