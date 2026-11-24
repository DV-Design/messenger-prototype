# 1.0.43 / code58 — share to LastCall on real phones, drafts (2026-11-24)

- [X] Owner's report: "Share → LastCall" opened the app without letting them send the file. Cause: the share was
  read before navigation existed (cold start on a slower phone) and the push to the picker failed silently, so the
  app stayed on the chat list. The bridge now keeps the share pending and opens the picker once navigation is
  ready; the native module also announces a share on activity resume, and JS asks again after 0.6 s and 2 s
  → Artifacts: [ShareIntentBridge.tsx](apps/mobile/src/components/ShareIntentBridge.tsx), [LastCallShareModule.java](apps/mobile/plugins/share/LastCallShareModule.java)
- [X] Drafts as in Telegram: text typed and not sent stays in the chat (saved with the encrypted history, survives
  a restart; during an edit the set-aside text is kept); the chat list shows "Draft: …" in red; "Draft:" in 29 languages
  → Artifacts: [messenger.ts](packages/core/src/messenger.ts), [chat](apps/mobile/src/app/chat/%5Bid%5D.tsx), [chats](apps/mobile/src/app/(tabs)/index.tsx), [archive.test.ts](packages/core/src/archive.test.ts)
- [X] `artifacts/LastCall-1.0.43-store.aab` 60499980 bytes, sha256 `b2c8db5f859fdea32b369df0b56ef225e0e1d87acdf263c9149dd31cc8ad5587` (rebuilt with the large-file notice); emulator: draft shown in the list and back in
  the field after a force-stop; share from Google Photos with the app closed and in the background opens Send to…,
  the photo was delivered to Alex. `npm run check` passes (mobile 285, server 154, core 315)
- [X] Large files (over 5 MB): a confirmation before sending ("go straight to the recipient's phone over a direct
  connection and are encrypted on the way; on both phones stored without LastCall's extra encryption") and a note on
  the file in the chat. The owner asked for "sent without encryption"; the transfer is in fact encrypted (per-file key
  over the end-to-end session), so the text says what is true. Strings in 29 languages. Emulator: a 6.4 MB image
  shared to Alex showed the confirmation and arrived (Delivered) with the note
  → Artifacts: [attachments.ts](apps/mobile/src/attachments.ts), [AttachmentCard.tsx](apps/mobile/src/components/AttachmentCard.tsx)
- [ ] The owner's phone: not reproduced there; the emulator never showed the failure, so the fix addresses the most likely cause
- [ ] Google Play upload of 1.0.43 (1.0.42 is in review)

# 1.0.42 / code57 — GPT review fixes: message requests, history archive, storage, direct-only files (2026-11-24)

- [X] msg-5th: message requests (strangers' mailbox items stay unopened on the server; no contact, no
  wake rights, no WebRTC from their connect); accept with separate calls/notifications and direct
  connection permissions, editable on the contact profile; decline/block drop their items; blocked
  senders refused before any write on every path; `watch.consent` keeps blocked/limited contacts
  watched without wake rights. Contract: [MAILBOX-CONTRACT.md](docs/MAILBOX-CONTRACT.md)
  → Artifacts: [messenger.ts](packages/core/src/messenger.ts), [requests.tsx](apps/mobile/src/app/requests.tsx), [contact](apps/mobile/src/app/contact/%5Bid%5D.tsx), [server directory](apps/server/src/directory.ts), [mailbox.test.ts](apps/server/test/mailbox.test.ts), [e2e contacts](tests/e2e/contacts.ts)
- [X] msg-9ri: history over 100/chat and 500/overall goes to an encrypted archive table in the same
  transaction instead of being deleted; "Show earlier messages" pages it read-only
  → Artifacts: [local-records.ts](packages/core/src/local-records.ts), [record-store.ts](apps/mobile/src/record-store.ts), [archive.test.ts](packages/core/src/archive.test.ts)
- [X] msg-11x step 1: storage counts, sizes and deletes large files and .part downloads; Clear all prunes
  orphan large-file folders; texts no longer claim large files are encrypted (step 2 = msg-69g)
- [X] msg-co5: strict route classification (selected pair, both candidates known), route re-checked every
  3 s during large transfers with pause and resume from the received offset; relay-only notice
  → Artifacts: [session.ts](packages/core/src/session.ts), [route.test.ts](packages/core/src/route.test.ts), [bulk-session.test.ts](packages/core/src/bulk-session.test.ts)
- [X] `npm run check` (mobile 285, server 153, core 314) and Playwright e2e 18 passed / 1 skipped
- [X] 18 new strings translated into 29 languages by three helpers; all pass check-locales; [i18n-missing.mjs](apps/mobile/scripts/i18n-missing.mjs) lists untranslated t() strings
- [X] Final `artifacts/LastCall-1.0.42-store.aab` 60492913 bytes, sha256 `bd6b8afe5602eb9a6e1f248bdf2890f551fc239379e794583741e0d34e884752` (rebuilt after the fix below)
- [X] Server deployed 2026-11-24 with the owner's yes (rollback image `messenger-signaling:before-requests`, DB backup
  `/data/directory-before-requests-2026-11-24.sqlite`), 88 users kept
- [X] Emulators found a bug present since 1.0.40: after Delete contact a group co-member stays a contact and their
  next direct message through the mailbox was dropped (no chat). Fixed: the chat reopens (server test proves it
  fails without the fix); on the emulator Alex got "Second try from Maria" in a reopened chat
- [X] Permissions on the emulator against the deployed server: turning off Calls and notifications removes Maria
  from Alex's wake consent on the server, turning it on restores it; the app stays connected, no server errors
- [ ] A true stranger's request on a phone: covered by server tests with real clients, not tried on the emulators
  (both test accounts share a group, so they stay contacts)
- [X] 2026-11-24, owner's yes: bundle 57 uploaded once (closed testing), open, production (100 %, 22 active
  installs) and internal took it from the library; devices unchanged (8 865 phones, 4 707 tablets). Internal
  published at once ("LastCall 1.0.42 internal"); production, open and closed sent to Google review, replacing
  1.0.41 still in review. Notes en-US + ru-RU (Play pre-filled the notes field with 35 empty language
  templates on production; replaced with the two real notes)

# 1.0.41 / code56 — 30 languages, mirrored layout for right-to-left scripts (2026-11-24)

- [X] The UI follows the phone: the first preferred language LastCall has, otherwise English; only that
  dictionary is loaded. 30 languages (en, ru, es, pt, fr, de, it, pl, uk, tr, ar, fa, he, ur, hi, bn, id,
  ms, vi, th, zh-Hans, zh-Hant, ja, ko, nl, ro, cs, el, kk, uz); also listed in Android's per-app
  language setting. Arabic, Persian, Hebrew and Urdu mirror the layout; back/forward arrows turn around.
  Account emails stay English/Russian
  → Artifacts: [i18n.ts](apps/mobile/src/i18n.ts), [locales](apps/mobile/src/locales/), [languages.json](apps/mobile/i18n/languages.json), [check-locales.mjs](apps/mobile/scripts/check-locales.mjs), [tests](apps/mobile/tests/i18n.test.ts)
- [X] Translations made by seven parallel helpers from the English source with the Russian as reference;
  every language passes `node apps/mobile/scripts/check-locales.mjs` (741 strings with the same
  {placeholders}, 23 Android strings with escaped quotes and printf args, Play limits). Spot fixes:
  Spanish audit wording, Polish name placeholders made case-safe, Malay short text, zh-Hans folder
  - Native strings (notification channels, incoming call, delivery summary) in every language
  → Artifacts: [plugins/strings](apps/mobile/plugins/strings/), [withLastCallStrings.cjs](apps/mobile/plugins/withLastCallStrings.cjs)
- [X] Google Play texts for all 28 new languages prepared in [store/listings](store/listings/) (not uploaded)
- [X] `artifacts/LastCall-1.0.41-store.aab` 60463588 bytes (+0.6 MB), sha256 `34b5ad8abddcb96513597a222e2c036a35b0ae96de9541fb202011b63ad5331f`; emulators: German UI and a
  German push ("Maria Petrova — Du hast eine ungelesene Nachricht", summary "Neue Nachrichten: 1 · Chats: 1"),
  Arabic mirrored chats list and chat, Japanese settings. `npm run check` passes (mobile 283, server 152,
  core 306). Not uploaded to Google Play
- [ ] The server's own generic push text for very old app versions without background sync is Russian only

# GPT review suggestions (2026-11-24) — planned, not started here

- [ ] msg-5th (already in progress in the working tree, uncommitted): "Message requests". A stranger's
  first mailbox item makes them a contact and a push-wake source before decryption; an incoming connect
  can open WebRTC (IP exposure) before acceptance; blocking differs between mailbox and direct paths.
  Separate decisions: accept messages / allow calls and push / allow direct connection; blocking acts
  before any connection or write
- [ ] msg-11x: "Clear all data" counts and deletes only blobKey files, not large attachments (repro: 1 KiB
  + 100 MiB → shows 1 file, 1 KiB); files over 5 MiB and .part copies are not LastCall-encrypted while the
  settings text says all files are. One accounting for both kinds first, then chunked encryption
- [ ] msg-9ri: history trimmed to 100 texts per chat / 500 overall and dropped from storage; one busy chat
  pushes out another. Page from SQLite, limit only what is in memory; or make retention a visible choice
- [ ] msg-co5: currentRoute() can call a pair "direct" without candidate details; route checked only
  before a large transfer starts. Require a confirmed direct pair (selected candidate pair id), pause on
  network change and resume from offset; status "Both online, but a direct connection is unavailable"

# 1.0.40 / code55 — encrypted server mailbox, unread-only notices, new store listing (2026-11-23)

- [X] Texts, read receipts, edits, deletions and reactions go through an encrypted server mailbox
  (pair key, XChaCha20-Poly1305, server sees only who/when/size/kind), kept ≤ 7 days until the
  recipient's phone takes them; delivered ticks come from server receipts. Older apps are refused
  by the server and stay on the direct path. Contract: [MAILBOX-CONTRACT.md](docs/MAILBOX-CONTRACT.md)
  → Artifacts: [mailbox.ts](packages/core/src/mailbox.ts), [mailbox-wire.ts](packages/core/src/mailbox-wire.ts), [messenger.ts](packages/core/src/messenger.ts), [server mailbox](apps/server/src/mailbox.ts), [directory.ts](apps/server/src/directory.ts)
- [X] Files, voice notes and video circles stay direct; the server carries an encrypted
  announcement so the recipient sees a placeholder in the right place ("arrives as soon as the
  sender's phone is online"), counted as unread; the sender keeps its delivery request so both
  phones are woken to meet
  → Artifacts: [AttachmentCard.tsx](apps/mobile/src/components/AttachmentCard.tsx)
- [X] Notifications show only who wrote and how much is unread, one notice per chat (native
  `showUnread`); the server drops encrypted text previews older senders still attach
  → Artifacts: [push-previews.ts](apps/mobile/src/push-previews.ts), [push-preview-model.ts](apps/mobile/src/push-preview-model.ts), [LastCallNotificationsModule.java](apps/mobile/plugins/notifications/LastCallNotificationsModule.java)
- [X] Tests: core 305, server 151 (new [mailbox.test.ts](apps/server/test/mailbox.test.ts) with real
  clients: offline delivery, delivered/read ticks, first message from a stranger, file placeholder
  order, group to offline members, older-app refusal, quotas and push rules), mobile 278,
  `npm run check` and Playwright e2e 18 passed / 1 skipped
- [X] Store listing rewritten (ru/en): [listing-ru.md](store/listing-ru.md), [listing-en.md](store/listing-en.md);
  privacy policy updated locally for the mailbox ([privacy.html](infra/public/privacy.html)), not published
- [X] Small files, voice notes and video circles go phone to phone only, like large files: if the
  selected ICE pair is a TURN relay, the file waits for a direct path (retried every 5 s while
  connected and on reconnect)
  → Artifacts: [messenger.ts](packages/core/src/messenger.ts), [direct-only-file.test.ts](packages/core/src/direct-only-file.test.ts)
- [X] "Share → LastCall" from any app (text, links, one or several files of any type) and "LastCall"
  in the text selection menu (PROCESS_TEXT turns into a text share), then a "Send to…" chat picker.
  Own native module instead of `expo-share-intent`, which crashed the app on an empty provider
  cursor; files are copied off the main thread into `cache/lastcall-incoming` (≤ 10, ≤ 1 GiB,
  unsent copies kept a day), unreadable ones are reported, long text is split into messages
  → Artifacts: [LastCallShareModule.java](apps/mobile/plugins/share/LastCallShareModule.java), [LastCallProcessTextActivity.java](apps/mobile/plugins/share/LastCallProcessTextActivity.java), [withLastCallShare.cjs](apps/mobile/plugins/withLastCallShare.cjs), [share.tsx](apps/mobile/src/app/share.tsx), [ShareIntentBridge.tsx](apps/mobile/src/components/ShareIntentBridge.tsx), [share-intent-model.ts](apps/mobile/src/share-intent-model.ts), [tests](apps/mobile/tests/share-intent.test.ts)
- [X] Emulators (both 1.0.40, still the old server): a text shared by intent and a photo shared from
  Google Photos → LastCall → Alex Morgan arrived on the other emulator (photo "Delivered"); the
  selection-menu entry opens the picker with the selected text; an unreadable shared file shows a
  notice instead of crashing. `artifacts/LastCall-1.0.40-store.aab` 59828145 bytes, sha256 `93a20a87ecfe6cc39b9ca170be4606c98262f5b5655840c4561f4d6a20a9abe4`
  (test build, not uploaded). `npm run check` passes (mobile 281, core 306, server 151), e2e 18 passed / 1 skipped
- [X] Server deployed 2026-11-23 with the owner's yes (rollback image `messenger-signaling:before-mailbox`,
  DB backups `/data/directory-before-mailbox-2026-11-23.sqlite` and `…-23b.sqlite`); mailbox tables
  created, 88 users kept; `PRAGMA secure_delete = ON` so taken items are overwritten
