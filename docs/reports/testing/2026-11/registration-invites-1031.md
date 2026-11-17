# LastCall 1.0.31 registration and invitations

The independent tester completed two of six allocated cycles on 16 November 2026.
In both cycles it read the systematic debugging, quality gate and web testing skills.

| Cycle | Result | Evidence |
|---|---|---|
| 1 | Failed | The GeoIP configuration test invoked market mode without the required local database. 684 tests passed, one failed, and the browser suite did not run. |
| 2 | Passed | The test checks configuration defaults separately and explicitly verifies failure on a missing database. Lint, typecheck, 685 tests, and workspace builds passed. Browser checks passed 18 scenarios with one TURN scenario skipped because it lacked a relay fixture. |

Server tests cover untrusted forwarded headers, unknown country, legacy registration
rejection, email start and account creation, persistent daily quota, authorization,
revocation, concurrent redemption, rollback, and existing-account recovery. Recovery
does not carry invitation powers to a new device key.

The production Docker image verified the checksum of the official DB-IP snapshot.
A separate container smoke test used its bundled database and verified policy
responses for Russian, non-restricted, unknown, and IPv6 addresses with no caching.
Both public gateways returned HTTP 200 after deployment. The running container
matched the configured administrator ID to the existing directory account. The
production backend returned the expected decisions through the trusted proxy for
Russian, non-restricted and unknown sample addresses.

Physical-device UI and iOS were outside the independent tester allocation.
