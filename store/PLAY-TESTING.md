# Google Play testing plan (personal developer account)

The Play Console account is personal. Google requires **closed testing with at
least 12 testers who opted in and kept the app installed for 14 continuous
days** before production access for accounts created after 13 Nov 2023.
Internal testing alone does not satisfy this requirement.

## 1. Internal test (first upload)

1. Play Console → Create app → name LastCall, default language English (US),
   app/game App, free.
2. Upload the signed AAB under Testing → Internal testing.
3. Add 2–3 internal testers (your Google accounts) and install from the opt-in
   link. Verify the store build installs, registers `ru.lastcall.app`, connects,
   receives FCM, and passes the safety checks below.
4. Complete App content: privacy policy, app access, ads, content rating,
   target audience, Data safety, permission declarations.

## 2. Closed test (14 days)

1. Create a closed track and add at least 12 Google accounts as testers.
2. Send each tester the opt-in URL. They must install from Play and keep the app
   installed; uninstalling or never opting in does not count.
3. Keep the track active for 14 continuous days. Do not replace the track or
   reset testing during the period.
4. Record tester accounts and install dates outside the repository (do not
   commit personal emails).

Invitation template:

> Hi! I’m testing LastCall, a private messenger, before its Google Play release.
> Please join the closed test with this link, install the app from Google Play,
> and keep it installed for 14 days. You can use a secondary Google account.
> Link: <closed-test opt-in URL>
> The app creates a username locally; no phone or email is required inside the
> app. Feedback: admin@lienad.ru.

## 3. Store acceptance before production

On the Play-installed build:

- Register with a new username; terms and community guidelines are required.
- Send/receive text, file, voice note and video circle with a second account.
- Block a contact: their direct chat disappears; calls and notifications are
  suppressed; unblock from Settings → Blocked contacts.
- Report a contact/group: confirmation appears and a `moderation_reports` row is
  created on the server (operator check).
- Test incoming/outgoing calls, PiP, camera switch and video-circle switch.
- Delete the account and confirm the server profile is gone.
- Verify `REQUEST_INSTALL_PACKAGES` is absent and the updater section is absent
  in store mode.

## 4. Production

After the 14-day closed test, apply for production access in Play Console.
Google review may still take days. Keep the internal/closed tracks available for
rollback. Store updates replace the direct APK channel; direct builds remain a
separate package `dev.messenger.prototype`.
