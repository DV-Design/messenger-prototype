import { describe, expect, it } from 'vitest';
import { ed25519 } from '@noble/curves/ed25519.js';
import { bytesToHex } from './crypto.js';
import { signUpdateManifest, verifyUpdateSignature, type UpdateSignatureFields } from './update-signature.js';

const privateKey = '11'.repeat(32);
const publicKey = bytesToHex(ed25519.getPublicKey(Buffer.from(privateKey, 'hex')));
const fields: UpdateSignatureFields = {
  version: '1.0.2',
  versionCode: 16,
  url: 'https://p2p.lienad.ru/download/LastCall-1.0.2.apk',
  alternateUrl: 'https://lienad.ru/messenger/download/LastCall-1.0.2.apk',
  sha256: 'a'.repeat(64),
  notes: 'Проверенный выпуск',
  publishedAt: '2026-11-02T15:00:00.000Z',
};
describe('signed update manifest',()=>{
  it('verifies the canonical fields and rejects any changed field',()=>{
    const signature=signUpdateManifest(privateKey,fields);
    expect(signature).toMatch(/^[0-9a-f]{128}$/);
    expect(verifyUpdateSignature(publicKey,fields,signature)).toBe(true);
    for(const changed of [{...fields,version:'1.0.3'},{...fields,versionCode:17},{...fields,url:'https://p2p.lienad.ru/download/evil.apk'},{...fields,sha256:'b'.repeat(64)},{...fields,notes:'tampered'},{...fields,publishedAt:'2026-11-03T00:00:00.000Z'}] as UpdateSignatureFields[]) expect(verifyUpdateSignature(publicKey,changed,signature)).toBe(false);
  });
  it('rejects malformed signatures, foreign keys and invalid input',()=>{
    const signature=signUpdateManifest(privateKey,fields);
    expect(verifyUpdateSignature(publicKey,fields,'00'.repeat(64))).toBe(false);
    expect(verifyUpdateSignature('22'.repeat(32),fields,signature)).toBe(false);
    expect(verifyUpdateSignature(publicKey,fields,'not-hex')).toBe(false);
  });
});
