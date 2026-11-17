# LastCall: market registration and invitations

This document describes the server-side registration policy for LastCall. It is a
repository description, not evidence of a release or a live deployment.

The existing login, profile resolution, email binding and account recovery paths are
unchanged. Registration policy applies only when a **new** directory profile is created.

## Modes

`REGISTRATION_MODE` selects the internal policy. Unset defaults to `open`.

| Value | New registrations |
|---|---|
| `open` | Allowed without an invitation. |
| `invite` | Require a valid invitation code. |
| `market` | Per-request country policy described below. |
| `closed` | Refused with `registration-closed`. |

The public Compose file defaults the public deployment to `market`. Other environments
should set the mode explicitly if they do not want the legacy `open` default.

## Market policy

In `market` mode the server decides for each registration request:

1. Determine the client country from the **existing trusted proxy mechanism**:
   `X-Forwarded-For` is honored only when the direct peer is inside
   `TRUSTED_PROXY_CIDRS`, and the chain is read from the right so a client-supplied
   prefix cannot choose its own country. Caddy appends the address it observed.
2. Look the address up in the bundled DB-IP Lite country database. The lookup is
   local: no address is sent to an external service, and the adapter persists neither
   the address nor the country.
3. Use the connection's country (`country.iso_code`, with the DB-IP root
   `country_code` fallback). `registered_country` is deliberately ignored.
4. A missing, unknown, private, reserved, malformed or unparseable address is
   **restricted**, never open.
5. A known country outside `REGISTRATION_RESTRICTED_COUNTRIES` is open.
6. A known country inside the list requires an invitation.

Initial restricted list: `RU,CN,VN,KZ,TM,ID,TR,AE`.

This is a reviewed market screen, not a legal clearance. Country availability and
obligations can change, and IP geolocation can be wrong (VPN, proxy, corporate egress,
mobile roaming). The result is not citizenship, residency, identity or a legal
guarantee. The client's self-reported country is never used. Do not market a country
as fully supported solely because this policy returns `open`.

`IN`, `UZ` and `UK` are intentionally **not** in the blanket list. Their obligations
are different or conditional rather than a simple market restriction; handle them as a
separate review instead of copying this list.

A new client can read the effective decision from `GET /registration-policy`, which
returns `{ "mode": "open" | "invite" | "closed" }`. It returns only the effective mode,
not the address or country. The endpoint is exposed on the same signaling routes as
`/signal`, `/directory`, `/ice` and `/health`. An older server that predates this work
returns `404` for that path; clients must treat `404` as a legacy server rather than as
permission, and rely on the registration refusal from the server.

## Countries reported by the phone (since server 2026-11-17 and app 1.0.33)

The production server sees only a Docker gateway address, so the connection's country is
unknown. The Android app therefore reports up to two countries at sign-up:

- the **Google Play account country** (Play Billing `BillingConfig.countryCode`; no purchase is
  made, but the library adds the `com.android.vending.BILLING` permission to the manifest);
- the **mobile network** the phone is on now (`TelephonyManager.getNetworkCountryIso`); the
  **SIM** country (`getSimCountryIso`) is used only when there is no network, because a SIM
  says where a number comes from, not where the person is.

The server announces support with `"countryHints": true` in `/registration-policy`, and the app
sends the countries only to such a server: in the `x-lastcall-country-hints` header of that
request and in the `authenticate` / `email-start` frames of a registration. They are never put
in a URL, logged or stored. In `market` mode the decision is:

| Known countries (address + reported) | Result |
|---|---|
| none | invitation required |
| any restricted country among them | invitation required |
| at least one, none restricted | open |

Malformed reported values are ignored. A modified client can leave countries out (then it needs
an invitation) or lie about them; this check is meant to stop ordinary sign-ups from restricted
markets, including those behind a VPN, not a determined attacker. Old apps send nothing and
keep needing an invitation. iOS sends nothing yet.

## Invitations

- An invitation issuer may generate **5 codes per calendar UTC day**, including codes
  that are later revoked or expire. The count resets at UTC midnight; revoking a code
  frees it from the active list but does not restore the day's quota.
- A code expires at UTC midnight seven calendar dates after issuance, so it
  remains valid for up to seven days.
- Only a SHA-256 digest is stored. The code itself is returned once to the issuer and
  must not appear in server configuration, build artifacts, URLs, logs, analytics,
  screenshots or support tickets. The client collects it as an input at signup.
- Registration consumes a valid code once. Missing, expired, already-used or revoked
  codes are refused; `invite` mode without a code is refused with `invite-required`.
- Revoking an issuer removes that issuer's grants and outstanding codes, but does not
  reset the current day's generation count.

## Administrators and grants

`REGISTRATION_ADMIN_USER_IDS` is an optional comma-separated list of **stable
directory user IDs** (the 64-hex `userId`, derived from the device public key). It is
never a username, display name or public key, and it is configured only through the
server environment. An administrator appointment cannot be made or transferred from
the app UI.

