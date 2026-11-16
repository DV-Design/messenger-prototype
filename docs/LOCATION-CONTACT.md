# Location and contact sharing

Unlike reactions and message changes, this feature needed no new signed record, no SDP
capability marker and no stored-state version bump. A shared location or contact is an
ordinary text message whose text has a recognizable, backward-compatible shape — the
convention lives entirely in `apps/mobile/src/location-contact.ts`, with no `packages/core`
changes at all.

## Wire shape (mobile-only convention, not a core record)

- One-time location: `📍 <localized label>\nhttps://maps.google.com/?q=<lat>,<lng>`.
- Live location: the same shape with a `🔴` marker instead of `📍` while it is still updating,
  and `📍` again once it ends.
- Contact: `👤 <name>\n<phone>[\n<phone>…]` (up to 5 numbers).

Any app — including every LastCall version before this one — renders the text as-is: the
`https://maps.google.com/...` link is already auto-linked by `message-links.ts`'s existing
linkifier, so an old client shows ordinary tappable text. A current client additionally
recognizes the shape (`parseLocationText` / `parseContactText`) and renders a card instead
(`components/LocationContactCard.tsx`), and skips sending it to the chat-translation backend
(coordinates and phone numbers do not translate, and must not leave the device for a third
party unnecessarily).

## Location picker

`components/LocationPicker.tsx`: a full-screen map (`react-native-maps`; Apple Maps on iOS,
Google Maps on Android — Android needs `LASTCALL_ANDROID_MAPS_API_KEY` at build time, see
[STORE-RELEASE.md](STORE-RELEASE.md)). Tap or drag a pin anywhere, or recenter on the current
position; "Send this location" sends a one-time point.

## Live location

"Share live location" picks a duration (15 min / 1 h / 8 h, like Telegram) and starts
`live-location.ts`'s manager:

- The first point is sent as a normal text message. Every later point **edits that same
  message** through the existing `MessageChange` mechanism
  ([MESSAGE-CHANGE-CONTRACT.md](MESSAGE-CHANGE-CONTRACT.md)) — `editMessage` already
  collapses repeated edits of one message into a single stored change, so a multi-hour
  share does not grow local storage or the outbox per update.
- Updates are throttled client-side (`live-location-model.ts`): never sooner than 20s, and
  only early within that window if the point moved 15m+; otherwise forced at least once a
  minute. This is a local decision — it is not a protocol limit.
- Only one live share runs at a time, in any chat; starting another stops the previous one.
- Android: `expo-location`'s `startLocationUpdatesAsync` with `foregroundService` keeps the
  process alive with a visible, mandatory notification ("Sharing your location until HH:MM")
  for as long as the share runs. The app never requests `ACCESS_BACKGROUND_LOCATION` or
  "Always" location — only "while in use" plus the foreground-service permissions
  (`FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_LOCATION`). A global bar
  (`components/LiveLocationBar.tsx`, mounted in `_layout.tsx` next to the call bar) shows the
  same status and a Stop button from anywhere in the app.
- **Known limitation, stated plainly rather than tested**: if Android (or an OEM battery
  optimizer, or the person) kills the app process outright, the foreground service and the
  share stop with it — there is no headless re-launch after a full kill. This has not been
  verified on a physical phone across OEM skins.

## Viewing a location

The bubble (`LocationCard` in `components/LocationContactCard.tsx`) shows a `react-native-maps`
**lite-mode** map with the pin — rendered by the same Maps SDK and Android key as the picker,
not the Static Maps web API, so no second key is exposed. A live share also shows "updated N min
ago" from the message's `editedAt`. Tapping opens `LocationViewer`: a full-screen map that is
re-rendered from the current message on every snapshot change, so the pin moves as the sender's
edits arrive; the camera follows the pin until the person pans, and the target button resumes
following. The sender sees Stop sharing there too.

Sender side, `startLocationUpdatesAsync` uses `distanceInterval: 0` and a 10 s interval: with a
distance filter a phone standing still reports nothing, and the once-a-minute refresh above
never runs.

## Contact sharing

Since 1.0.28 contacts work like Telegram. On the first "Share contact" the app asks for
`READ_CONTACTS` (Android) / Contacts (iOS, `NSContactsUsageDescription`), then shows its own
searchable list of contacts that have a phone number (`contacts.ts` →
`Contact.getAllDetails([FULL_NAME, PHONES])`, `components/ContactPicker.tsx`). The list lives
only while the picker is open; nothing is uploaded or stored. The tapped contact is sent with
all its numbers (de-duplicated, up to 5). `WRITE_CONTACTS` stays in `blockedPermissions`.

1.0.27 used the system picker without the permission, but expo-contacts 58 turned the
top-level `presentContactPickerAsync` into a function that always throws, and both of its
Android APIs need `READ_CONTACTS` to read the picked contact anyway.

## Not implemented

Place search (Places API) for the map picker; sharing more than one live location at once.
