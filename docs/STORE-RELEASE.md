# LastCall — подготовка к Google Play и App Store

Статус: идёт подготовка Android-публикации. Google Play Console зарегистрирован,
финальный package `ru.lastcall.app` закреплён, upload-ключ создан, store AAB
1.0.8/code22 собирается и проходит проверку упакованных констант. Добавлены
обязательные для Play механики UGC: блокировка, жалоба через сервер и принятие
условий/правил до регистрации. Ничего не загружено в магазин. Остались
Firebase-приложение под `ru.lastcall.app`, финальный AAB с FCM, скриншоты,
юридическая проверка и загрузка в Play Console. iOS по-прежнему заблокирован
отсутствием Xcode и APNs.

## Состояние инструментов на этой машине

Установлено: Node.js 24.22, npm 11.19, EAS CLI 27.2, Firebase CLI 15.34,
bundletool 1.18, watchman, CocoaPods 1.17, JDK 21, Android SDK/build-tools 37,
apkanalyzer/aapt2/apksigner. `node`, `java`, `keytool` добавлены в
`~/.local/bin`. Android AAB уже собирался с тестовым upload-ключом.

Не установлено и не может быть установлено автоматически:
- **Xcode** (нужен Apple ID, Mac App Store, 10+ ГБ): без него нет
  `xcodebuild`, iOS-сборки и `pod install` для iOS;
- аккаунт Apple Developer Program;
- APNs-ключ и настройки push для iOS;
- Firebase-приложение под финальный `ru.lastcall.app` (Google Play Console уже
  зарегистрирован, package ID закреплён).

## Что уже готово в репозитории

- Отдельный store-режим сборки: `LASTCALL_DISTRIBUTION=store`.
- В store-сборке отключены собственный APK-апдейтер и разрешение
  `REQUEST_INSTALL_PACKAGES` (политика Google Play).
- Пакет и bundle ID задаются только через переменные окружения; store-сборка
  падает, если они не заданы.
- Удаление аккаунта в приложении: **Настройки → Аккаунт → Удалить аккаунт**
  (профиль, push-согласия, ключ, контакты и история).
- Политика конфиденциальности: `docs/PRIVACY-RU.md` и публичная страница
  https://p2p.lienad.ru/privacy.html.
- Правила сообщества: https://p2p.lienad.ru/community.html;
  условия использования: https://p2p.lienad.ru/terms.html. Условия принимаются
  обязательной галочкой до регистрации.
- Блокировка контактов/участников групп и жалоба через меню «Безопасность» в
  каждом чате; жалобы хранятся на сервере как метаданные (без содержимого
  переписки), идентификатор заявителя обезличивается при удалении аккаунта.
- Иконки для магазинов: `store/icon-512.png`, `store/icon-1024.png`,
  feature graphic: `store/feature-graphic.png`.
- Черновики описаний: `store/listing-en.md`, `store/listing-ru.md`; ответы для
  Play Console и Data safety: `store/PLAY-CONSOLE.md`.

## Android: Google Play

1. Создайте Google Play Console, аккаунт организации/разработчика. Заведите
   приложение с **финальным** package ID `ru.lastcall.app` (подтверждён
   владельцем). Это значение нельзя изменить после публикации. Store-сборка
   использует его по умолчанию; direct-канал остаётся
   `dev.messenger.prototype`, чтобы не ломать обновления уже установленных
   тестовых сборок. Зарегистрируйте Android app
   с этим package ID в Firebase-проекте LastCall и скачайте новый
   `google-services.json`; старый файл привязан к `dev.messenger.prototype` и
   Gradle откажется собирать store AAB с чужим package.
2. Upload-keystore уже создан локально:
   `~/.config/lastcall/keystores/lastcall-upload.jks` (PKCS12), alias
   `lastcall-upload`; пароли — в `lastcall-upload.properties` (0600).
   **Сразу сделайте шифрованный офлайн-бэкап обоих файлов.** Для сборки:
   ```sh
   set -a; . ~/.config/lastcall/keystores/lastcall-upload.properties; set +a
   ```
   В JDK 21 keystore PKCS12: key password совпадает с store password. Если
   keystore утерян, Play App Signing позволяет заменить upload key; не
   публикуйте файл и не коммитьте properties. Этот ключ — upload key, не ключ
   подписи Google Play.
3. Соберите AAB:
   ```sh
   cd apps/mobile
   export LASTCALL_DISTRIBUTION=store
   export LASTCALL_ANDROID_PACKAGE=ru.lastcall.app
   export LASTCALL_IOS_BUNDLE_ID=ru.lastcall.app
   export LASTCALL_RELEASE_KEYSTORE="$HOME/.config/lastcall/keystores/lastcall-upload.jks"
   export LASTCALL_KEYSTORE_PASSWORD='...'
   export LASTCALL_KEY_ALIAS=lastcall-upload
   export LASTCALL_KEY_PASSWORD='...'
   export MESSENGER_GOOGLE_SERVICES_FILE="$HOME/.config/lastcall/google-services.json"
   npx expo prebuild --platform android --no-install
   cd android
   ./gradlew :app:bundleRelease -PreactNativeArchitectures=arm64-v8a \
     -Pexpo.camera.barcode-scanner-enabled=false
   ```
   AAB: `apps/mobile/android/app/build/outputs/bundle/release/app-release.aab`.
   Для проверки перед загрузкой соберите APK с теми же env и ключом, установите
   на физический телефон и пройдите `docs/TESTING-RU.md`.
