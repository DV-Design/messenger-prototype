#!/usr/bin/env node
// Signs infra/public/latest.json with the offline update key.
// Configure LASTCALL_UPDATE_KEY as a path to a 32-byte hex key, or keep it at
// ~/.config/lastcall/update-signing.key (0600). Never commit the private key.
import { ed25519 } from '@noble/curves/ed25519.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const manifestPath = path.resolve(process.argv[2] ?? 'infra/public/latest.json');
const keyPath = process.env.LASTCALL_UPDATE_KEY ?? path.join(os.homedir(), '.config/lastcall/update-signing.key');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const android = manifest.android;
if (!android || typeof android.version !== 'string' || !Number.isInteger(android.versionCode)
  || typeof android.url !== 'string' || typeof android.sha256 !== 'string'
  || !/^[0-9a-f]{64}$/.test(android.sha256)) throw new Error('latest.json is incomplete.');
const privateKey = Buffer.from(fs.readFileSync(keyPath, 'utf8').trim(), 'hex');
if (privateKey.length !== 32) throw new Error('Update signing key must be 32 bytes of hex.');
const payload = Buffer.from(JSON.stringify([
  'lastcall/update-manifest/v1',
  android.version,
  android.versionCode,
  android.url,
  android.alternateUrl ?? '',
  android.sha256,
  android.notes ?? '',
  manifest.publishedAt ?? '',
]));
const signature = Buffer.from(ed25519.sign(payload, privateKey)).toString('hex');
manifest.signature = signature;
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify({
  manifest: manifestPath,
  version: android.version,
  versionCode: android.versionCode,
  publicKey: Buffer.from(ed25519.getPublicKey(privateKey)).toString('hex'),
  signature,
}, null, 2));
