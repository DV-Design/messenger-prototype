# Next milestone: verified phones, wake notifications and relay readiness

User clarification: original delivery complaint occurs when recipient closes or
backgrounds app. They explicitly require automatic phonebook matching and allow
P2P-first encrypted relay fallback. Code3/0.2.1 is an interim diagnostic/contact
permissions checkpoint, NOT a fix for closed-app delivery or automatic phone lookup.

External configuration currently absent: Firebase Android client configuration,
FCM server service account, SMS provider account/key, iOS signing/APNs. User was
asked about new/existing Firebase project and SMS.ru/default provider. Do all
independent implementation/config/tests; do not fake verification or push success.

## Ownership

- Main: shared contract, npm installation/lock, infrastructure/service config,
  independent integration, release/checkpoint/publication, account setup when possible.
- Core: protocol additions and MessengerClient service APIs, phone normalization/hash,
  bounded service request correlation, pending-wake intent integration.
- Server: apps/server service adapters, directory persistence/auth handlers, tests.
- Mobile: apps/mobile notification/phone verification/discovery UI and config/tests.

Current0.2.1 sources must remain frozen until main confirms checkpoint committed.
Prepare research first. Existing old clients remain compatible: do NOT add extra
properties to ready or spontaneously send new frames to0.2 clients.

## Frozen service types and frames

Core exported types:
ServiceCapabilities={phoneVerification:boolean,push:boolean,relay:boolean,phoneVerified:boolean}
PhoneChallenge={challengeId:string32hex,expiresAt:number,retryAt:number}
PhoneMatch={hash:string64hex,user:DirectoryUser}

New authenticated directory client frames (strict bounded):
- {type:'services',requestId:32hex}
- {type:'ice',requestId:32hex}
- {type:'phone-start',phone:E164string,requestId:32hex}
- {type:'phone-verify',challengeId:32hex,code:6digits,requestId:32hex}
- {type:'phone-discover',hashes:64hex[] max100,requestId:32hex}
- {type:'push-register',token:string1..4096,requestId:32hex} (FCM only this milestone)
- {type:'wake',to:userId64hex} (intent only, no content accepted)

New server frames:
- {type:'services',requestId,capabilities:ServiceCapabilities}
- {type:'ice',requestId,iceServers:RTCIceServer[] max20}
- {type:'phone-challenge',requestId,challenge:PhoneChallenge}
- {type:'phone-verified',requestId}
- {type:'phone-matches',requestId,matches:PhoneMatch[] max100}
- {type:'push-registered',requestId}
- existing {type:'error',code,message,requestId?}; no phone/token/code values in errors.

Core methods (public freeze): getServices():Promise<ServiceCapabilities>,
startPhoneVerification(phone:string):Promise<PhoneChallenge>,
verifyPhone(challengeId:string,code:string):Promise<void>,
discoverPhones(hashes:string[]):Promise<PhoneMatch[]>,
registerPushToken(token:string):Promise<void>, getIceServers():Promise<RTCIceServer[]>.
Directory getServices phoneVerified is ownidentity verification state; no numberecho.
Manager supplies async getIceServers provider to PeerSession; legacy standalone
PeerSession keeps /ice GET fallback. Add optional getIceServers option to
PeerSessionOptions; no RTC duplication when concurrent pair opens await config.
Server REQUIRE_ICE_AUTH=1 inpublicdeploy means GET/ice STUNonly; TURNcredentials
only through authenticated directory ice request with user-scoped quota. Legacy
laboratory default remainscompatible and cannotbe used as publicquota shortcut.
Core helpers normalizePhone(input:string,defaultCountry?:'RU'):string (E164 via
maintained libphonenumber-js), phoneLookupHash(e164:string):string = SHA256 UTF8
JSON.stringify(['lastcall/phone-lookup/v1', e164]). Reject malformed inputs.
No auto number/name ownership inferred from address-book records.