- [X] Final `artifacts/LastCall-1.0.40-store.aab` 59828121 bytes, sha256 `6b8da7f8d73bfdc7635882a1afb4caadeb9fdaf52c17551da48332f9838dffc4`, installed on both
  emulators: Alex in background, Maria's text stored on the server, content-free push woke Alex,
  notice "Maria Petrova — You have an unread message", two grey ticks for Maria, server row deleted
  at once; a photo shared to offline Alex announced itself (notice count 2) and then arrived
  directly within seconds, so the placeholder state itself was seen only in the integration test.
  Chat notice no longer says "messages wait on this device" after a failed direct attempt
- [X] 2026-11-23, owner's yes: privacy policy published to the site (`proxy/sites/messenger-public/privacy.html`,
  previous live copy in `artifacts/privacy-live-before-2026-11-23.html`); it also carries the 1.0.33
  registration-country paragraph that had been waiting
- [X] 2026-11-23: bundle 55 uploaded once (closed testing), open, production (100 %, 22 active installs)
  and internal took it from the library; device support unchanged (8 865 phones, 4 707 tablets).
  Internal testing published at once ("LastCall 1.0.40 internal"). Store listing: en-US rewritten
  ("LastCall: Private Messenger"), ru-RU added ("LastCall: приватный мессенджер"); AI declaration left at
  its default (no assets changed). Seven changes sent to Google review; notes en-US + ru-RU

# 1.0.39 / code54 — keyboard over the message field during live location (2026-11-22)

