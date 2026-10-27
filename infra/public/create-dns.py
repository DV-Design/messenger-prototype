#!/usr/bin/env python3
"""Create the one authorized DNS record; never import the DDNS notification helper."""
import argparse
import json
import os
import plistlib
from pathlib import Path
import shlex
import urllib.error
import urllib.request

parser = argparse.ArgumentParser()
parser.add_argument('--env-file', type=Path)
parser.add_argument('--env-plist', type=Path, help='Optional existing LaunchAgent environment; read only CF_TOKEN/CF_ZONE')
args = parser.parse_args()
values = {key: os.environ.get(key, '') for key in ('CF_TOKEN', 'CF_ZONE')}
if args.env_file:
    for line in args.env_file.read_text().splitlines():
        line = line.strip()
        if line.startswith('export '):
            line = line[7:]
        key, sep, value = line.partition('=')
        if sep and key.strip() in values and not values[key.strip()]:
            parts = shlex.split(value, comments=True)
            values[key.strip()] = parts[0] if parts else ''
if args.env_plist:
    environment = plistlib.loads(args.env_plist.read_bytes()).get('EnvironmentVariables', {})
    for key in values:
        if not values[key]:
            values[key] = environment.get(key, '')
if not all(values.values()):
    raise SystemExit('CF_TOKEN and CF_ZONE must be available; credentials are never printed')
base = 'https://api.cloudflare.com/client/v4/zones/' + values['CF_ZONE'] + '/dns_records'

def request(method, suffix='', payload=None):
    req = urllib.request.Request(base + suffix, data=json.dumps(payload).encode() if payload else None,
        headers={'Authorization': 'Bearer ' + values['CF_TOKEN'], 'Content-Type': 'application/json'}, method=method)
    try:
        with urllib.request.urlopen(req, timeout=20) as response:
            body = json.load(response)
    except urllib.error.HTTPError as error:
        raise SystemExit(f'Cloudflare API request failed: HTTP {error.code}') from None
    if not body.get('success'):
        raise SystemExit('Cloudflare API rejected request; inspect account permissions privately')
    return body['result']

name = 'p2p.lienad.ru'
records = request('GET', '?name=' + name)
expected = {'type':'CNAME', 'name':name, 'content':'lienad.ru', 'ttl':300, 'proxied':False}
if records:
    if len(records) != 1 or any(records[0].get(key) != value for key, value in expected.items()):
        raise SystemExit('A differing DNS record already exists; left unchanged')
    print('DNS already matches: CNAME p2p.lienad.ru -> lienad.ru, DNS only, TTL 300')
else:
    request('POST', payload=expected)
    print('DNS created: CNAME p2p.lienad.ru -> lienad.ru, DNS only, TTL 300')