Pending text should send a bounded wake intent while waiting for recipient ACK
(including directory-online but OS-suspended case). Throttle e.g.once/30s perpeer;
never place chat text/file/callSDP in notification payload. A notification invites
user to reopen, then ordinary authenticated P2P delivers sender-local pending text.
Both devices still need availability for P2P. No server content mailbox implied.

## Server behavior

Capabilities reflect actual configured adapters, never env-label-only success.
Inject SMSProvider.sendCode(phone,code):Promise<void> and
PushProvider.sendWake(token):Promise<void> for tests. Real adapters: SMS.ru POST
API over TLS; FCM via maintained firebase-admin SDK/service account. Research
primary docs before implementation and never print bodies/secrets/OTP/token.
Disabled service requests return service-unavailable. No public mock/test mode.

OTP: cryptographically random6digits, bound to authenticated user/challenge/phone;
store keyed digest in memory, TTL5min, max5attempts, resend>=60s. Bounded
peridentity/perphone/global send quotas survive socket reconnect; optionalstrict
maxSMS/hour. Returnchallenge only after provider accepted; do not store OTP in DB.
An already bound phone cannot move to anotheridentity silently; legitimate recovery
needs a separate device/key migration design. Phone discovery requires the querying
identity to have completed verification. Batch bounds+peridentity quota; only
matched users returned, no full directory phone list or raw phone in public profile.

SQLite new tables store own verified phoneLookupHash and verification time,
FCM token metadata, push allow-list from authenticated watch sets. Never raw OTP,
raw phonebook, names/phone inputs, chat payloads. Token must not be exposed to
other users. For wake, target must have explicitly watched sender before; persist
that consent for offline delivery. Rate-limit wake intents and suppressduplicates.
No automatic notification to every searchable profile/stranger. Push body generic:
'LastCall'/'Есть новое сообщение. Откройте LastCall.' Provider success is not a
receipt ACK and does not mark text delivered.

Service configuration: SMSRU_API_ID, PHONE_VERIFICATION_SECRET(random>=32bytes), REQUIRE_ICE_AUTH=1,
GOOGLE_APPLICATION_CREDENTIALS=/run/secrets/firebase-admin.json. Keepactualfiles
ignored/readonlymounted; repo examples placeholders only. Singleprocesspreview.
Push adapters use minimal timeouts andbounded concurrency, errorsgeneric.

## Mobile behavior

ExpoSDK58 Notifications getDevicePushTokenAsync on Android only if nativeFirebase
configuration exists. Google clientjson externalpath via env
MESSENGER_GOOGLE_SERVICES_FILE; config plugin conditional. No private admin key in
APK. No signediOSnotification claim before APNs/buildsigning are available.
Add notifications as permission type, Android channel before permission request.
Register token after directoryauthentication; handle rotation/resume. Notification
response opens app, reconnects and lets P2P/outbox deliver; do not advertise always
reliable data-only wake. Display service unavailable/unconfigured honestly.

Phone settings: E164number→sendSMS→6digitcode verification. After confirmed, explicit
'Автопоиск контактов' consent loads localphone numbers, normalizes/hashes clientside,
sends batches<=100, matches byexacthash, links foundpublicidentities locally.
No names/nativecontactIDs/rawphonebook upload; hashes are enumerable personaldata,
not an anonymity claim. Preserve local-only/manualcontact mode.
Diagnostic copy must strip knowncontactnames/usernames as well asIDs/messages/phones.

## Tests

OTPchallenge binding/expiry/reuse/attempt/resend/quota/providerfailure; lookup requires
ownverification and cannotspoof identity; hashbatch rejection; pushregistrationisolation,
o wake without recipientwatchconsent, wake duplicate/quotabounds, no contentframes.
Core request dispatch/error correlation/cancelcleanup, hashnormalization, bounded
wake retries with no false delivered. Mobile pure flow tests + existing gates.
Use injected testproviders privately; public deployment never returns/accepts fixed
OTP or claimsproviderconfigured when missing credentials. Real delivery needs the
external accounts and a physicalphone check. Relay must be separately provisioned
and forced-relay tested; do not silently enable old unauthenticated /ice publicquota.
