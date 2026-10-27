# Review:0.2.1 delivery diagnostics and native permissions

Scope: core pump/deadlines, new contact/permission APIs and UI, native upgrade.
Reviewed baselinef602794 history, changed/new source and independently ran root
checks. This interim release does not resolve the now-clarified closed-app case.

## Findings and verification

- Confirmed/fixed foreground outbox starvation when a new text arrives during an
  async flush and no optional RTC stats follow. Independent bounded pump repeats
  without changing recipient ACK semantics. Failing→passing regression.
- Confirmed/fixed indefinite SDP/peer-room wait. Directory-managed pairs now
  expect a peer and get stage deadlines/reconnect plus actionable error; legacy
  manual-invite waiting policy preserved. Real WS regression, no false delivery.
- App shows peer connectivity separately from directory presence. A server-online
  status cannot be mistaken for a successful P2P channel.
- Contacts use currentSDK58 Contact.getAllDetails; Android READ_CONTACTS only,
  WRITE_CONTACTS blocked. Local observer requires granted/limited read access.
  Names/phonebook remain local; explicit mapping stores only hash-key→publicID in
  SecureStore. No guessed phone ownership. Auto-discovery is not claimed.
- Sequential OS permission prompts, refusal/settings/limited-access paths; camera
  and microphone usage strings remain intact. Async selected-contact generation
  checks prevent completed requests updating another contact's card.
- Permission navigation waits for root navigation readiness. No forced unused
  location/SMS/call-log/all-files permissions or background reliability claim.

## Validation

Root lint, source/test typechecks,59tests(33core+20server+6mobile), Android/iOS JS
export and server build PASS. Browser6PASS/1explicitTURNskip. Native release build
PASS; finalAPK signature matches prior certificate, versionCode3, READ_CONTACTS,
CAMERA/RECORD_AUDIO present and WRITE_CONTACTS absent. Native upgrade/runtime
results are in [native report](../../debugging/2026-10/native-delivery.md).

## Remaining required work

User clarified: original missed delivery happens while receiver is closed or in
background. That requires push credentials/registration/wake flow (msg-3z9), not
just permissions or retry logic. Automatic phone discovery explicitly requested
(msg-p7x) needs real SMS verification; manual linking is only an interim fallback.
User now permits relay fallback (msg-bcw). [Service contract](../../../SERVICES-CONTRACT.md)
records implementation scope and missing external configuration.

Privacy follow-up: diagnostic error text strips IDs/phones/usernames, but generic
manager errors can prefix contact display names. Strip known names before claiming
fully anonymous output; next service update includes a regression. Manual copy
still excludes message content and device private keys.
