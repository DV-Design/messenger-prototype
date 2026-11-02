import { ed25519 } from '@noble/curves/ed25519.js';
import { bytesToHex, hexToBytes } from './crypto.js';

const encoder = new TextEncoder();

export interface UpdateSignatureFields {
  version: string;
  versionCode: number;
  url: string;
  alternateUrl?: string;
  sha256: string;
  notes?: string;
  publishedAt?: string;
}

/** Stable, non-ambiguous payload shared by the release signer and the app. */
export function updateSignaturePayload(input: UpdateSignatureFields): Uint8Array {
  return encoder.encode(JSON.stringify([
    'lastcall/update-manifest/v1',
    input.version,
    input.versionCode,
    input.url,
    input.alternateUrl ?? '',
    input.sha256,
    input.notes ?? '',
    input.publishedAt ?? '',
  ]));
}

export function verifyUpdateSignature(publicKey: string, input: UpdateSignatureFields, signature: string): boolean {
  try {
    if (!/^[0-9a-f]{128}$/i.test(signature)) return false;
    return ed25519.verify(hexToBytes(signature.toLowerCase()), updateSignaturePayload(input), hexToBytes(publicKey), { zip215: false });
  } catch {
    return false;
  }
}

/** Release tooling only; never ship the private key in the app or repository. */
export function signUpdateManifest(privateKey: string, input: UpdateSignatureFields): string {
  return bytesToHex(ed25519.sign(updateSignaturePayload(input), hexToBytes(privateKey)));
}
