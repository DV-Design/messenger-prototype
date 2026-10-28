#!/usr/bin/python3
"""Prepare a private LastCall TURN config and exec the unprivileged server."""
import argparse
import hashlib
import ipaddress
import os
from pathlib import Path
import re
import socket
import stat
import subprocess
import sys
import syslog
import tempfile

REPO = Path(__file__).resolve().parents[2]
BINARY = Path('/opt/homebrew/bin/turnserver')
OPENSSL = '/opt/homebrew/bin/openssl'
ALLOWED = {'TURN_SHARED_SECRET', 'TURN_EXTERNAL_IP', 'TURN_TLS_DIR', 'TURN_LISTEN_IP',
           'TURN_RUN_UID', 'TURN_RUN_GID', 'TURN_URLS', 'TURN_TTL_SECONDS'}


class ConfigError(ValueError):
    pass


def fail(message):
    raise ConfigError(message)


def private_file(path):
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_uid != os.geteuid() or info.st_mode & 0o077:
        fail('Private configuration/key files must be regular, owned by this user, mode 0600 or stricter')


def checked_path(value):
    path = Path(value)
    if not path.is_absolute() or any(c.isspace() or c in '\"\x00' for c in value):
        fail('Configuration paths must be absolute without whitespace, quotes or control characters')
    return path


def read_environment(path):
    private_file(path)
    result = {}
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith('#'):
            continue
        match = re.fullmatch(r'([A-Z][A-Z0-9_]*)=(.*)', line)
        if not match or match[1] not in ALLOWED or match[1] in result:
            fail('Environment file has an unsupported, duplicate or malformed key')
        value = match[2]
        if value[:1] in ('\"', "'"):
            if len(value) < 2 or value[-1] != value[0]:
                fail('Malformed quoted environment value')
            value = value[1:-1]
        if any(c in value for c in '\r\n\x00'):
            fail('Multiline environment values are unsupported')
        result[match[1]] = value
    return result


def openssl(*args, input_bytes=None):
    result = subprocess.run([OPENSSL, *args], input=input_bytes, stdout=subprocess.PIPE,
                            stderr=subprocess.PIPE, timeout=10, check=False)
    if result.returncode:
        fail('TLS validation failed; certificate must be trusted, match p2p.lienad.ru and its unencrypted key')
    return result.stdout


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--env-file', type=Path, default=REPO / 'infra/.env.public-turn')
    parser.add_argument('--check', action='store_true', help='validate/render only; never start listeners')
    args = parser.parse_args()
    if os.geteuid() == 0:
        fail('LastCall TURN must run as the unprivileged logged-in user')
    os.umask(0o077)
    values = read_environment(args.env_file)
    secret = values.get('TURN_SHARED_SECRET', '')
    if not re.fullmatch(r'[A-Za-z0-9]{32,128}', secret):
        fail('TURN_SHARED_SECRET must be random alphanumeric text, length 32-128')
    public = ipaddress.IPv4Address(values.get('TURN_EXTERNAL_IP', ''))
    listener = ipaddress.IPv4Address(values.get('TURN_LISTEN_IP', ''))
    if not public.is_global or public.is_multicast or public.is_reserved or str(public) != values['TURN_EXTERNAL_IP']:
        fail('TURN_EXTERNAL_IP must be one canonical public IPv4')
    if (listener.is_loopback or listener.is_unspecified or listener.is_multicast or
            listener.is_link_local or listener.is_reserved or str(listener) != values['TURN_LISTEN_IP']):
        fail('TURN_LISTEN_IP must be one canonical non-loopback IPv4 bound to this Mac')
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as check_address:
        check_address.bind((str(listener), 0))
    if int(values.get('TURN_RUN_UID', os.geteuid())) != os.geteuid() or int(values.get('TURN_RUN_GID', os.getegid())) != os.getegid():
        fail('Configured TURN UID/GID must match the current unprivileged user')
    tls = checked_path(values.get('TURN_TLS_DIR', ''))
    cert, key = tls / 'fullchain.pem', tls / 'privkey.pem'
    private_file(cert)
    private_file(key)
    openssl('x509', '-in', str(cert), '-noout', '-checkend', '86400')
    openssl('verify', '-verify_hostname', 'p2p.lienad.ru', '-untrusted', str(cert), str(cert))
    openssl('pkey', '-passin', 'pass:', '-in', str(key), '-check', '-noout')
    cert_public = openssl('x509', '-in', str(cert), '-pubkey', '-noout')
    cert_der = openssl('pkey', '-pubin', '-outform', 'DER', input_bytes=cert_public)
    key_der = openssl('pkey', '-passin', 'pass:', '-in', str(key), '-pubout', '-outform', 'DER')
    if hashlib.sha256(cert_der).digest() != hashlib.sha256(key_der).digest():
        fail('TURN certificate and key do not match')
    if not BINARY.is_file() or not os.access(BINARY, os.X_OK):
        fail('Install the maintained coturn package before launching LastCall TURN')
    runtime = checked_path(str(Path.home() / '.config/lastcall/native-runtime'))
    parent = runtime.parent.lstat()
    if not stat.S_ISDIR(parent.st_mode) or parent.st_uid != os.geteuid() or parent.st_mode & 0o077:
        fail('The LastCall private parent directory must belong to this user and have mode 0700')
    runtime.mkdir(mode=0o700, exist_ok=True)
    info = runtime.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.geteuid() or info.st_mode & 0o077:
        fail('Native runtime directory must belong to this user and have mode 0700')
    # Reuse reviewed quotas/peer denials; override only OS-specific paths and logs.
    replacements = {'cert': str(cert), 'pkey': str(key), 'pidfile': str(runtime / 'turnserver.pid'),
                    'log-file': 'syslog'}
    rendered = []
    for line in (REPO / 'infra/coturn/public-turnserver.conf').read_text().splitlines():
        name = line.split('=', 1)[0]
        rendered.append(name + '=' + replacements[name] if name in replacements else line)
    rendered.extend(['', '# Native LastCall address mapping; generated privately.',
                     'static-auth-secret=' + secret, 'listening-ip=' + str(listener),
                     'relay-ip=' + str(listener), 'external-ip=' + str(public) + '/' + str(listener)])
    content = '\n'.join(rendered) + '\n'
    config = runtime / 'turnserver.conf'
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode='w', dir=runtime, prefix='.config-', delete=False) as stream:
            temporary = stream.name
            os.fchmod(stream.fileno(), 0o600)
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, config)
        temporary = None
    finally:
        if temporary:
            os.unlink(temporary)
    if args.check:
        print('Native TURN inputs/TLS/private config validated; no listeners started or relay delivery tested')
        return
    # Clear inherited provider/shared-secret variables; credentials exist only in
    # the private config, never process arguments, startup messages or child env.
    clean_env = {'PATH': '/opt/homebrew/bin:/usr/bin:/bin', 'HOME': str(Path.home()), 'LANG': 'C'}
    os.execve(str(BINARY), [str(BINARY), '-c', str(config)], clean_env)


if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError, subprocess.SubprocessError) as error:
        detail = str(error) if isinstance(error, ConfigError) else 'invalid address, file permissions, dependency or TLS'
        message = 'LastCall TURN startup refused: ' + detail
        syslog.openlog('LastCallTURN')
        syslog.syslog(syslog.LOG_ERR, message)
        print(message, file=sys.stderr)
        sys.exit(1)
