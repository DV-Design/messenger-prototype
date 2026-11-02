# LastCall — подготовка к Google Play и App Store

Статус: черновик подготовки. Ничего не отправлено в магазины; нужны аккаунты
разработчика, финальные идентификаторы, ключи подписи и юридическая проверка.

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
- Иконки для магазинов: `store/icon-512.png`, `store/icon-1024.png`,
  feature graphic: `store/feature-graphic.png`.
- Черновик описания: `store/listing-ru.md`.

## Android: Google Play

1. Создайте Google Play Console, аккаунт организации/разработчика. Заведите
   приложение с **финальным** package ID (например `ru.lastcall.app`).
   Это значение нельзя изменить после публикации. Зарегистрируйте Android app
   с этим package ID в Firebase-проекте LastCall и скачайте новый
   `google-services.json`; старый файл привязан к `dev.messenger.prototype` и
   Gradle откажется собирать store AAB с чужим package.
2. Создайте upload-keystore вне репозитория:
   ```sh
   mkdir -p ~/.config/lastcall/keystores
   keytool -genkeypair -v -keystore ~/.config/lastcall/keystores/upload.jks \
     -alias upload -keyalg RSA -keysize 4096 -validity 10000
   chmod 600 ~/.config/lastcall/keystores/upload.jks
   ```
   В JDK 21 keystore по умолчанию PKCS12: `-keypass` должен совпадать с
   `-storepass` (или создайте JKS через `-storetype JKS`). Иначе Gradle
   `signReleaseBundle` завершится ошибкой чтения ключа. Сохраните пароли и
   keystore в защищённом офлайн-бэкапе. Включите Play App
   Signing; этот ключ — upload key, не ключ подписи Google Play.
3. Соберите AAB:
   ```sh
   cd apps/mobile
   export LASTCALL_DISTRIBUTION=store
   export LASTCALL_ANDROID_PACKAGE=ru.lastcall.app
   export LASTCALL_IOS_BUNDLE_ID=ru.lastcall.app
   export LASTCALL_RELEASE_KEYSTORE="$HOME/.config/lastcall/keystores/upload.jks"
   export LASTCALL_KEYSTORE_PASSWORD='...'
   export LASTCALL_KEY_ALIAS=upload
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

## iOS: App Store

**На этой машине нет Xcode**, поэтому нативная iOS-сборка здесь невозможна.
Нужен Mac с Xcode либо EAS Build с аккаунтом Expo и Apple Developer.

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