4. В Play Console заполните Data safety:
   - собираются: имя, username, публичный ключ, user ID, IP/технические
     метаданные, push-токен, согласия;
   - содержимое сообщений/файлов/звонков серверу в открытом виде не передаётся;
   - данные шифруются в transit; удаление аккаунта доступно в приложении;
   - рекламы/аналитики/продажи данных нет.
   Укажите privacy URL и URL удаления (можно тот же privacy.html с описанием
   **Настройки → Аккаунт → Удалить аккаунт**).
5. Для production-store желательно убрать `expo-dev-client` из зависимостей:
   он добавляет dev launcher/menu и лишний размер; после удаления проверьте
   development-профиль отдельно. Для внутренней проверки можно оставить.
6. Объявите использование `USE_FULL_SCREEN_INTENT` как функцию входящих звонков.
   Проверьте итоговый manifest: `REQUEST_INSTALL_PACKAGES` в store-сборке быть не
   должно; `POST_NOTIFICATIONS`, `CAMERA`, `RECORD_AUDIO`, интернет — ожидаемы.
7. Загрузите AAB во внутренний тест, проверьте установку/обновление из Play,
   затем promoted testing → production. Публикация не автоматизирована.
   Для **личного** аккаунта Play, созданного после 13.11.2023, перед production
   нужен closed testing с не менее 12 тестировщиками, принявшими приглашение,
   в течение 14 непрерывных дней. Для организации это правило не действует;
   тип аккаунта нужно подтвердить в Play Console.
8. Проверьте, что сервер обновлён до сборки с обработкой жалоб (`report` /
   `report-received`). Без этого кнопка жалобы в store-клиенте получит ошибку;
   блокировка работает локально и от сервера не зависит.

## iOS: App Store

**На этой машине нет Xcode**, поэтому нативная iOS-сборка здесь невозможна.
Установите Xcode из Mac App Store, затем:
```sh
sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
sudo xcodebuild -runFirstLaunch
```
Либо используйте EAS Build с аккаунтом Expo и Apple Developer. Выполните
`eas login` и `firebase login` — сейчас CLI не авторизованы.

Обязательные шаги до отправки:

- Apple Developer Program, App ID и bundle ID (обычно совпадает с Android package),
  сертификаты и provisioning через EAS/Xcode.
- APNs: **сейчас push на iOS не реализован** (в `apps/mobile` нет APNs-пути и
  CallKit). Это блокер для полноценного мессенджера; до публикации нужно
  реализовать APNs/background notifications либо явно сузить обещания продукта.
- Скриншоты iPhone 6.7"/6.9", иконка 1024×1024 без прозрачности, privacy URL,
  support URL, возрастной рейтинг, категория Social Networking.
- App Privacy: профиль, идентификаторы, IP/диагностика, push-токен; без трекинга
  и рекламы. Заполнить в App Store Connect.
- Export compliance: приложение использует собственные E2E-примитивы (X25519,
  Ed25519, HKDF, XChaCha20-Poly1305). Не ставьте автоматически
  `ITSAppUsesNonExemptEncryption=false`; определите применимую категорию с
  юристом и заполните App Store Connect. Для store-сборки конфиг намеренно не
  устанавливает этот ключ.
- Privacy manifest (`PrivacyInfo.xcprivacy`) и описания разрешений должны
  соответствовать реальным API; проверить на собранном бинарнике.
- Аккаунт-делет: реализовано в приложении; приложите инструкцию для ревью.
- E2E-шифрование: App Review может запросить объяснение; подготовьте краткое
  описание протокола и ограничений (нет аудита/Double Ratchet).

Команда EAS (после `npx eas-cli login` и настройки секретов):
```sh
cd apps/mobile
npx eas-cli build --platform ios --profile production
npx eas-cli submit --platform ios --profile production
```

## Языки

Приложение основное на английском; русский включается, если основной язык телефона — русский. Для магазинов подготовить английский и русский листинги/скриншоты; базовый русский черновик — `store/listing-ru.md`.

## Общие блокеры перед магазинами

- Финальные package/bundle ID и аккаунты разработчика.
- Release upload key + шифрованный офлайн-бэкап; ключ подписи APK-канала
  остаётся отдельным тестовым.
- iOS APNs/CallKit и нативная приёмка на физических iPhone.
- Юридическая проверка privacy policy и export compliance.
- Независимый аудит клиентской криптографии (сейчас его нет).
- Проверка аккаунт-делета на реальном сервере и в store-сборке.
- Скриншоты и feature graphic из финальной сборки; текущие QA-снимки не
  использовать как маркетинговые.
