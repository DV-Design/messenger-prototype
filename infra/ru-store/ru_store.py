#!/usr/bin/env python3
"""LastCall ru-store: personal data of users with a Russian number, on the Russian server.

The Italian server writes here first (registration, recovery, number linking) and sends a full
reconciliation every 10 minutes. Listens on 127.0.0.1 only; Italy reaches it through a restricted
SSH tunnel. Every request but /health carries the bearer token from /etc/lastcall-ru/token.
Standard library only (python3 + sqlite3).
"""
import hmac
import json
import os
import re
import sqlite3
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

DB = os.environ.get('RU_STORE_DB', '/var/lib/lastcall-ru/ru.sqlite')
TOKEN = Path(os.environ.get('RU_STORE_TOKEN_FILE', '/etc/lastcall-ru/token')).read_text().strip()
BACKUPS = Path(os.environ.get('RU_STORE_BACKUPS', '/var/lib/lastcall-ru/backups'))
HEX64 = re.compile(r'^[0-9a-f]{64}$')
E164 = re.compile(r'^\+7[0-9]{10}$')
MAX_BODY = 64 * 1024
if len(TOKEN) < 32:
    raise SystemExit('token must contain at least 32 characters')


def connect():
    db = sqlite3.connect(DB, timeout=5)
    db.execute('PRAGMA journal_mode=WAL')
    db.execute('''CREATE TABLE IF NOT EXISTS ru_users (
        user_id TEXT PRIMARY KEY, public_key TEXT NOT NULL, username TEXT NOT NULL, display_name TEXT NOT NULL,
        phone TEXT, phone_hash TEXT, email_hash TEXT, push_token TEXT, watching TEXT NOT NULL DEFAULT '[]',
        last_seen INTEGER NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL) STRICT''')
    return db


def valid_user(record, user_id):
    def text(key, limit, required=True):
        value = record.get(key)
        if value is None and not required:
            return None
        if not isinstance(value, str) or not value or len(value) > limit:
            raise ValueError(key)
        return value
    if record.get('userId') != user_id:
        raise ValueError('userId')
    for key in ('publicKey',):
        if not HEX64.match(text(key, 64)):
            raise ValueError(key)
    text('username', 24); text('displayName', 48)
    phone = text('phone', 16, False)
    if phone is not None and not E164.match(phone):
        raise ValueError('phone')
    for key in ('phoneHash', 'emailHash'):
        value = text(key, 64, False)
        if value is not None and not HEX64.match(value):
            raise ValueError(key)
    text('pushToken', 4096, False)
    watching = record.get('watching', [])
    if not isinstance(watching, list) or len(watching) > 200 or not all(isinstance(item, str) and HEX64.match(item) for item in watching):
        raise ValueError('watching')
    if not isinstance(record.get('lastSeen'), (int, float)):
        raise ValueError('lastSeen')
    return phone, watching


class Handler(BaseHTTPRequestHandler):
    server_version = 'ru-store'
    sys_version = ''

    def log_message(self, *args):  # No request lines in the journal: they carry user ids.
        pass

    def reply(self, status, body=b'', content_type='application/json'):
        self.send_response(status)
        self.send_header('Content-Type', content_type)
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        if body:
            self.wfile.write(body)

    def authorized(self):
        header = self.headers.get('Authorization', '')
        return header.startswith('Bearer ') and hmac.compare_digest(header[7:].encode(), TOKEN.encode())

    def body(self):
        length = int(self.headers.get('Content-Length', '0'))
        if length <= 0 or length > MAX_BODY:
            raise ValueError('body')
        return json.loads(self.rfile.read(length))

    def do_GET(self):
        if self.path == '/health':
            return self.reply(200, b'{"status":"ok"}')
        if not self.authorized():
            return self.reply(401)
        if self.path == '/backup/latest':
            files = sorted(BACKUPS.glob('ru-*.sqlite.age'))
            if not files:
                return self.reply(404)
            return self.reply(200, files[-1].read_bytes(), 'application/octet-stream')
        self.reply(404)

    def do_PUT(self):
        if not self.authorized():
            return self.reply(401)
        match = re.fullmatch(r'/users/([0-9a-f]{64})', self.path)
        if not match:
            return self.reply(404)
        try:
            record = self.body()
            phone, watching = valid_user(record, match.group(1))
        except (ValueError, json.JSONDecodeError):
            return self.reply(400)
        now = int(time.time() * 1000)
        with connect() as db:
            # A reconciliation from Italy has no number (Italy never holds it): keep the stored one.
            db.execute('''INSERT INTO ru_users(user_id,public_key,username,display_name,phone,phone_hash,email_hash,push_token,watching,last_seen,created_at,updated_at)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
                ON CONFLICT(user_id) DO UPDATE SET public_key=excluded.public_key, username=excluded.username, display_name=excluded.display_name,
                  phone=COALESCE(excluded.phone, ru_users.phone), phone_hash=COALESCE(excluded.phone_hash, ru_users.phone_hash),
                  email_hash=excluded.email_hash, push_token=excluded.push_token, watching=excluded.watching, last_seen=excluded.last_seen, updated_at=excluded.updated_at''',
                (record['userId'], record['publicKey'], record['username'], record['displayName'], phone, record.get('phoneHash'), record.get('emailHash'),
                 record.get('pushToken'), json.dumps(watching), int(record['lastSeen']), now, now))
        self.reply(204)

    def do_DELETE(self):
        if not self.authorized():
            return self.reply(401)
        match = re.fullmatch(r'/users/([0-9a-f]{64})', self.path)
        if not match:
            return self.reply(404)
        with connect() as db:
            db.execute('DELETE FROM ru_users WHERE user_id = ?', (match.group(1),))
        self.reply(204)

    def do_POST(self):
        if not self.authorized():
            return self.reply(401)
        if self.path != '/index':
            return self.reply(404)
        try:
            ids = self.body().get('userIds')
            if not isinstance(ids, list) or len(ids) > 100_000 or not all(isinstance(item, str) and HEX64.match(item) for item in ids):
                raise ValueError('userIds')
        except (ValueError, json.JSONDecodeError, AttributeError):
            return self.reply(400)
        # Users Italy no longer has (deleted, moved) leave the Russian store too.
        with connect() as db:
            known = {row[0] for row in db.execute('SELECT user_id FROM ru_users')}
            gone = known - set(ids)
            db.executemany('DELETE FROM ru_users WHERE user_id = ?', [(item,) for item in gone])
        self.reply(200, json.dumps({'removed': len(gone)}).encode())


if __name__ == '__main__':
    Path(DB).parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    connect().close()
    ThreadingHTTPServer(('127.0.0.1', int(os.environ.get('RU_STORE_PORT', '8790'))), Handler).serve_forever()