An administrator may grant or revoke invitation-issuer rights for an existing account
**by `@username`** in the UI. Only an administrator can grant. The grant is stored
against that account's stable `userId`.

On the phone, open **Settings → Account → Invitations**. Enter an existing
`@username` and grant permission. An issuer can copy a code at creation and see
or revoke active codes. On the registration screen the recipient can paste the
code when the server requires one.

Recovery installs the account on a new device key and therefore a new `userId`. A grant
does not follow the username: an administrator must grant the restored account again
by `@username` after recovery.

## Deployment

Public Compose reads these optional values (defaults shown); the placeholders contain
no credentials:

```sh
REGISTRATION_MODE=market
REGISTRATION_RESTRICTED_COUNTRIES=RU,CN,VN,KZ,TM,ID,TR,AE
REGISTRATION_ADMIN_USER_IDS=
REGISTRATION_GEOIP_DB=/app/dbip-country.mmdb
```

`REGISTRATION_ADMIN_USER_IDS` is a comma-separated list such as
`0123...64hex,4567...64hex`, with no spaces required. Keep it out of public
documentation that identifies real people; it is deployment configuration, not a
secret, but it is still operator data.

Market mode initializes the country lookup at startup. If the database cannot be
read, startup fails instead of silently serving an invitation-only policy. A runtime
lookup failure is treated as unknown and therefore invite-only.

The Docker image stores the verified snapshot at `/app/dbip-country.mmdb`. When
running the server directly outside Docker, set `REGISTRATION_GEOIP_DB` to the path
of a local, decompressed country MMDB. Choose `open`, `invite` or `closed` for
environments that do not need a country database.

The Caddy fragments for both public hostnames (`p2p.lienad.ru` and the apex
`/messenger` route) forward `/registration-policy` through the existing signaling
matchers. This adds no hostname, listener or origin. Validate and gracefully reload
Caddy from the deployment host; do not restart shared services.

Deploy the server before relying on the new client. There is no release or deployment
claim in this document.

## Client and upgrade behavior

- Existing accounts can still log in and recover. Their sessions and identities are
  not gated by registration mode.
- An old APK can still log in, but it does not implement invitation entry or policy
  display. Signing up in a restricted market therefore requires the new client. Do not
  claim that old clients can register inside a restricted market.
- Before this endpoint exists on a server, `/registration-policy` returns `404`.
  The new client should continue with the normal signup attempt and present the
  server's registration error if the market requires an invitation.
- Never place an invitation code in a URL, deep link, query string, crash report or
  analytics event.

## Country data attribution

**[IP Geolocation by DB-IP](https://db-ip.com/)**, licensed under
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). The server image is built
from the official [DB-IP Country Lite snapshot for November 2026](https://download.db-ip.com/free/dbip-country-lite-2026-11.mmdb.gz).
`infra/Dockerfile.server` pins its SHA-256 and verifies the compressed file before
extraction. Update the snapshot URL and checksum together when refreshing the data.
Retain the attribution on the deployed image and link to DB-IP on pages that use
the data or display its results.

The `maxmind` npm package is used only as a local MMDB reader. No MaxMind GeoIP database
is bundled, and no remote geolocation API is called.

## Review 2026-11-17

What holds: the gate applies only when a new profile is inserted, and the code is consumed
inside the same transaction; codes are 256-bit and stored as SHA-256; revoking an issuer kills
their codes; administrators come only from the server environment; an unknown country means
invite-only; the client never reports its own country.

Problems found, in order of impact:

1. **The production server cannot see client addresses.** The SNI router (`nginx`, stream
   mode, `proxy_protocol off`) and Docker's port publishing on macOS put a Docker gateway
   address (`172.18.0.x`) on every connection: the last 400 connections in the router's log
   all came from it. Caddy therefore forwards that private address, the country is unknown
   for everyone, and `market` mode behaves as `invite` for **all** countries. Every IP rate
   limit is also one shared bucket. Fixing it needs the client address preserved end to end
   (e.g. `proxy_protocol on` from the router to Caddy plus Caddy's `proxy_protocol` listener
   wrapper, and a Docker networking mode that keeps the source address), which touches the
   same router as the VPN endpoint, so it is an operator change, not made here.
2. **VPN users look foreign.** Once addresses work, anyone in a restricted market with a VPN
   (common in Russia) gets open registration. Adding restrict-only device signals (SIM and
   network country, device region) that can only turn `open` into `invite`, never the
   reverse, would cover ordinary users; a modified client can still lie.
3. **Store distribution.** The policy limits sign-ups, but if Google Play offers the app in
   the restricted countries, the offering itself is unchanged. Excluding those countries in
   Play Console is the stronger control; it is a business decision.
4. **Privacy policy** did not mention the country check or DB-IP; a paragraph is now in
   `infra/public/privacy.html` (not yet published).
5. **Usability:** a 64-character code is hard to pass on. The app now has "Share invitation"
   (message text, no link) and accepts the whole pasted message, taking the single 64-hex run.
6. The DB-IP snapshot is pinned to November 2026 and goes stale; refresh it monthly.
