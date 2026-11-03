# Store screenshots

Captured from the 1.0.8 store-mode build (`ru.lastcall.app`) on Android API 36
emulators with demo display settings (1080×1920, fixed 09:41 clock). Test accounts
`@alex_morgan` and `@maria_petrova` are local to the emulators; the conversations
are test data. No diagnostics overlays or QA warnings are shown.

English (Play default):
- `en/01-chats.png` — chat list with direct chat and group.
- `en/02-chat-safety.png` — direct chat with delivery checks.
- `en/03-safety-code.png` — five-emoji safety code, marked verified.
- `en/04-safety-options.png` — block/report/community guidelines menu.
- `en/05-video-call.png` — incoming video call with call verification emoji.
- `en/06-settings.png` — profile, permissions and connection.

Russian (`ru-RU`):
- `ru/01-chats.png`
- `ru/02-chat-safety.png`
- `ru/03-safety-code.png`
- `ru/04-safety-options.png`
- `ru/05-video-call.png`
- `ru/06-settings.png`

All images are 1080×1920 PNG. Replace `06-settings.png` if the final Firebase build
changes the notifications section; do not publish screenshots that show
“Firebase client configuration is missing” or any QA/diagnostic text.

The emulator screenshots are functional UI evidence, not a claim of physical-device
camera/video quality. A physical-device set can replace them later without changing
the listing copy.
