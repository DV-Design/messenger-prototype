---
name: lastcall-infosec
description: Security review and threat-model rules for LastCall — E2E content encryption, key verification, signaling/at-rest protections, push privacy, server auth/DoS, and update integrity.
---

# LastCall InfoSec

Treat the directory server, TURN and FCM as untrusted for content. The server may hold public profiles, push tokens, consents and opaque signaling, but never plaintext chat, files, media or private seeds.

## Crypto invariants

- Identity is an Ed25519 seed in SecureStore. User ID is SHA-256(public key); verify every authentication and content signature.
- Signaling uses the pairwise Ed25519→X25519/HKDF secret with XChaCha20-Poly1305. Do not log or persist it.
- Text, files, voice notes and circles use the session content layer: ephemeral X25519 per DataChannel, Ed25519-signed hello bound to both user IDs, HKDF, XChaCha20-Poly1305, authenticated sequence and replay rejection. Never add a plaintext fallback for a configured E2E session.
- Calls use WebRTC DTLS/SRTP; the identity/call safety code is the out-of-band verification path. Do not claim app-layer media encryption beyond SRTP.
- Local state and attachments are XChaCha20-Poly1305 encrypted at rest. Do not write decrypted attachments to predictable cache paths; clean `lastcall-*` cache files at launch.
- Push previews and call invites are pairwise-sealed and bounded. They are not delivery receipts or chat history.
- No Double Ratchet or post-compromise security yet. Do not describe the build as audited or Telegram-secret-chat equivalent.

## Verification workflow

1. Read the changed code and the relevant contract (`docs/ARCHITECTURE.md`, `docs/OUTBOX-CONTRACT.md`, `docs/WAKE-CONTRACT.md`).
2. Use the `security-scanner` agent for an independent read-only review; use `dependency-auditor` for lockfile/CVE checks.
3. Run `npm run check`, `npm run test:e2e`, and targeted crypto tests. Check nonce/sequence handling, domain separation, key zeroization, replay and downgrade paths.
4. For mobile, inspect Android backup/exported components/deep links, notification actions, file sharing and update verification. For server, inspect auth, rate limits, origin handling, SQL binding, TURN issuance and secret exposure.
5. Verify published update integrity: HTTPS allowlist, SHA-256 from `latest.json`, and Android signature before opening the installer.

## Known limits to report honestly

- First contact still relies on TOFU; the safety number must be compared out-of-band. The directory could substitute a key before verification.
- An unsolicited `connect` currently auto-adds a contact and enables watch/push consent; a message-request/block flow is still open.
- Full forward secrecy per message and a device-key ratchet are future work.
- Physical-phone, Russian-carrier, OEM battery and iOS/APNs acceptance remain pending.
