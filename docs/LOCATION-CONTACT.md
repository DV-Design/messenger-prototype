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

## Contact sharing

`contacts.ts` calls `expo-contacts`'s `presentContactPickerAsync()` — the system contact
picker runs out of process (`ACTION_PICK` on Android, `CNContactPickerViewController` on
iOS) and hands back only the one contact chosen. **No `READ_CONTACTS` permission is
requested, and LastCall's own `blockedPermissions` entry for the phone's address book in
`app.config.ts` is untouched** — the app still never reads the contact list itself; sharing
a specific contact the person explicitly picked is a different thing from that boundary.

## Not implemented

Place search (Places API) for the map picker; a static-map thumbnail in the chat bubble
(it would need a second, separately-restricted Google key exposed to the client — the card
shows an icon and an "Open in Google Maps" link instead); sharing more than one live
location at once.