- [X] While a live location share (or a collapsed call) shows its strip at the top, the keyboard no longer
  covers the chat's message field: the strips report how far they push the screens down and the chat's
  KeyboardAvoidingView adds that offset (it measured itself from its parent and missed the keyboard by the
  strip's height, 195 px on the test emulator). Checked on the emulator with the release build: field right
  above the keyboard with and without the live location strip; the call-bar case not tried on a device → Artifacts: [offset](apps/mobile/src/top-offset.ts), [chat](apps/mobile/src/app/chat/[id].tsx), [tests](apps/mobile/tests/top-offset.test.ts)
- [X] Build and emulator smoke: `artifacts/LastCall-1.0.39-store.aab` (59 804 950 bytes, sha256
  `e4708361f02dd7e15ca66de6158aa6eceee61b28b7bb0cf1c83b53898dd42109`) installed on LastCall_Store_B: chats,
  contacts and settings open; live location share started and the typed message field sits right above
  the keyboard; no crashes in logcat
- [X] 2026-11-22: bundle 54 uploaded once (closed testing), open testing and production took it from the
  library; production at 100 %, device support unchanged (8 920 phones, 4 706 tablets); all three changes
  sent to Google review (managed publishing off). Notes (en-US): "The keyboard no longer covers the
  message field while you share your live location."
- [X] 2026-11-22: internal testing got 54 (1.0.39) at 22:56 (published by the owner); the paused open
  testing track was resumed ("Продолжить тестирование") and that change sent to Google review

# 1.0.38 / code53 — ringback, permanent permissions, photo and video viewer (2026-11-22)

- [X] The caller hears ringback while an outgoing call waits for an answer: Android's own region tone
  (`ToneGenerator.TONE_SUP_RINGTONE`, 425 Hz 1 s / 4 s in Europe and Russia) on the voice-call stream,
  from the moment the caller dials (call audio starts at dial when the microphone is already allowed)
  until the call is answered or ends; the status shows "Ringing…" once the other phone reports ringing → Artifacts: [native](apps/mobile/plugins/calls/LastCallRingback.java), [JS](apps/mobile/src/system-calls.ts), [model](apps/mobile/src/system-call-model.ts), [tests](apps/mobile/tests/system-calls.test.ts)
- [X] The permissions screen says to allow everything permanently: which answer to pick in each Android
  prompt ("While using the app", not "Only this time"; "Allow all" for photos) and why; on first run the
  prompts start from an "Allow all" button under that explanation instead of covering it at once; a
  blocked permission names the exact settings choice → Artifacts: [screen](apps/mobile/src/app/permissions.tsx), [notice](apps/mobile/src/permission-notice-model.ts)
- [X] Photos and videos in a chat open full screen in the app (pinch and double-tap zoom for photos,
  player with controls for video, share button inside); other files still go to the share menu. The
  decrypted copy lives in the cache only while the viewer is open → Artifacts: [viewer](apps/mobile/src/components/MediaViewer.tsx), [model](apps/mobile/src/media-viewer-model.ts), [tests](apps/mobile/tests/media-viewer.test.ts)
- [X] Built 1.0.38/code53, `artifacts/LastCall-1.0.38-store.aab`, sha256
  `95f7f29c7be9f045e4255176977d6598cd8bd0003a7d9f0b667d0e18d648d710` (59 804 955 bytes). Emulators
  (`LastCall_Store_B` calling `MicControl_API36_16K`): ringback starts at dial for an offline contact
  ("Calling…") and for an online one ("Ringing…"), Android shows the app's tone track active, it stops on
  answer ("In call") and on End; a received PNG opens full screen, double tap zooms, drag pans, Back closes;
  a sent MP4 plays with controls; the permissions screen shows the guide. Not verified: hearing the tone
  on a real phone's earpiece, Bluetooth headsets.
- [X] 2026-11-22: sent to Google review in one submission: production "1.0.38 work" (replaces 1.0.37 work, 100%,
  all target countries, managed publishing off, so it goes live on approval), open testing "LastCall 1.0.38 open"
  (the unsent 1.0.36 open draft reused: its countries and testers kept, bundle 51 replaced by 53) and closed testing
  "LastCall 1.0.38 closed" (Alpha, 100%). Bundle 53 uploaded once and added to the other tracks from the library;
  device support unchanged (8 920 phones, 4 706 tablets); Play's pre-review check found no problems.
  Internal testing stays on 1.0.37.

# 1.0.37 / code52 — clearer invitation step, Telegram-style live location map (2026-11-21)

- [X] Sign-up by invitation explains itself: a "Registration is by invitation" box says to ask the
  person who recommended LastCall and paste their message; the refusal and invalid-code texts say
  the same in plain words → Artifacts: [onboarding](apps/mobile/src/app/onboarding.tsx), [texts](apps/mobile/src/i18n.ts)
- [X] The chat map shows everyone sharing a live location in the chat, the tapped point and the
  viewer's own position, one pin per person with avatar and name ("You" for the viewer), a list with
  "updated N min ago" and distance, camera framing everyone until panned; a live card not edited for
  8 h no longer counts as sharing; a sent plain place is its own named pin, separate from "You"; the map
  never opens Google's location-accuracy settings prompt → Artifacts: [model](apps/mobile/src/location-map-model.ts), [tests](apps/mobile/tests/location-map-model.test.ts), [viewer](apps/mobile/src/components/LocationContactCard.tsx), [position](apps/mobile/src/device-position.ts)
- [X] Built 1.0.37/code52, `artifacts/LastCall-1.0.37-store.aab`, sha256
  `66372f602c8a48fc0a0674363108761d3bcfd28bec3d17c00d6e6d0f3c01b450`. Emulator: a sent place and "You"
  (emulator GPS) both on the map, framed, initials on avatars, "440 m away". Not verified: two people
  sharing live at once on real phones; the invitation box (the emulator reports US, so sign-up is open).
- [X] 2026-11-21: sent to Google review for production as "1.0.37 work" (replaces 1.0.36 work, 100%,
  all 178 target countries, managed publishing off, so it goes live on approval). The Mac was on its lock
  screen, so the AAB was attached in the page from base64 parts (size checked: 59 795 084 bytes).
  Not uploaded to internal or closed testing at that time.
- [X] 2026-11-22: bundle 52 added from the Play library (no re-upload) and published to internal testing
  as "LastCall 1.0.37 internal" (available to internal testers); notes copied from "1.0.37 work"; no
  devices lost (8 920 phones, 4 706 tablets). "LastCall 1.0.37 closed" (Alpha, 100%) passed Play's
  pre-review check and was sent to Google review; closed testers stay on 1.0.36 until it passes.
  Production "1.0.37 work" was already approved and shows "Доступен в Google Play" (2026-11-22).
- [X] 2026-11-22 smoke on the exact store AAB (sha256 matches): the app on the `LastCall_Store_B` emulator (Android 16)
  has the same `classes.dex` and JS bundle as a bundletool universal APK from this AAB. Opened Chats, Settings, a chat,
  the location map (place pin "Tverskaya Street, 7", list row "You" = sent by you), a voice call ("Calling…", verification
  code, End → "Call cancelled") and Contacts: no crash, no JS errors in logcat. Not verified: the viewer's own position on
  the map (emulator GPS gave no fix; `geo fix` did not take).

# 1.0.36 / code51 — history in SQLite, encrypted per record (2026-11-18)

- [X] Core: the history is stored as separately sealed records; a save writes only what changed,
  in one transaction; one writer per database; the old single sealed file is moved once and deleted
  only after a successful write. Save after one message changed ~80 ms → ~12 ms (2 records written);
  start ~85 (estimated) → ~125 ms; one-time move ~210 ms (500 messages, Node without JIT)
  → Artifacts: [records](packages/core/src/local-records.ts), [tests](packages/core/src/local-records.test.ts), [doc](docs/LOCAL-STORAGE.md)
- [X] App: SQLite store (`expo-sqlite`, WAL), one connection per database, closed before "Delete account"
  → Artifacts: [store](apps/mobile/src/record-store.ts), [adapter](apps/mobile/src/storage.ts)
- [X] Manifest: Wi-Fi and portrait screen declared optional (Play warned that they exclude devices)
  → Artifacts: [plugin](apps/mobile/plugins/withOptionalFeatures.cjs)
- [X] Built 1.0.36/code51, `artifacts/LastCall-1.0.36-store.aab` (59.8 MB, +~1 MB for SQLite), sha256
  `a2874646f231143d75669077c51284bc56383d7e93ba651a247d8c92bb426913`; merged manifest has both features
  `required="false"`. Installed over 1.0.35 on the emulator: the history moved, chats open after two cold
  restarts (launch 670–860 ms), no storage errors. The database file itself cannot be inspected on a
  release build. Unit (301 + 143), e2e (18 passed, 1 skipped), type and lint checks pass. Published to
  internal testing as "LastCall 1.0.36 internal" (available to testers 12:37) and sent to Google review
  for closed testing as "LastCall 1.0.36 closed"; Play's pre-review check no longer reports the device
  availability issue. The unsent "LastCall 1.0.35 closed" draft was replaced; closed testers stay on
  1.0.34 until review passes.

# 1.0.35 / code50 — faster chat opening and switching (2026-11-18)

Measured with the core on 500 messages, Node without JIT (closer to Hermes than V8's JIT):
opening an already-read chat 187 ms → 0.1 ms; with 50 unread 250 ms → 171 ms and only after
the opening animation; saved history 491 KiB → 327 KiB. One save stays ~80 ms: almost all of it is
XChaCha20 in JavaScript (60 of 72 ms), which only SQLite with per-message writes or native crypto
removes (planned next as step 4).

- [X] Save: markRead no longer rewrites the encrypted history when nothing changed (it re-sealed it
  twice on every chat open); local state sealed as base64 (version 2), hex (version 1) still read
  → Artifacts: [core](packages/core/src/messenger.ts), [sealing](packages/core/src/persistence.ts), [tests](packages/core/src/persistence.test.ts)
- [X] Saves wait (at most 1 s) while a screen is animating in; read receipts start once the chat has
  finished opening → Artifacts: [idle](apps/mobile/src/transition-idle.ts), [gate](apps/mobile/src/after-transition.tsx), [chat](apps/mobile/src/app/chat/[id].tsx)
- [X] Snapshots reuse unchanged, frozen message and file objects and lists; the chat timeline, the
  translation input and the chat-list previews are rebuilt only when that history changes; chat-list
  rows are memoized; date formatters are cached; the last-message preview no longer sorts the history
  → Artifacts: [chat list](apps/mobile/src/app/(tabs)/index.tsx), [timeline](apps/mobile/src/timeline-model.ts), [dates](apps/mobile/src/date-format.ts)
- [X] Built 1.0.35/code50, `artifacts/LastCall-1.0.35-store.aab` (+3 KB over 1.0.34), sha256
  `c8bda7bc18e021f0780b91ab683cd14670916a6b8a72731c5342abd30178c5fe`. On the emulator the 1.0.34 (hex)
  history opened, chats opened and switched with no JS errors, the unread badge cleared after opening,
  and the history saved in the new format reopened after a restart. Unit, e2e (18 passed, 1 skipped),
  type and lint checks pass. Not yet published; not measured on a real phone.
- FlashList was not added: v2 replaces the inverted list the chat relies on (scroll anchoring, swipe
  to reply, jump to a quoted message) and the chat already renders memoized rows in a window.

# 1.0.34 / code49 — "Create account" failed on Android since 1.0.31 (2026-11-18)

- [X] Find why a real phone shows "Could not check registration availability": React Native's
  fetch polyfill turns `cache: 'no-store'` into a `?_=<time>` query, so the client saw a different
  response URL and treated it as a redirect (and the server answered 404 to the query path)
  → Artifacts: [client](packages/core/src/directory.ts), [server](apps/server/src/server.ts)
- [X] Client: no `cache` option, response URL compared without its query; server routes by path.
  Regression tests in both; server deployed 2026-11-18 (signaling only). Built 1.0.34/code49,
  `artifacts/LastCall-1.0.34-store.aab`, sha256 `3af78c6f29fb2c5993ed30c339d2f029bf75145645a38865542d29a3f8062b84`;
  on a clean emulator user "Create account" now opens the email step. Published to internal
  testing as "LastCall 1.0.34 internal" (available to testers) and sent to Google review for closed
  testing (Alpha) as "LastCall 1.0.34 closed", replacing 45 (1.0.31); managed publishing is off
  → Artifacts: [core test](packages/core/src/registration-invites.test.ts), [server test](apps/server/test/registration-invites.test.ts)

# 1.0.33 / code47 — contact profile and phone-reported sign-up countries (2026-11-17)

- [X] Server: sign-up policy counts countries the phone reports (Google Play account, mobile
  network; SIM only without a network), only toward caution; deployed (only `messenger-signaling`
  rebuilt). Live check: no countries → invite, RS → open, RS+RU → invite
  → Artifacts: [registration-invites.ts](apps/server/src/registration-invites.ts), [REGISTRATION-INVITES.md](docs/REGISTRATION-INVITES.md)
- [X] App: native `lastcall-country` module (Play Billing BillingConfig, TelephonyManager); hints
  sent with the policy check, email start and registration; shown in Connection diagnostics.
  Emulator reports "US" (its network); Play Billing does not connect on the emulator, so the
  Play country is unverified. The library adds `com.android.vending.BILLING` to the manifest
  → Artifacts: [LastCallCountryModule.kt](apps/mobile/modules/lastcall-country/android/src/main/java/ru/lastcall/country/LastCallCountryModule.kt), [country-hints-model.ts](apps/mobile/src/country-hints-model.ts)
- [X] Contact profile like Telegram (tap the header of a direct chat): avatar, status, message /
  audio / video, @username copy, safety code, groups in common, media and files, block, delete
  → Artifacts: [contact/[id].tsx](apps/mobile/src/app/contact/%5Bid%5D.tsx), [contact-info-model.ts](apps/mobile/src/contact-info-model.ts)
- [X] Play rejected code 47: Play Billing 7.1.1 is below the required 8.0.0. Upgraded to 8.0.0 and
  rebuilt as 1.0.33/code48, `artifacts/LastCall-1.0.33-store.aab`, sha256
  `2ed414189228f2ba41b4a729b3146a0eae5e9c7160aabeac6cddba40440dc856`; smoke-tested on the emulator
  and published to internal testing as "LastCall 1.0.33 internal" (also carries the blank-screen fix
  and invitation sharing)
- [ ] Privacy policy paragraph (country check, phone countries) still only in the repository

# Invitation system review (2026-11-17)

- [X] Code review of the Codex invites work: gate, single use, hashing, quotas, admins — sound
  → Artifacts: [REGISTRATION-INVITES.md](docs/REGISTRATION-INVITES.md) (Review 2026-11-17)
- [ ] **Production sees no client IPs** (router + Docker on macOS): country is unknown for
  everyone, so every new sign-up worldwide needs an invitation; IP rate limits are one bucket.
  Needs an operator change of the shared SNI router/Caddy
- [X] Share invitation (message text) and paste of the whole message accepted
- [X] Privacy policy paragraph about the country check (repo only, not published)
- [ ] Restrict-only device country signals (SIM/network/region) against VPN bypass
- [ ] Decide whether Google Play should exclude the restricted countries
- [ ] Monthly DB-IP refresh

# Blank screen and freezes after a long time in the background (2026-11-17)

- [X] Reproduced on the emulator by killing the backgrounded process (what Android does under
  memory pressure) and reopening: splash, then a white screen with a spinner, chats only after
  ~5.5 s. Boot marks showed ~1.7–1.9 s inside history restore re-verifying 53 stored Ed25519
  signatures (read receipts, edits, reactions) at ~30 ms each in Hermes; real accounts hold
  hundreds, and phones are slower than the emulator
- [X] Restore no longer re-verifies stored signatures: the sealed state is authenticated with
  this device's own key and every item was verified when it arrived; structural checks stay.
  Cold reopen now shows chats at ~2.5 s, ~1 s of which is Android starting the app
- [X] Group roster signatures are verified once per exact roster instead of on every group message
- [X] The chat list shows a spinner, not "Your conversations", until the history is read
- [X] Warm resume after 3 min of forced Doze: no freeze, a chat opened ~0.3 s after the tap
- [ ] Not reproduced: a burst of many incoming group messages after a long background (each
  costs a signature check of ~30 ms on the JS thread); a native Ed25519 would remove it
- [ ] First read of the device key from Android Keystore took ~1 s once (system-side)

# Telegram-style location picker (2026-11-17, after the 1.0.31 phone test)

- [X] Taps on the map "did nothing" in a city: Google Maps sends a tap on a drawn place only to
  `onPoiClick`, and the picker handled only `onPress`. Rebuilt like Telegram: fixed centre pin,
  tap to move it, tap a place to pick it by name, address under the pin, my-location row with
  accuracy, live sharing row, address search; the message title is the place or the address
  → Artifacts: [LocationPicker.tsx](apps/mobile/src/components/LocationPicker.tsx), [location-picker-model.ts](apps/mobile/src/location-picker-model.ts), [location-picker-model.test.ts](apps/mobile/tests/location-picker-model.test.ts)
- [X] Emulator: the address appears under the pin; tapping a restaurant picks it with its category
  and address; searching "Tverskaya 7" flies there; the sent card is titled "Tverskaya Street, 7"
- [ ] Nearby places list (Telegram shows one): needs the Places API enabled on the Maps key
- [ ] Real phone check

# 1.0.31 / code45 — market registration and delegated invitations (2026-11-16)

- [X] Enforce market registration on the server and restrict invite grants to the administrator. Enabled on both public gateways. Verified the administrator binding against the existing account and tested restricted, unrestricted, and unknown addresses through the trusted proxy.
  → Artifacts: [server policy](apps/server/src/registration-invites.ts), [server tests](apps/server/test/registration-invites.test.ts), [operator guide](docs/REGISTRATION-INVITES.md)
- [X] Package Android registration and invitation management. The signed APK is available at [LastCall 1.0.31](https://p2p.lienad.ru/download/LastCall-1.0.31.apk), SHA-256 `24ace058ee6a7ec7f8dcb493f5f1f6c35205dae119461c4eed98c0b74439961a`.
  → Artifacts: [onboarding](apps/mobile/src/app/onboarding.tsx), [invitation settings](apps/mobile/src/app/settings/invitations.tsx), [QA report](docs/reports/testing/2026-11/registration-invites-1031.md)
- [X] Build, verify, and publish the signed Google Play bundle to internal testing. `artifacts/LastCall-1.0.31-store.aab`, SHA-256 `a292caccc75df2ab032edb2b85d321f7e2d40e7867705101af7dc1379286e32e`. Play Console shows `45 (1.0.31)` available to internal testers.
- [ ] Verify invitation management and registration on physical Android and iOS devices (`msg-zbk`).

# 1.0.30 / code44 — chat, groups, ticks and large files after the 1.0.29 test (2026-11-16)

- [X] `artifacts/LastCall-1.0.30-store.aab` (ignored binary), sha256 `e41f8ce60886b1fa8d757c731ceef3a69355750a9e7d112421fea768bb267edf`; starts and opens a chat on the emulator; `npm run check` and the full Playwright suite pass. Not uploaded yet

- [X] Delivery ticks like WhatsApp/Telegram: clock while still on this phone; one grey tick once a
  push request for every recipient was handed to the server (`notifiedTo`, set after
  `delivery-sync`/`wake` over a live socket — no server change, so it also shows when the server
  did not push, e.g. no push consent); two grey ticks on the recipient's authenticated receipt;
  two blue ticks when read
  → Artifacts: [messenger.ts](packages/core/src/messenger.ts), [delivery-model.ts](apps/mobile/src/delivery-model.ts), [wake.test.ts](packages/core/src/wake.test.ts), [delivery.test.ts](apps/mobile/tests/delivery.test.ts)
- [X] Swipe a message left to reply (Telegram), with a haptic tick at the trigger point
  → Artifacts: [SwipeToReply.tsx](apps/mobile/src/components/SwipeToReply.tsx), [swipe-reply-model.ts](apps/mobile/src/swipe-reply-model.ts)
- [X] Safety-code banner removed from the top of chats; it stays in the ⋮ menu. The group ⋮ menu no
  longer lists per-member blocking; blocking moved to the member sheet on the group screen
- [X] Group info (tap the group header): members, owner badge, message/block a member; the owner
  renames, adds and removes members. Core: versioned creator-signed roster (v2), gossiped by any
  member, stale copies ignored, removed members keep read-only history (`formerIds`, `removed`),
  new members get no history from before they joined (`joinedAt`)
  → Artifacts: [group-sync.ts](packages/core/src/group-sync.ts), [group/[id].tsx](apps/mobile/src/app/group/%5Bid%5D.tsx), [group-model.ts](apps/mobile/src/group-model.ts), [v2.test.ts](packages/core/src/v2.test.ts)
- [X] Chat opening: measured on the emulator — first render 4–10 ms, commit 20–45 ms, then 5–6
  full re-renders in the first second, each re-rendering every row. Rows are now memoized on a
  version string, snapshot publishes are coalesced (16 ms, immediate in background), lite maps and
  decrypted image previews wait for the open transition, and previews are cached for the
  foreground session instead of being decrypted again on every open
- [X] Owner rename/remove/add verified across four real browsers over WebRTC (`tests/e2e/group-roster.spec.ts`): everyone converges, the removed member stops receiving, the new one gets no earlier history
- [ ] Owner add/remove on real phones (the second emulator would not boot: memory/VM)
- [X] Large files over 5 MiB up to 1 GiB, direct phone-to-phone only (no TURN), waiting like
  text when offline, resuming after a cut; old clients never receive them (SDP capability)
  → Artifacts: [LARGE-FILES.md](docs/LARGE-FILES.md), [bulk.ts](packages/core/src/bulk.ts), [session.ts](packages/core/src/session.ts), [bulk-files.ts](apps/mobile/src/bulk-files.ts), [large-file.spec.ts](tests/e2e/large-file.spec.ts)
- [ ] Large file between two real phones (speed under Hermes, CGNAT, app killed mid-transfer)

# Release 1.0.29 / code43 — Google Play internal testing (2026-11-16)

- [X] Maps key: `ru.lastcall.app` + Play app-signing SHA-1
  `60:31:AF:1D:06:B6:43:78:1F:68:FD:AA:1D:A3:48:D9:B1:52:56:12` added to the "LastCall" key
  (project mojordomo-1007); verified the build embeds that same key. Map works per the user
- [X] Rebuilt unchanged code as 1.0.29/code43 on the user's request; the user uploaded it


- [X] Contact sharing crashed: expo-contacts 58 makes the top-level `presentContactPickerAsync`
  throw ("deprecated, use the class-based API"). Per the user's choice, contacts now work like
  Telegram: READ_CONTACTS is requested on first "Share contact" (removed from
  `blockedPermissions`; WRITE_CONTACTS stays blocked), an in-app searchable list of contacts that
  have a number, and the whole contact (all numbers, de-duplicated) is sent. iOS gets
  `NSContactsUsageDescription`
  → Artifacts: [contacts.ts](apps/mobile/src/contacts.ts), [contacts-model.ts](apps/mobile/src/contacts-model.ts), [ContactPicker.tsx](apps/mobile/src/components/ContactPicker.tsx), [contacts-model.test.ts](apps/mobile/tests/contacts-model.test.ts)
- [X] Published to the internal track as "LastCall 1.0.28 internal" (2026-11-16); Play's
  review showed no warnings and the same supported-device count as 1.0.27
- [X] Data safety: added "Precise location" and "Contacts", answered like the existing
  "Other in-app messages" entry (collected, not ephemeral, optional, app functionality) —
  both only leave the phone as a chat message the person sends. Submitted for review
- [X] Foreground-service declaration: Play blocked the submission because
  FOREGROUND_SERVICE_LOCATION (live location, since 1.0.27) was undeclared. Declared as
  "user-initiated location sharing" with an emulator demo video:
  [location](https://p2p.lienad.ru/demo/lastcall-foreground-location.mp4) (file in
  `~/server/proxy/sites/messenger-public/demo/`). Submitted together with Data safety;
  Google review pending
- [X] Grey map in the Play build: the Maps key restricted `ru.lastcall.app` to the upload-key
  SHA-1 only; Play installs are signed with the app-signing key (SHA-1
  `60:31:AF:1D:06:B6:43:78:1F:68:FD:AA:1D:A3:48:D9:B1:52:56:12`). The user is adding it to the
  key in Google Cloud (project mojordomo-1007, key "LastCall"); no code change
- [X] Live location felt static: the bubble had no map and the link opened a fixed point.
  Now the bubble shows a lite map whose pin moves with each edit plus "updated N min ago", and
  tapping opens a full-screen viewer that follows the pin (pan to stop, target button to
  resume) with Stop sharing for the sender. Sender side: `distanceInterval` 15 m → 0, so a
  phone standing still still sends the once-a-minute refresh
  → Artifacts: [LocationContactCard.tsx](apps/mobile/src/components/LocationContactCard.tsx), [live-location.ts](apps/mobile/src/live-location.ts), [live-location-model.ts](apps/mobile/src/live-location-model.ts)
- [X] Full-screen modals (location picker/viewer, contact list) under the call or live-location
  bar drew their header under the status bar: those bars zero the top inset for the screens
  below them. The modals now measure their own window with the native `SafeAreaView`
- [X] "My location" did nothing after "No thanks" to Google's Location Accuracy prompt; the
  picker now falls back to the last known position
- [X] `artifacts/LastCall-1.0.28-store.aab` (ignored binary), sha256
  `bd04a71c41340a0ffffed145cbc128e942745b96d887c10f36f18c75a1b7de34`; `npm run check` — PASS
  (266 core, 133 server, 248 mobile). Not uploaded to Google Play yet
- [X] "Stop sharing" in the viewer is shown only on the message the running share edits, not on
  an older live card left behind when a share was cut off by a reinstall or kill
- [X] Emulator check of the 1.0.28 store AAB (one emulator; the second one failed to boot for
  lack of memory): contacts permission → list → search by number → send; map preview in
  bubbles; live share pin moves in the bubble and in the full-screen viewer as the emulator
  GPS moves
- [ ] Not checked: a second device receiving live edits, physical phones, live sharing with the
  app in the background

# Release 1.0.27 / code41 — Google Play internal testing (2026-11-16)

- [X] `artifacts/LastCall-1.0.27-store.aab` (ignored binary), sha256
  `260f3e7db64f595f2c6ad93351eb521ec078884788a151ecfd6e1227c7096718`; published to the internal
  track as "LastCall 1.0.27 internal", status "Доступен внутренним тестировщикам"
- [X] Release-only startup crash found in the smoke test and fixed: R8 stripped the generated
  `WorkDatabase` constructor (androidx.work/Room, pulled in by react-native-maps) →
  "Failed to create an instance of class androidx.work.impl.WorkDatabase". Fixed with a
  `-keep class * extends androidx.room.RoomDatabase { <init>(); }` rule added by config plugin
  → Artifacts: [withRoomKeep.cjs](apps/mobile/plugins/withRoomKeep.cjs), [room-keep-plugin.test.ts](apps/mobile/tests/room-keep-plugin.test.ts)
- [X] A point picked on the map was sent with 14-15 decimals and arrived as plain text, not a
  card. Coordinates are now rounded to 6 decimals on send, and the parser accepts full precision
  so already-sent points render as cards
  → Artifacts: [location-contact.ts](apps/mobile/src/location-contact.ts), [location-contact.test.ts](apps/mobile/tests/location-contact.test.ts)
- [X] Gates: `npm run check` — PASS (266 core, 133 server, 244 mobile); `npm run build:aab` — PASS
- [X] Smoke test of this exact AAB (bundletool universal APK, upload-key signed) on two
  emulators: startup, chat opens at newest messages (voice note renders in the inverted list),
  quoted reply delivered, map tiles render, location card opens Google Maps
- [ ] Play warns that 7 previously supported devices (2 phones, 5 tablets) are dropped:
  the bundle now requires `glEsVersion 0x00020000` (react-native-maps) and likely the implied
  `android.hardware.location.gps` feature from the location permission. Declare the location
  features `required="false"` in the next build
- [ ] Maps key: add the Play App Signing SHA-1 to the key's Android restriction if not done yet,
  otherwise Play-installed builds may show a grey map (only the upload-key build was checked)
- [ ] Physical phones, contact picker with real contacts, live location in the background

# Quoted replies and newest-first chat loading (msg-2z1)

Both mobile-only, no core/protocol change.

- [X] Reply: same text-message convention as location/contact
  (`↩️ message|file:<author>:<id>\n<body>`) — an old client shows the marker line as plain
  text with the body fully readable below it; a current client parses it, shows a
  Telegram-style quote chip (author + live-looked-up snippet) above the bubble and above the
  composer while replying, and can tap it to jump to the quoted message
  → Artifacts: [reply.ts](apps/mobile/src/reply.ts), [ReplyChip.tsx](apps/mobile/src/components/ReplyChip.tsx), [chat screen](apps/mobile/src/app/chat/%5Bid%5D.tsx), [MessageActions.tsx](apps/mobile/src/components/MessageActions.tsx)
  Editing a reply keeps its quote; the quote is excluded from chat translation.
- [X] Chat opens already showing the newest messages (`FlatList inverted`, newest-first data)
  instead of rendering the whole history from the top and jumping down with `scrollToEnd`
- [X] Gates: `npm run check` — PASS, 242 mobile unit tests (8 new: 7 for `reply.ts`, 1 for the
  location/contact edit-lock interaction with `reply`); core/server unaffected (no core change)
- [X] Emulator (dev-client, same debug-signed build as msg-jd3; user supplied a second email
  restore code to get a registered test account again): caught and fixed a real bug —
  `inverted`'s `ListEmptyComponent` rendered the empty-chat text upside down (a known RN
  quirk). Fixed by rendering the empty state as a plain sibling instead of a FlatList prop,
  not by fighting the transform. After the fix: sent messages land at the bottom without a
  jump; long-press → Reply → the quote chip shows the correct author and snippet on send;
  editing a reply shows only its body in the composer and keeps the quote after saving; no
  crashes. Tap-to-scroll-to-quoted was exercised but not provably tested (the quoted message
  was already on screen in this short test history).
- [ ] Physical phones; a longer history to actually exercise scroll-to-quoted-message and
  day-pill positioning while scrolling; images/video inside the inverted list (only text
  messages were sent in this test — RN's per-cell counter-flip is supposed to cover any
  content uniformly, but only text was actually seen upright)

# Location and contact sharing (msg-jd3)

Mobile-only, like Telegram's attach menu: no core/protocol change, no stored-state version
bump — a location or contact is a plain text message in a recognizable, backward-compatible
shape (`apps/mobile/src/location-contact.ts`).

- [X] One-time location (drop/drag a pin or send current position) and live location
  (15 min / 1 h / 8 h) updated by editing the same message through the existing
  `MessageChange` mechanism; throttled client-side (20s floor, 15m move, 60s forced refresh)
  → Artifacts: [picker](apps/mobile/src/components/LocationPicker.tsx), [live manager](apps/mobile/src/live-location.ts), [model](apps/mobile/src/live-location-model.ts), [global bar](apps/mobile/src/components/LiveLocationBar.tsx)
- [X] Contact sharing via the system contact picker (`presentContactPickerAsync`) — no
  `READ_CONTACTS`, `blockedPermissions` untouched
  → Artifacts: [contacts.ts](apps/mobile/src/contacts.ts)
- [X] Chat bubble cards, attachment-menu icons, excluded from chat translation
  → Artifacts: [cards](apps/mobile/src/components/LocationContactCard.tsx), [chat screen](apps/mobile/src/app/chat/%5Bid%5D.tsx)
  [Контракт](docs/LOCATION-CONTACT.md)
- [X] Gates: `npm run check` — PASS, 247 mobile unit tests (13 new), core/server unchanged at
  266/133; `npm run test:e2e` not affected (no core change)
- [X] Native: `expo prebuild` + `gradlew :app:assembleDebug` — BUILD SUCCESSFUL with
  `react-native-maps`/`expo-location`/`expo-task-manager`/`expo-contacts` linked; manifest
  confirmed `ACCESS_FINE_LOCATION`/`FOREGROUND_SERVICE_LOCATION` present, no
  `ACCESS_BACKGROUND_LOCATION`, `READ_CONTACTS`/`WRITE_CONTACTS` still `tools:node="remove"`
- [X] Dev-client smoke test on an Android emulator caught a real bug before release: the new
  global live-location bar's `useSyncExternalStore` snapshot returned a fresh object every
  call, causing "Maximum update depth exceeded" on every screen. Fixed by caching the
  snapshot; rebooted cleanly afterward with no render error.
  → Correction (2026-11-16): the debug build is a separate package
  (`dev.messenger.prototype`); the store app `ru.lastcall.app` with the existing test
  identities on both emulators was never touched.
- [X] User created `LASTCALL_ANDROID_MAPS_API_KEY` and saved it to
  `~/.config/lastcall/android-maps-api-key.txt`; both build scripts now read it from there
  automatically when the env var isn't already exported
  → Artifacts: [infra/build-android-release.sh](infra/build-android-release.sh), [infra/build-android-store.sh](infra/build-android-store.sh)
- [X] `expo prebuild` confirmed the key lands in `AndroidManifest.xml`'s
  `com.google.android.geo.API_KEY` meta-data; rebuilt the debug APK with it
- [X] Registered a throwaway test account on emulator-5560 (user supplied the email
  confirmation code) and opened a real chat via "All server users" to reach the Location
  picker. `adb logcat` gave the real root cause directly from Google: "Authorization
  failure" — the Maps SDK rejected the request because the SHA-1 Android was signing with
  did not match any fingerprint on the key yet.
  → The debug APK is signed with **this repo's own checked-in debug keystore**
  (`apps/mobile/android/app/debug.keystore`, generated fresh by every `expo prebuild`), not
  `~/.android/debug.keystore` — the SHA-1 in the earlier setup instructions was the wrong
  keystore. The real one: `5E:8F:16:06:2E:A3:CD:2C:4A:0D:54:78:76:BA:A6:F3:8C:AB:F6:25`
  for package `dev.messenger.prototype`. User needs to add this fingerprint (alongside the
  upload-key one already added) in the Maps key's Android restrictions; tile rendering
  itself is otherwise confirmed working end-to-end (Maps SDK initialized, key read
  correctly, only the cert allow-list is missing an entry).
  → Side effect: this used one of the user's email confirmation codes for a second
  throwaway test account (`@mapstest1113`) on emulator-5560.
- [ ] Physical phones: live location across OEM battery optimizers (no headless resume after
  a full process kill — documented, not tested), the contact picker on a real device, iOS
  (Apple Maps path never built/run, only type-checked)
- [ ] Not released to any test track yet; no version bump

# Grouped message notifications, cleared on app entry (msg-45p)

Status: 1.0.26/code40 published to Google Play internal testing on 2026-11-12; `LastCall 1.0.26 closed` (Alpha, 100%, no devices lost) passed the pre-review check and was sent to Google review (1.0.25 closed, approved, stays live until then). AAB sha256 818e5b11…dc38d587; the exact AAB was emulator-tested first.

- [X] One notice per chat (MessagingStyle, earlier lines read back from the shown notice, no text on disk), group summary, dedup IDs kept in the notice extras
  → Artifacts: [native](apps/mobile/plugins/notifications/LastCallNotificationsModule.java), [JS](apps/mobile/src/push-previews.ts), [strings](apps/mobile/plugins/strings/values/lastcall_strings.xml)
- [X] Opening the app clears message notices only (calls and delivery progress stay); nothing is cleared while the phone is locked
  → Artifacts: [bridge](apps/mobile/src/components/NotificationNavigationBridge.tsx)
- [X] Gates: mobile typecheck, lint, 221 tests; Android 16 emulators: 2 DMs + 1 group message stack as 2 chats under one header, launcher open clears all, a later message starts a fresh notice, tapping it opens the chat
- [ ] Physical phones (vivo/Samsung shades), the locked-phone case, a missed FCM preview path

# Answer on the lock screen and silence other calls (msg-byd follow-up, 1.0.25)

Status: 1.0.25/code39 published to Google Play internal testing on 2026-11-11; `LastCall 1.0.25 closed` (Alpha, 100%) passed pre-review checks and is in Google review (1.0.24 closed stays live until then). AAB sha256 4990e519…bcc43cc8, no devices lost; emulator-tested.

- [X] After answering on the call-only screen, the app's call view opens over the keyguard until the call ends
  → Artifacts: [helper](apps/mobile/plugins/calls/LastCallLockScreen.java), [hand-off](apps/mobile/plugins/calls/LastCallAudioService.java), [plugin](apps/mobile/plugins/withLastCallCalls.cjs), [tests](apps/mobile/tests/lock-screen-answer.test.ts)
- [X] Minimizing the call on a locked phone asks for unlock first; locking the phone during a call re-expands it
  → Artifacts: [overlay](apps/mobile/src/components/CallOverlay.tsx)
- [X] Answer sets the Telecom connection active at once (hold capabilities) and takes voice-call audio focus
  → Artifacts: [activity](apps/mobile/plugins/calls/LastCallCallActivity.java), [routes](apps/mobile/plugins/calls/LastCallAudioRoutes.java)
- [X] Gates: mobile 221, server 133, core 266, e2e 16 PASS / 1 skip
- [X] Emulators: PIN-locked phone answers, call UI over keyguard, minimize shows PIN prompt, relock + wake shows the call, end returns to keyguard; active GSM call goes ON_HOLD when LastCall is answered
- [ ] Physical: vivo X200 Ultra lock screen; WhatsApp/Telegram call during a LastCall answer

# File storage up to 10 GiB (msg-dlz follow-up, 1.0.24)

Status: 1.0.24/code38 published to Google Play internal testing on 2026-11-11; `LastCall 1.0.24 closed` (Alpha, 100%) passed pre-review checks and is in Google review (1.0.22 closed was approved and stays live until then). AAB sha256 cc0b871c…f595d, no devices lost; emulator-tested.

- [X] Split the outbox (16 waiting own files) from storage (2000 files / 10 GiB); state limit 16 MiB
  → Artifacts: [core](packages/core/src/messenger.ts), [tests](packages/core/src/outbox.test.ts), [contract](docs/OUTBOX-CONTRACT.md)
- [X] Android stores blobs as bytes (`.bin`, half the disk of hex JSON), legacy `.sealed` readable; keep 512 MB free
  → Artifacts: [format](apps/mobile/src/attachment-file-model.ts), [adapter](apps/mobile/src/storage.ts), [tests](apps/mobile/tests/attachment-file.test.ts)
- [X] Gates: mobile 217, server 133, core 266, e2e 16 PASS / 1 skip
- [X] Emulator: upgrade 1.0.23 → 1.0.24, legacy file opens, new received voice note stored and opens, survives restart
- [ ] Measure state write time with thousands of file records on a real phone; per-file 5 MiB limit unchanged

# Storage, translation, settings pages, compact actions, permission hints (1.0.23)

Status: 1.0.23/code37 published to Google Play internal testing on 2026-11-11 (AAB sha256 07c123c2…c4e658, no devices lost); emulator-tested. Closed track stays on 1.0.22 (in review).

- [X] Data and storage: one folder per chat, open/delete file, delete folder, clear all, irreversible warning (msg-ese)
  → Artifacts: [model](apps/mobile/src/storage-model.ts), [folders](apps/mobile/src/app/settings/storage/index.tsx), [folder](apps/mobile/src/app/settings/storage/[id].tsx), [tests](apps/mobile/tests/storage-translation-permissions.test.ts)
- [X] Icon + label actions: bottom-sheet chat and message menus, compact settings actions (msg-cu9)
  → Artifacts: [components](apps/mobile/src/components/ui.tsx), [safety menu](apps/mobile/src/components/SafetyMenu.tsx), [message menu](apps/mobile/src/components/MessageActions.tsx)
- [X] Translate chat to my language with on-device ML Kit language ID + translation (msg-p51)
  → Artifacts: [runtime](apps/mobile/src/chat-translation.ts), [model](apps/mobile/src/chat-translation-model.ts), [native](apps/mobile/plugins/calls/LastCallCaptionsModule.java), [language](apps/mobile/src/app/settings/language.tsx)
- [X] Settings grouped into sub-pages (msg-ffh)
  → Artifacts: [main](apps/mobile/src/app/(tabs)/settings.tsx), [pages](apps/mobile/src/app/settings/)
- [X] Refused camera/microphone/photos: notice with a button to the app's system settings (msg-e9i)
  → Artifacts: [notice](apps/mobile/src/components/PermissionNotice.tsx), [store](apps/mobile/src/permission-notice.ts), [WebRTC hook](apps/mobile/src/native.ts)
- [X] Gates: mobile 214, server 133, core 265, e2e 16 PASS / 1 skip
- [X] Emulators: storage delete removes the voice note from the chat; English → Russian translation; denied mic for recording and calls shows the notice, settings button opens App info, notice clears after granting
- [X] Publish `LastCall 1.0.23 internal` (owner: internal only for now)
- [ ] Physical phones

# Haptics and in-chat sounds (msg-bd1, branch `feat/delivery-requests`)

Status: 1.0.22/code36 published to Google Play internal testing on 2026-11-11; `LastCall 1.0.22 closed` (Alpha, 100%) passed pre-review checks and is in Google review. AAB sha256 a8bd4eea…76d0f9; emulator-tested.

- [X] Feedback model (incoming baseline, open-chat cue, call connect/end, throttle) with tests
  → Artifacts: [model](apps/mobile/src/feedback-model.ts), [runtime](apps/mobile/src/feedback.ts), [tests](apps/mobile/tests/feedback.test.ts)
- [X] Haptics via expo-haptics (Android system haptics); native SoundPool sounds without audio focus, muted on silent/vibrate and in calls
  → Artifacts: [native](apps/mobile/plugins/notifications/LastCallNotificationsModule.java), [sounds generator](infra/generate-ui-sounds.mjs), [settings](apps/mobile/src/components/FeedbackSettings.tsx)
- [X] Gates: mobile 208, server 133, core 265, e2e 16 PASS / 1 skip
- [X] Two Android emulators upgraded 1.0.21 → 1.0.22: sent/incoming SoundPool started, nothing on vibrate mode, long press gave LONG_PRESS haptic
- [X] Publish `LastCall 1.0.22 internal` (internal track) and save `LastCall 1.0.22 closed` (Alpha, 100%, no device support lost), send it for review
- [ ] Physical phones: loudness of the sounds, haptic strength on vivo

# Message reactions (msg-7ek, branch `feat/delivery-requests`)

Status: published to Google Play internal testing as 1.0.21/code35 on 2026-11-10 (AAB sha256 2b3e5a3b…f35425); emulator-tested. Contract: [docs/REACTIONS-CONTRACT.md](docs/REACTIONS-CONTRACT.md).

- [X] Signed `message-reaction` records, SDP marker, storage version 7, relay and trimming in core
  → Artifacts: [record](packages/core/src/message-reaction.ts), [client](packages/core/src/messenger.ts), [tests](packages/core/src/message-reaction.test.ts), [e2e](tests/e2e/outbox-sync.spec.ts)
- [X] Emoji row in the message menu, pills under messages and files
  → Artifacts: [components](apps/mobile/src/components/Reactions.tsx), [model](apps/mobile/src/reaction-model.ts), [tests](apps/mobile/tests/reactions.test.ts), [chat](apps/mobile/src/app/chat/[id].tsx)
- [X] Gates: core 265, server 133, mobile 201, e2e 16 PASS / 1 skip
- [X] Two Android 16 emulators on a store-flavor build: set, add the same, take back while the other app was force-stopped; arrives on reopen
- [ ] Physical phones, groups on a device, mixed with 1.0.20 (older side must receive nothing and show no error)

# Edit and delete messages, chats and contacts (msg-n9n, branch `feature/email-recovery`)

Status: test build only. Contract: [docs/MESSAGE-CHANGE-CONTRACT.md](docs/MESSAGE-CHANGE-CONTRACT.md).

- [X] Signed message changes, tombstones, hidden chats, contact removal in core
  → Artifacts: [core](packages/core/src/message-change.ts), [tests](packages/core/src/message-change.test.ts), [e2e](tests/e2e/outbox-sync.spec.ts)
- [X] Message menu, edit mode, delete chat and contact, "My contacts" section (not yet run on a device)
  → Artifacts: [menu](apps/mobile/src/components/MessageActions.tsx), [model](apps/mobile/src/message-actions-model.ts), [chat](apps/mobile/src/app/chat/[id].tsx)
- [X] Gates: `npm run check` (245 core, 116 server, 154 mobile), `npm run test:e2e` 15 PASS / 1 skip
- [X] Publish test build 1.0.11/code25, not offered through `latest.json`
  → Artifacts: [APK](https://p2p.lienad.ru/download/LastCall-1.0.11.apk), [details](artifacts/README.md)
- [X] New client connects to 1.0.9 on native Android: emulator check, messages and calls both ways (msg-5a9)
  → Artifacts: [report](docs/reports/debugging/2026-11/native-1012.md)
- [X] Fix signaling queue stall after a peer restart, about 30 s (msg-abo)
  → Artifacts: [session](packages/core/src/session.ts), [test](packages/core/src/data-ready.test.ts)
- [X] Fix CI, red since 2026-10-27: camera patch on clean checkout, missing ripgrep, hour-aligned quota tests (msg-km1)
  → Artifacts: [plugin](apps/mobile/plugins/withPersistentCircleCamera.cjs), [workflow](.github/workflows/check.yml), [tests](apps/server/test/services.test.ts)
- [X] Build and publish test APK 1.0.12/code26, build AAB, upload draft releases to Play
  → Artifacts: [APK](https://p2p.lienad.ru/download/LastCall-1.0.12.apk), [details](artifacts/README.md)
- [ ] Physical test on two phones with 1.0.12
- [ ] Owner: App access attestation, send Play changes for review, publish the internal draft (msg-2o0)

# Email registration and account recovery (msg-3zf, branch `feature/email-recovery`)

Status: server deployed with `EMAIL_REQUIRED` off, client in test builds only. Contract: [docs/EMAIL-RECOVERY-CONTRACT.md](docs/EMAIL-RECOVERY-CONTRACT.md).

- [X] Core protocol and one-shot helpers
  → Artifacts: [core](packages/core/src/email-auth.ts), [tests](packages/core/src/email-auth.test.ts)
- [X] Server: keyed address hash, codes, proofs, atomic account move, contact notice
  → Artifacts: [server](apps/server/src/email-auth.ts), [tests](apps/server/test/email-auth.test.ts)
- [X] Privacy policy, terms and store listing text
  → Artifacts: [privacy](infra/public/privacy.html), [terms](infra/public/terms.html), [store guide](store/PLAY-CONSOLE.md)
- [X] Mobile onboarding, settings, reminder and chat banner (not yet run on a device)
  → Artifacts: [onboarding](apps/mobile/src/app/onboarding.tsx), [flow model](apps/mobile/src/email-flow-model.ts), [tests](apps/mobile/tests/email-flow-model.test.ts)
- [X] Gates: `npm run check` (220 core, 116 server, 150 mobile), `npm run test:e2e` 11 PASS / 1 skip
- [X] Free mail provider Brevo: domain records in Cloudflare, SMTP key in `infra/.env.public-services` (msg-60q)
- [X] Server deployed from this branch on 2026-11-04 with `EMAIL_REQUIRED` off; rollback image `messenger-signaling:rollback-1.0.9`, database backup on the same volume
- [X] Real letter: reached a narod.ru inbox from `noreply@lienad.ru`, the code was accepted and refused on replay; no account created
- [X] Publish test build 1.0.10/code24, not offered through `latest.json`
  → Artifacts: [APK](https://p2p.lienad.ru/download/LastCall-1.0.10.apk), [details](artifacts/README.md)
- [X] Forward `admin@lienad.ru` through Cloudflare Email Routing; MX, SPF and DKIM checked over DoH on 2026-11-04, the owner saw a letter from another mailbox arrive (msg-60q)
- [ ] Physical test: register, reinstall, restore, contact warning on a second phone
- [X] Set the policy's effective date, name Brevo, publish privacy and terms (2026-11-04); legal review still recommended
- [X] Update Play Data safety with the email address (saved, not yet sent for review)
- [ ] Check a real registration letter reaches Gmail before review; Google's reviewers need the code
- [ ] Release client, physical acceptance on reinstall, then `EMAIL_REQUIRED=1`

# LastCall 1.0.9 / code23: Play-package push, background delivery and calls fix

Status: root cause found. The server sent every FCM message with `restrictedPackageName: 'dev.messenger.prototype'`, so the Play package `ru.lastcall.app` (1.0.8) never received wake/preview/call pushes: no background delivery, notifications or incoming calls.

- [X] Remove package restriction from FCM messages (server fix also restores pushes for installed 1.0.8)
  → Artifacts: [providers](apps/server/src/providers.ts), [regression](apps/server/test/fcm-package.test.ts)
- [X] PiP host detection independent of applicationId (namespace differs in the store build)
  → Artifacts: [PiP](apps/mobile/plugins/pip/LastCallPip.java)
- [X] Redeploy signaling and build store AAB 1.0.9/code23
  → Artifacts: [AAB](artifacts/README.md), 41,617,605 bytes, SHA256 `a199b6c2ccbf8117e9b9fde389a553c17ee62dafcf603444f4d7030e25836996`
- [X] Upload AAB to the Alpha closed-testing track as `LastCall 1.0.9 closed`, rollout 100%; Google's pre-review check passed
- [X] Send the change for Google review (user, 2026-11-04)
- [X] Google approved `LastCall 1.0.9 closed` (listed as available to selected testers, 2026-11-04)
- [X] Publish `LastCall 1.0.9 internal` to the internal testing track (2026-11-04 11:57)
- [ ] Physical acceptance: closed app receives text, notification and incoming call

# LastCall 1.0.8 / code22: Google Play compliance (in progress)

Status: Play Console draft app created (app ID 4973089023189492670), store listing and app-content declarations filled, and 1.0.8/code22 published to the **internal testing** track as unreviewed. Testers are not added yet. Active-services declaration needs three demo video links; closed testing needs 12 testers for 14 days.

- [X] Add persisted local blocking and enforce it on calls/notifications
  → Artifacts: [core](packages/core/src/messenger.ts), [chat menu](apps/mobile/src/components/SafetyMenu.tsx), [settings](apps/mobile/src/app/(tabs)/settings.tsx)
- [X] Add authenticated server-side report metadata storage and community/terms pages
  → Artifacts: [server](apps/server/src/services.ts), [server handler](apps/server/src/directory.ts), [guidelines](infra/public/community.html), [terms](infra/public/terms.html)
- [X] Build store AAB `ru.lastcall.app` 1.0.8/code22 with upload key and fixed namespace
  → Artifacts: [namespace plugin](apps/mobile/plugins/withLastCallNamespace.cjs), [store guide](store/PLAY-CONSOLE.md)
- [X] Add Firebase Android app `ru.lastcall.app`, rebuild final AAB with FCM
  → Artifacts: [AAB](artifacts/README.md), 41,617,435 bytes, SHA256 `436b90a56289e6070f6d88a99b2a7187ec8dcd42351a641385b29bdedd8c635f`
- [X] Capture English/Russian emulator screenshots at 1080×1920 from store build
  → Artifacts: [en](store/screenshots/en/), [ru](store/screenshots/ru/)
- [X] Upload AAB to Play Console internal testing and fill Data safety/content rating
  → Internal release `LastCall 1.0.8 internal`, published unreviewed 2026-11-03
- [X] Record foreground-service demo videos and finish active-services declaration
  → [camera](https://p2p.lienad.ru/demo/lastcall-foreground-camera.mp4), [microphone](https://p2p.lienad.ru/demo/lastcall-foreground-microphone.mp4), [phone call](https://p2p.lienad.ru/demo/lastcall-foreground-phone-call.mp4)
- [X] Add internal tester `populizator@googlemail.com`
- [X] Configure closed-testing countries and release: Alpha is active in 178 countries/regions
- [ ] Reach 12 closed-testing testers and run 14 days (the dashboard showed 2 on 2026-11-04)
  → User will add testers (`store/PLAY-TESTING.md`)
- [ ] Add Russian store listing translation (AI-assets disclosure confirmed as not AI)

# LastCall 1.0.7 / code21: segmented circle camera switch (published, verified)

Status: verified on the affected Vivo X200 Ultra. Segment recording plus a local Media3 merge replaces reliance on one persistent CameraX recording surviving a lens rebind.

- [X] Record a separate circle segment around each lens switch and merge them into one MP4
  → Artifacts: [composer](apps/mobile/src/components/MediaComposer.tsx), [merge wrapper](apps/mobile/src/video-merge.ts), [native module](apps/mobile/modules/lastcall-video/)
- [X] Verify native merge on an Android API36 emulator with differently sized H.264/AAC clips
  → Artifacts: [instrumentation test](apps/mobile/modules/lastcall-video/android/src/androidTest/java/ru/lastcall/video/CircleMergerTest.kt)
- [X] Publish test candidate 1.0.7/code21
  → Artifacts: [APK](https://p2p.lienad.ru/download/LastCall-1.0.7.apk), 54,155,814 bytes, SHA256 `c771d655edbaa0373848ae5d45d83f755baa520e9976d286186bbfab9bebe3b1`

# LastCall 1.0.6 / code20: camera-switch candidate (published, superseded)

Status: superseded by 1.0.7. CameraX 1.7.0-rc01, pause/resume and rebind without an explicit `unbindAll` still stopped on the affected device.

- [X] Add CameraX 1.7.0-rc01 force-resolution and pause/resume persistent recording around rebind
  → Artifacts: [patch](apps/mobile/patches/expo-camera+58.0.14+persistent-circle-camera.patch), [plugin](apps/mobile/plugins/withPersistentCircleCamera.cjs), [JS guard](apps/mobile/src/components/MediaComposer.tsx)
- [X] Publish test candidate 1.0.6/code20
  → Artifacts: [APK](https://p2p.lienad.ru/download/LastCall-1.0.6.apk), 54,017,237 bytes, SHA256 `d9bdd0f02ac3b38cc710ed140ac1a9a72e8245331ea53c3e896cb4a582191450`

# LastCall 1.0.4 / code18: English-primary localization (published)

Status: **1.0.4/code18 is published**. English is the default UI language;
Russian is selected when the phone's primary locale is Russian. Store submission
is still pending.

- [X] JS localization with English fallback and Russian device-locale selection
  → Artifacts: [i18n](apps/mobile/src/i18n.ts), [entry](apps/mobile/index.js), [tests](apps/mobile/tests/i18n.test.ts)
- [X] Native Android call/notification strings and localized permission metadata
  → Artifacts: [resources](apps/mobile/plugins/strings/), [plugin](apps/mobile/plugins/withLastCallStrings.cjs), [locale files](apps/mobile/locales/)
- [X] Publish direct 1.0.4: APK, signed latest.json and metadata
  → Artifacts: [release record](artifacts/README.md), [APK](https://p2p.lienad.ru/download/LastCall-1.0.4.apk), 53 967 857 bytes, SHA256 `ecc82e53fdbe835e42d9cdceff67b2b436fb16477d5d13fc829a40aa5b7c566e`

# LastCall 1.0.3 / code17: circle preview, camera continuity, emoji codes, store prep (published)

Status: **1.0.3/code17 is published** as a direct test build. Store publication is
prepared but not submitted; iOS/APNs and physical-device acceptance remain open.

- [X] Recorded-circle preview with playback and retake; CameraX 1.6.2 persistent-recording switch fix
  → Artifacts: [composer](apps/mobile/src/components/MediaComposer.tsx), [camera plugin](apps/mobile/plugins/withPersistentCircleCamera.cjs), [test](apps/mobile/tests/circle-camera-plugin.test.ts)
- [X] Five-emoji safety codes for chats and calls
  → Artifacts: [crypto](packages/core/src/content-crypto.ts), [safety modal](apps/mobile/src/components/SafetyCode.tsx), [call UI](apps/mobile/src/components/CallOverlay.tsx)
- [X] In-app account deletion and privacy policy
  → Artifacts: [server](apps/server/src/directory.ts), [services](apps/server/src/services.ts), [settings](apps/mobile/src/app/(tabs)/settings.tsx), [privacy](docs/PRIVACY-RU.md)
- [X] Store build mode, signing injection, store assets and release checklist
  → Artifacts: [config](apps/mobile/app.config.ts), [signing plugin](apps/mobile/plugins/withReleaseSigning.cjs), [store guide](docs/STORE-RELEASE.md), [assets](store/)
- [X] Publish direct 1.0.3: APK, signed latest.json and metadata
  → Artifacts: [release record](artifacts/README.md), [APK](https://p2p.lienad.ru/download/LastCall-1.0.3.apk), 55 083 537 bytes, SHA256 `4e8c457afff0467206bfa160083b4148db0ffe13a647fedcd089d5c5b57243a8`

# LastCall 1.0.2 / code16: E2E content, verified updates, server hardening (published)

Status: **1.0.2/code16 is published** with the existing test certificate. Both
peers must update before exchanging content; there is no plaintext fallback.
Independent QA and native acceptance on physical phones remain pending.

- [X] Session-level E2E content encryption for text/files/voice/circles/application frames (ephemeral X25519 + Ed25519-signed hello + HKDF + XChaCha20-Poly1305, replay rejection)
  → Artifacts: [cipher](packages/core/src/content-crypto.ts), [session](packages/core/src/session.ts), [tests](packages/core/src/content-crypto.test.ts), [session tests](packages/core/src/content-session.test.ts)
- [X] Safety number for direct chats and call verification code; persist verified contacts in encrypted state
  → Artifacts: [modal](apps/mobile/src/components/SafetyCode.tsx), [chat](apps/mobile/src/app/chat/[id].tsx), [call overlay](apps/mobile/src/components/CallOverlay.tsx), [state](packages/core/src/messenger.ts)
- [X] Signed update manifest, in-app APK download, SHA-256 verification and system installer
  → Artifacts: [signer](infra/sign-update-manifest.mjs), [manifest](infra/public/latest.json), [client](apps/mobile/src/updates.ts), [notice](apps/mobile/src/components/UpdateNotice.tsx)
- [X] Trust X-Forwarded-For only from configured proxies; per-IP limits and IPv6 /64 aggregation
  → Artifacts: [client-ip](apps/server/src/client-ip.ts), [server](apps/server/src/server.ts), [config](infra/compose.public.yaml), [tests](apps/server/test/client-ip.test.ts)
- [X] Clear plaintext preview/share caches; update Expo/RN/React and remove high advisories
  → Artifacts: [attachments](apps/mobile/src/attachments.ts), [layout](apps/mobile/src/app/_layout.tsx), [package](apps/mobile/package.json)
- [X] Publish 1.0.2: tests, APK, SHA256, signed manifest and metadata
  → Artifacts: [release record](artifacts/README.md), [APK](https://p2p.lienad.ru/download/LastCall-1.0.2.apk), 55 077 273 bytes, SHA256 `fbc3169483a469664f2fd6e7e9912b3f4a0853a16bab73524f37934d8e1777be`

# LastCall 1.0.1 / code15: first release (published)

Status: **1.0.1/code15 is published** with the existing test certificate. The
1.0.0 candidate and rc2 builds are superseded and were never final releases.
Independent QA and native acceptance on physical phones remain pending and are
not claimed. Prior 0.7.2 run is archived unchanged; no history reset.

- [X] Keep live video visible with native Android PiP and timed call controls (msg-huh)
  → Artifacts: [PiP plugin](apps/mobile/plugins/withLastCallPip.cjs), [PiP sources](apps/mobile/plugins/pip/), [PiP bridge](apps/mobile/src/call-pip.ts), [PiP model](apps/mobile/src/call-pip-model.ts), [controls model](apps/mobile/src/video-controls-model.ts), [panel](apps/mobile/src/components/CallOverlay.tsx), [PiP checks](apps/mobile/tests/with-last-call-pip.test.ts), [call UI checks](apps/mobile/tests/call-ui.test.ts)
- [X] Switch front/rear call camera and record a continuous Android circle across the switch (msg-unx)
  → Artifacts: [expo-camera patch](apps/mobile/patches/expo-camera+58.0.14+persistent-circle-camera.patch), [patch plugin](apps/mobile/plugins/withPersistentCircleCamera.cjs), [call camera](apps/mobile/src/call-camera.ts), [call camera model](apps/mobile/src/call-camera-model.ts), [composer](apps/mobile/src/components/MediaComposer.tsx), [patch checks](apps/mobile/tests/circle-camera-plugin.test.ts)
- [X] Fix failed call-audio switches and stale errors after successful routing (msg-kfr)
  → Artifacts: [audio bridge](apps/mobile/src/call-audio.ts), [audio model](apps/mobile/src/call-audio-model.ts), [native routes](apps/mobile/plugins/calls/LastCallAudioRoutes.java), [route checks](apps/mobile/tests/call-audio.test.ts), [call UI](apps/mobile/src/components/CallOverlay.tsx)
- [X] Fix incoming video showing the local camera for streamless remote tracks (msg-4s6)
  → Artifacts: [session](packages/core/src/session.ts), [client wiring](packages/core/src/messenger.ts), [native factory](apps/mobile/src/native.ts), [panel guard](apps/mobile/src/components/CallOverlay.tsx), [checks](packages/core/src/video.test.ts)
- [X] Register FCM wake and background sync without notification permission (msg-vtd)
  → Artifacts: [token](apps/mobile/src/notifications.ts), [push bridge](apps/mobile/src/components/PushBridge.tsx), [background task](apps/mobile/src/background-notifications.ts)
- [X] Publish first LastCall 1.0.1 with default endpoint p2p.lienad.ru (msg-oq0)
  → Artifacts: [release record](artifacts/README.md), [APK](https://p2p.lienad.ru/download/LastCall-1.0.1.apk), [phone tasks](docs/TESTING-RU.md), 54 995 081 bytes, SHA256 `a7d1f61d08ba13bc1dda168c831d58ea041ca3468a181c5af9a557c318aca41e`

# LastCall 0.7.2: voice waveform, mixed timeline and Android call audio (published 2026-10-31)

- [X] Real live microphone waveform with bounded history; recording/cancel lifecycle (msg-cmg)
  → Artifacts: [composer](apps/mobile/src/components/MediaComposer.tsx), [waveform](apps/mobile/src/components/RecordingWaveform.tsx), [level model](apps/mobile/src/waveform-model.ts), [checks](apps/mobile/tests/waveform.test.ts)
- [X] One chronological text/voice/file/photo/circle timeline; preserve new direct-file creation time through queue/restart/replay (msg-0tw)
  → Artifacts: [timeline](apps/mobile/src/timeline-model.ts), [chat](apps/mobile/src/app/chat/[id].tsx), [timing](packages/core/src/direct-file.ts), [queue regressions](packages/core/src/direct-file.test.ts), [timeline checks](apps/mobile/tests/timeline.test.ts)
- [X] Incoming/outgoing Android earpiece/speaker/connected-headset selection with observed state and stale-call guards (msg-5bn)
  → Artifacts: [call UI](apps/mobile/src/components/CallOverlay.tsx), [controller](apps/mobile/src/call-audio-model.ts), [native routes](apps/mobile/plugins/calls/LastCallAudioRoutes.java), [checks](apps/mobile/tests/call-audio.test.ts)

Implementation and gates verified: native Java/release/packaged FCM PASS; independent [QA1/6](docs/reports/testing/2026-10/media-audio/claude-qa-cycle-1.md),363unit/11browser PASS/1TURN skip; [focused native evidence](docs/reports/debugging/2026-10/native-072.md) covers observed speaker on incoming/outgoing direct calls, captured/delivered voice and mixed text/voice/file order. APK0.7.2/code12 published; all3fullHTTPS downloads match exact bytes/hash in [release record](artifacts/README.md). New run cap6; [old history preserved](docs/qa/runs/lastcall-060-qa-2026-10-30.json).

- [ ] Physical Android waveform response/heard quality and incoming/outgoing audio/video earpiece↔speaker/BT/wired hotplug; emulator has no earpiece/headset (msg-qlk)
  → Artifacts: [focused phone tasks](docs/TESTING-RU.md), [native limits](docs/reports/debugging/2026-10/native-072.md)
- [ ] iOS native audio-route adapter and signed-device acceptance; chooser currently hidden/unsupported (msg-uhw)
  → Artifacts: [mobile guide](apps/mobile/README.md)

Existing physical Pixel/Vivo video, Russian carriers/handover, DPI and iOS/APNs acceptance remains open (`msg-si6`, `msg-3z9`, `msg-9rr`).

# Claude QA configuration (msg-tan)

- [X] Dedicated risk-based tester, three required skills and documented six-cycle protocol
  → Artifacts: [prompt](docs/qa/lastcall-release-tester.md), [protocol](docs/qa/CLAUDE-TESTER.md)
- [X] Verify authenticated tester/settings: cycle2/6 PASS,264unit tests and9browser scenarios;1TURNskip
  → Artifacts: [counter](docs/qa/claude-qa-state.json), [cycle1 auth blocker](docs/reports/testing/2026-10/claude-qa-cycle-1.md), [cycle2 verified results](docs/reports/testing/2026-10/claude-qa-cycle-2.md)
- [X] Show actual local agent stages, six-cycle history and stale/disconnected evidence without raw traces (msg-mio)
  → Artifacts: [monitor](infra/qa/monitor.mjs), [panel](infra/qa/monitor.html), [focused checks](infra/qa/monitor.test.mjs), [verification](docs/reports/testing/2026-10/live-monitor.md), [run instructions](docs/qa/CLAUDE-TESTER.md#local-progress-panel)

# LastCall 0.7.1: authenticated call invite and stable video (published 2026-10-31)

- [X] Implement call invite, media gating, full-screen access and video stability (msg-d1e, msg-si6)
  → Artifacts: [wake contract](docs/WAKE-CONTRACT.md), [call-invite report](docs/reports/debugging/2026-10/call-invite-071.md)
- [X] Independent Claude QA cycles4–6/6: cycle4 full commands BLOCKED at280s; cycle5 source review PASS; cycle6 build/types/final-APK PASS (msg-tan)
  → Artifacts: [cycle4](docs/reports/testing/2026-10/claude-qa-cycle-4.md), [cycle5](docs/reports/testing/2026-10/claude-qa-cycle-5.md), [cycle6](docs/reports/testing/2026-10/claude-qa-cycle-6.md)
- [X] Guard Android push release across every Expo/Gradle stage with packaged FCM/version/code gate (msg-c5v)
  → Artifacts: [helper](infra/build-android-release.sh), ignored positive log `.tmp/current/native-071-cycle7/release.log`
- [X] Fix SDK58 `dataString:null` wrapper rejection; normalize only known null field, installed-serializer fixtures; 81mobile/10monitor PASS (msg-el9)
  → Artifacts: [cycle7](docs/reports/testing/2026-10/claude-qa-cycle-7.md), [mobile tests](apps/mobile/tests/call-pushes.test.ts)
- [X] Explicit owner approval added exactly one cycle7/7; history1–6 preserved, no cycle8 (msg-tan)
  → Artifacts: [cycle7 report](docs/reports/testing/2026-10/claude-qa-cycle-7.md)
- [X] Real Android17 native PASS: cold FCM PIN ring7.984s, answer16.527s, direct RTP active at66s from call start, cancel1.637s; publish0.7.1 and verify all3 exact downloads (main)
  → Artifacts: [native report](docs/reports/debugging/2026-10/native-071-cycle7.md), [release record](artifacts/README.md)
- [X] Historical pre-extension candidate3d native FAIL retained; local file moved to ignored `.tmp/current/native-071-cycle7/prior-cycle6.apk`
  → Artifacts: [historical FAIL report](docs/reports/debugging/2026-10/native-071.md)
- [ ] Physical Pixel/Vivo voice/video quality, Russian carriers/handover, DPI and iOS/APNs/CallKit remain open (msg-3z9, msg-9rr, msg-si6)
  → Artifacts: [phone tasks](docs/TESTING-RU.md); emulator audio was disabled, so heard speech is not claimed

# LastCall 0.7.0: background calls, read receipts and video

- [X] Refresh root/mobile README and linked wake/outbox status for published0.7.0, actual acceptance limits and current delivery/read behavior (msg-8vd)
  → Artifacts: [overview](README.md), [mobile guide](apps/mobile/README.md), [wake contract](docs/WAKE-CONTRACT.md), [outbox contract](docs/OUTBOX-CONTRACT.md)
- [X] Implement LastCall-owned incoming calls, automatic self-managed account and bounded call-specific background setup (msg-d1e)
  → Artifacts: [controller](apps/mobile/src/system-calls.ts), [native incoming UI](apps/mobile/plugins/calls/LastCallCallActivity.java), [native services](apps/mobile/plugins/calls/), [wake contract](docs/WAKE-CONTRACT.md)
- [X] Add durable signed P2P read receipts and clock/one-check/two-check indicators, including group and attachment progress (msg-3jo)
  → Artifacts: [signed receipts](packages/core/src/read-receipt.ts), [manager](packages/core/src/messenger.ts), [display model](apps/mobile/src/delivery-model.ts), [contract](docs/OUTBOX-CONTRACT.md)
- [X] Remove the permanent low-quality cap from missing bandwidth/high base RTT; preserve congestion adaptation and expose video measurements (msg-si6 implementation)
  → Artifacts: [policy](packages/core/src/video.ts), [transport](packages/core/src/session.ts), [policy regressions](packages/core/src/video.test.ts)
- [X] Claude QA cycle3/6:292unit tests, Chrome10PASS/1authenticated-TURNskip, lint/types/Android+iOS JS exports; same-certificate Android release build with forced bundle regeneration
  → Artifacts: [QA report](docs/reports/testing/2026-10/claude-qa-cycle-3.md), [persistent counter](docs/qa/claude-qa-state.json), [APK metadata](artifacts/README.md)
- [X] Focused emulator in-place upgrade preserves identity; own incoming activity above PIN, no pre-answer audio service, native expiry/reject cleanup
  → Artifacts: [native call sources](apps/mobile/plugins/calls/), [exact native evidence](docs/reports/debugging/2026-10/native-070.md)
- [X] API36 own-button locked answer with sustained bidirectional RTP beyond wake window; confirmed process-death/FCM cold-start own UI; publish0.7.0 and verify primary/alternate/preview exact bytes/hash
  → Artifacts: [native evidence and limits](docs/reports/debugging/2026-10/native-070.md), [release](artifacts/README.md), [phone tasks](docs/TESTING-RU.md)
- [ ] Physical phone UI/voice/video quality, Russian carriers/handover, OEM battery behavior and iOS/APNs/CallKit acceptance (msg-3z9, msg-9rr; msg-si6 physical acceptance)
  → Artifacts: [phone tasks](docs/TESTING-RU.md)

# LastCall 0.6.0: notifications, system calls and media (historical)

- [X] Pair-encrypted bounded text/file-name FCM previews with explicit capability and durable ACK separation (msg-l6n)
  → Artifacts: [crypto](packages/core/src/push-preview.ts), [provider](apps/server/src/providers.ts), [native evidence](docs/reports/debugging/2026-10/native-060.md)
- [X] Authenticated message/file notification tap opens the saved DM/group after restore (msg-05d)
  → Artifacts: [native routes](apps/mobile/plugins/notifications/LastCallNotificationsModule.java), [navigation](apps/mobile/src/components/NotificationNavigationBridge.tsx), [tests](apps/mobile/tests/notification-navigation.test.ts)
- [X] Android Telecom secure-lockscreen audio answer and independent live-call/headless timer ownership (msg-9sx)
  → Artifacts: [controller](apps/mobile/src/system-calls.ts), [native ownership](apps/mobile/plugins/calls/), [evidence](docs/reports/debugging/2026-10/native-060.md)
- [X] Foreground voice record/preview/send/delete and encrypted P2P file playback (msg-2kk)
  → Artifacts: [composer](apps/mobile/src/components/MediaComposer.tsx), [voice](apps/mobile/src/components/VoiceNote.tsx), [permission/cancel regressions](apps/mobile/tests/media.test.ts)
- [ ] User phone UI acceptance for circle finalize/playback and fullscreen/adaptive video (msg-46e, msg-si6)
  → Artifacts: [circle](apps/mobile/src/components/VideoNote.tsx), [fullscreen call](apps/mobile/src/components/CallOverlay.tsx), [adaptive policy](packages/core/src/video.ts), [regressions](packages/core/src/video.test.ts)
- [X] Remove retired stopped Docker TURN container after validating active native relay (msg-qa1)
  → Artifacts: [native runbook](infra/native-turn/README.md), [deployment](infra/public/README.md)
- [X] Independent review and final quality gates:264tests, Chrome9PASS/1TURNskip, Android release/R8 and iOS JS export
  → Artifacts: [review](docs/reports/code-reviews/2026-10/CR-2026-10-30-lastcall-060.md), [release](artifacts/README.md), [phone tasks](docs/TESTING-RU.md)
- [X] Publish same-certificate0.6.0/code9 and verify both public download hashes; UI acceptance handed to user by explicit request
  → Artifacts: [APK](https://lienad.ru/messenger/download/LastCall-0.6.0.apk), [phone tasks](https://lienad.ru/messenger/tasks.txt)
- [ ] Physical Android/Russian carriers, locked video-camera/OEM battery behavior and iOS/APNs/CallKit acceptance (msg-3z9, msg-9rr)

# Initial technical prototype (historical)

- [X] Shared authenticated signaling and WebRTC core (verified: 15 tests)
  → Artifacts: [core](packages/core/src/session.ts), [crypto](packages/core/src/crypto.ts)
- [X] Bounded signaling server and local TURN deployment recipe (verified server, Docker build)
  → Artifacts: [server](apps/server/src/server.ts), [infra](infra/README.md)
- [X] Android/iOS foreground client source; standalone Android APK verified
  → Artifacts: [mobile](apps/mobile/README.md), [APK record](artifacts/README.md)
- [X] Browser interoperability and media/file integration checks (5 passed; TURN still pending)
  → Artifacts: [integration checks](tests/e2e/messenger.spec.ts), [probe](apps/probe/README.md)
- [X] Architecture, threat model, runbook and follow-up issues
  → Artifacts: [architecture](docs/ARCHITECTURE.md), [README](README.md), [user testing](docs/TESTING-RU.md)
- [X] Review and quality gates; native Android release, TLS/WSS and APK download verified
  → Artifacts: [review](docs/reports/code-reviews/2026-10/CR-2026-10-27-prototype.md), [public deployment](infra/public/README.md)
- [X] Publish public HTTPS preview and Android installer
  → Artifacts: [app](https://p2p.lienad.ru/download/messenger-preview.apk), [tasks](https://p2p.lienad.ru/tasks.txt)

V0.1 follow-up is superseded by the later work below. TURN provisioning was
pending at that historical checkpoint; its completed external verification is
recorded in the current TURN section. Real-device feedback, iOS signing and
production protocol review remain in Beads.

# LastCall 0.2

- [X] Authenticated persistent directory and presence for all users (msg-4jw)
  → Artifacts: [directory](apps/server/src/directory.ts), [server tests](apps/server/test/directory.test.ts)
- [X] Independent P2P conversations, private small groups and encrypted local outbox (msg-r0o)
  → Artifacts: [manager](packages/core/src/messenger.ts), [three-client checks](tests/e2e/directory.spec.ts)
- [X] Familiar mobile chats/contacts/settings and global calls (msg-ymj)
  → Artifacts: [routes](apps/mobile/src/app/), [storage](apps/mobile/src/storage.ts)
- [X] Stable public gateway, LastCall APK and real normal-DNS verification (msg-9mf)
  → Artifacts: [gateway](infra/public/messenger-apex.caddy.inc), [release](artifacts/README.md), [testing tasks](docs/TESTING-RU.md)
- [X] Correct native camera/microphone permission plugin conflict (msg-gjz)
  → Artifacts: [config](apps/mobile/app.config.ts), [CI artifact checks](.github/workflows/check.yml)

V2 review: [report](docs/reports/code-reviews/2026-10/CR-2026-10-27-lastcall-v2.md).
Remaining work tracked in Beads; voice notes/group calls/push/ratchet/field networks
are separate tasks. Unsolicited-contact controls tracked msg-218.

# LastCall 0.2.1

- [X] Reproduce and correct missing-message delivery and stalled connections (msg-7v3)
  → Artifacts: [scope](docs/DELIVERY-FIX-CONTRACT.md), [delivery regressions](packages/core/src/delivery.test.ts)
- [X] Device contact sync/linking and application permission setup (msg-o0b)
  → Artifacts: [mobile](apps/mobile/src/), [scope](docs/DELIVERY-FIX-CONTRACT.md)
- [X] Native delivery evidence, final APK verification/publication and repository handoff
  → Artifacts: [release](artifacts/README.md), [testing tasks](docs/TESTING-RU.md)

# LastCall 0.3 implementation checkpoint (historical)

Phone verification/discovery was superseded by the user's 0.4 registration model.
Its former mobile paths were removed; implementation history remains in commit 907817b.

- [X] Strict phone/push service APIs, authenticated ICE and capability-aware wake
  → Artifacts: [core](packages/core/src/services.ts), [service tests](packages/core/src/services.test.ts)
- [X] Real SMS.ru/FCM adapters, bounded OTP/lookup/wake requests and persisted consent
  → Artifacts: [providers](apps/server/src/providers.ts), [services](apps/server/src/services.ts), [live contract tests](apps/server/test/services.test.ts)
- [X] Phone verification screens, consent-based phonebook hashes and conditional FCM
  → Artifacts: [historical phone screen](https://github.com/DV-Design/messenger-prototype/blob/907817b/apps/mobile/src/app/phone.tsx), [push](apps/mobile/src/components/PushBridge.tsx)
- [X] Locked production runtime/configuration, review and Android release build
  → Artifacts: [service setup](infra/public/SERVICES.md), [review](docs/reports/code-reviews/2026-10/CR-2026-10-28-services.md), [native evidence](docs/reports/debugging/2026-10/native-services.md)
- [X] Final APK download verification and public handoff (msg-s39)
  → Artifacts: [release record](artifacts/README.md), [phone testing tasks](docs/TESTING-RU.md)

# Required for working external services

## Active 0.5 delivery work

- [X] Firebase LastCall project and Android client configuration (server activation completed in0.5.1 below)
  → Artifacts: [setup checkpoint](infra/public/SERVICES.md)
- [X] Durable seven-day sender outbox for text and files, recipient persistence before ACK (msg-c0z, msg-row)
  → Artifacts: [manager](packages/core/src/messenger.ts), [regressions](packages/core/src/outbox.test.ts)
- [X] Authenticated group peer synchronization while original sender is offline (msg-c0z, msg-t02)
  → Artifacts: [signed records](packages/core/src/group-sync.ts), [real peer tests](tests/e2e/outbox-sync.spec.ts)
- [X] Network observer, bounded ten-second ICE/signaling recovery and explicit-leave compatibility (msg-3t3)
  → Artifacts: [contract](docs/NETWORK-HANDOVER-CONTRACT.md), [transport](packages/core/src/session.ts), [resume tests](apps/server/test/network-resume.test.ts)
- [X] Independent review, quality gates, Android artifact and publication
  → Artifacts: [review](docs/reports/code-reviews/2026-10/CR-2026-10-28-lastcall-05.md), [native evidence](docs/reports/debugging/2026-10/native-050.md), [release](artifacts/README.md), [APK](https://lienad.ru/messenger/download/LastCall-0.5.0.apk)

- [ ] Validate physical Android and iOS/APNs/system incoming calls (msg-3z9)
  → Artifacts: [push/wake audit and acceptance plan](docs/reports/debugging/2026-10/push-wake-2026-10-29.md), [provider setup](infra/public/SERVICES.md)
- [X] Audit missing push/wake: server credential absent, existing 0.5 tray/tap behavior and proposed bounded headless path
  → Artifacts: [read-only audit](docs/reports/debugging/2026-10/push-wake-2026-10-29.md)
- [X] Configure approved dedicated FCM-only account, external read-only credential and actual Android push
  → Artifacts: [configuration](infra/public/SERVICES.md), [native evidence](docs/reports/debugging/2026-10/native-051-push.md)
- [X] Implement bounded Android background P2P wake and durable no-tap text/small-file acceptance (msg-27d)
  → Artifacts: [task](apps/mobile/src/background-notifications.ts), [ownership](apps/mobile/src/wake-model.ts), [native evidence](docs/reports/debugging/2026-10/native-051-push.md)
- [X] Prevent initial native channel data loss with bilateral application readiness (msg-h3g)
  → Artifacts: [transport](packages/core/src/session.ts), [regressions](packages/core/src/data-ready.test.ts)
- [X] Review, final gates and same-certificate Android0.5.1/code7 release
  → Artifacts: [review](docs/reports/code-reviews/2026-10/CR-2026-10-29-background-push.md), [release](artifacts/README.md), [phone tasks](docs/TESTING-RU.md)
- [X] Retire phone registration/discovery requirement by user direction (msg-p7x)
- [X] Provision and validate reachable authenticated P2P relay fallback (msg-bcw)
  → Artifacts: [network choice](docs/NETWORK-CHOICE.md), [native deployment](infra/native-turn/README.md), [external evidence](docs/reports/code-reviews/2026-10/CR-2026-10-28-native-turn.md)
- [ ] Validate physical Russian operators, poor links and call handover (msg-9rr)

Firebase server FCM is configured and real Android emulator no-tap background
text/small-file delivery is verified in0.5.1. Physical Android acceptance,
iOS/APNs/system incoming calls remain tracked by msg-3z9. Firebase is needed for
notifications; username registration and server-directory sync do not need it.
SMS.ru is no longer required. Closed-app delivery remains pending; public TURN
is active and independently verified over UDP/TCP/TLS. Restart both 0.5 apps to
refresh ICE; the APK/version did not change for this server configuration.

# Public TURN fallback verified on the current server (msg-bcw)

- [X] Isolated authenticated relay configuration, private TLS copy and scoped certificate refresh
  → Artifacts: [deployment](infra/public/compose.turn.yaml), [runbook](infra/public/TURN.md), [refresh](infra/public/refresh-turn-cert.sh)
- [X] Independent configuration, TLS and LAN TCP allocation checks
  → Artifacts: [review and evidence](docs/reports/code-reviews/2026-10/CR-2026-10-28-turn-preparation.md)
- [X] User-applied router forwarding and native coturn after Docker Desktop UDP diagnosis
  → Artifacts: [native deployment](infra/native-turn/README.md), [relay review](docs/reports/code-reviews/2026-10/CR-2026-10-28-native-turn.md)
- [X] External UDP/TCP/TLS forced-relay text ACK, exact file bytes and bidirectional received audio RTP; authenticated production ICE enabled
  → Artifacts: [external run 40782070981](https://github.com/DV-Design/messenger-prototype/actions/runs/40782070981), [service configuration](infra/public/SERVICES.md)
- [ ] Automate certificate/public-IP maintenance before sustained deployment (msg-0aa)
- [ ] Review 32-allocation / 41-port capacity for a fully relayed eight-member mesh (msg-d05)

Only native Homebrew coturn 4.18.0 / `dev.lastcall.turn` is active; Docker
`lastcall-coturn` is stopped. Authenticated signaling now supplies 600-second
TURN credentials; anonymous GET `/ice` stays STUN-only. External relay evidence
does not replace physical Russian-operator tests (`msg-9rr`) or turn on FCM.

# LastCall 0.4: server usernames (msg-5oa)

- [X] Immutable unique username per installation key, canonical profile recovery
  → Artifacts: [contract](docs/USERNAME-CONTRACT.md), [server](apps/server/src/directory.ts)
- [X] Paginated server directory and Unicode login/name search
  → Artifacts: [core](packages/core/src/directory.ts), [contacts](apps/mobile/src/app/(tabs)/contacts.tsx)
- [X] Remove mobile phone binding and unnecessary phonebook permission
  → Artifacts: [mobile](apps/mobile/src/), [config](apps/mobile/app.config.ts)
- [X] Independent gates, Android upgrade, publication and pushed handoff
  → Artifacts: [release](artifacts/README.md), [testing tasks](docs/TESTING-RU.md)

# LastCall 0.4 additions: logo, permissions and wake (msg-8n8)

- [X] Edit supplied logo, reduce white margins and wire native launcher/splash
  → Artifacts: [icon](apps/mobile/assets/lastcall-icon.png), [provenance](apps/mobile/assets/README.md)
- [X] Automatic sequential native permission requests before registration
  → Artifacts: [gate](apps/mobile/src/components/PermissionSetupGate.tsx), [permissions](apps/mobile/src/permissions.ts)
- [X] Direct-first typed wake with short TTL, limits and cancelled/expired-call safety
  → Artifacts: [contract](docs/WAKE-CONTRACT.md), [core tests](packages/core/src/wake.test.ts), [server](apps/server/src/providers.ts)
- [X] Research similar projects, platform limits and architecture trade-offs
  → Artifacts: [study](docs/P2P-WAKE-RESEARCH-RU.md)
- [X] Final native evidence, public download verification and pushed checkpoint
  → Artifacts: [review](docs/reports/code-reviews/2026-10/CR-2026-10-28-lastcall-04.md), [release](artifacts/README.md)
