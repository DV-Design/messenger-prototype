# LastCall · Android и iOS

Версия 0.2.0: светлый мобильный интерфейс со стандартными системными шрифтами, вкладками «Чаты», «Контакты», «Настройки», личными диалогами и группами до 8 участников. Основной сервер: `https://lienad.ru/messenger`. Старый package ID `dev.messenger.prototype` сохранён; Android versionCode 2 позволяет обновить APK поверх предыдущего с той же подписью.

## Запуск и проверка

Из корня монорепозитория после `npm install`:

```sh
npm run typecheck -w @messenger/mobile
npm run lint -w @messenger/mobile
npm run build -w @messenger/mobile
```

`build` экспортирует JavaScript и ресурсы Android/iOS в `apps/mobile/dist`, не создаёт APK/IPA и не проверяет нативное исполнение. Expo Router использует `src/app` и `expo-router/entry`. Приложение требует собственную native/dev-сборку: Expo Go не включает WebRTC.

```sh
npm run native:prebuild -w @messenger/mobile
npm run android -w @messenger/mobile
npm run start -w @messenger/mobile
```

Для Android нужны JDK и Android SDK. Локальная iOS-сборка (`npm run ios -w @messenger/mobile`) требует полного Xcode. `eas.json` содержит development/preview-профили; облачная сборка требует вашей настройки EAS.

Адрес можно изменить в настройках. Путь базового адреса сохраняется, например `/messenger/directory`. Для локального HTTP осознанно задайте `MESSENGER_ALLOW_LOCAL_HTTP=1` при prebuild и `EXPO_PUBLIC_ALLOW_LOCAL_HTTP=1` при JS/native сборке; валидатор всё равно допускает HTTP только для LAN/loopback/`.local`. На физическом телефоне localhost означает сам телефон. Сервер для LAN запускается с `HOST=0.0.0.0`. Публичный сервер использует HTTPS.

## Профиль и хранение

При первом запуске пользователь выбирает имя и уникальный @username без SMS. Seed Ed25519 и профиль сохраняются через Expo SecureStore с iOS accessibility `WHEN_UNLOCKED_THIS_DEVICE_ONLY`. Сервер получает публичный ключ и подписанную аутентификацию; приватный seed в файловую систему не записывается.

`runtime.ts` владеет одним `MessengerClient` на процесс. Возврат из диалога, переключение вкладок и обычный AppState background не отключают directory или другие чаты. После возобновления приложение просит core переподключиться при потере связи.

Контакты, определения групп, недавний текст и локальные ожидающие сообщения шифрует общий core. FileSystem-адаптер пишет только sealed ciphertext, отдельно для сервера и identity, с последовательными записями через temporary file и `move(overwrite: true)`. Проверка размера соответствует публичному пределу core. Неисправный SecureStore/state не сбрасывается молча.

Файлы до 5 МиБ передаются напрямую всем получателям и не ставятся в офлайн-очередь. Файлы не входят в постоянную историю. Preview изображений и share создают временные файлы в cache; preview удаляется при размонтировании, share-копия после закрытия системного меню. Текстовые статусы берутся из core: часы — ожидает, одна отметка — отправлено, две — получено с ACK, а не прочитано.

## Сценарии проверки

1. Создать три профиля на отдельных клиентах. Найти B и C по @username с A, открыть два независимых диалога.
2. Отправить текст/файл A↔B и A↔C. Вернуться к списку и убедиться, что соединения сохраняются.
3. Создать небольшую группу с B/C и проверить прямую рассылку текста. Group call-кнопки отключены с явной подписью.
4. Позвонить A→B, пока B открыт в другом чате: глобальное представление вызова должно появиться независимо от маршрута. Проверить accept/reject/mute/end.
5. Перезапустить приложение и проверить прежний профиль, контакты и текстовую историю. Закрытый peer: текст остаётся локально ожидающим до восстановления соединения обоих участников.

## Границы предварительной версии

Сервер сохраняет профили/статусы и помогает находить участников; он не принимает содержимое чатов. WebRTC выбирает прямой путь или TURN при необходимости. Прямой путь раскрывает IP собеседнику.

Нет APNs/FCM, CallKit/Android Telecom и гарантированного фонового выполнения. ОС может приостановить процесс; для предсказуемых входящих звонков держите приложение открытым. Есть только локальная очередь текста: сервер не хранит сообщения для отсутствующих пользователей. Нет голосовых заметок, групповых звонков, каналов, ботов и бэкапов. Key transparency/Double Ratchet и независимый аудит не заявлены; обход DPI не гарантирован.

Android/iOS каталоги генерируются Expo и исключены из git. Нативные настройки меняются через app.config/plugins. Metro использует стандартное разрешение monorepo Expo и узкое сопоставление `.js` импортов shared TypeScript core с `.ts` исходниками.

## Android release: WebRTC 155 и R8

Expo 58 генерирует `android.enableMinifyInReleaseBuilds=true`. Минификация остаётся включённой. `plugins/withWebRtc155Release.cjs` добавляет только правило `-dontwarn org.webrtc.Dav1dDecoder$Natives` и строгий Gradle constraint на `org.jitsi:webrtc:155.0.1`, заменяющий плавающий upstream-диапазон `155.+`.

Причина: в проверенном AAR 155.0.1 остался `org.webrtc.Dav1dDecoderJni`, хотя Java-обёртка `Dav1dDecoder` и её `Natives` не упакованы. `jar`/`javap` и проверка ссылок всех классов показали, что имя Dav1d встречается только в этом неиспользуемом bridge и native-объявлении `org.jni_zero.GEN_JNI`. Действующие `SoftwareVideoDecoderFactory` и его anonymous decoder вызывают собственный `SoftwareVideoDecoderFactoryJni` и C++ decoder factory. Они не создают отсутствующую Java-обёртку Dav1d. Правило не меняет factory, кодеки и native-библиотеки; общего подавления ошибок `org.webrtc.**` нет.

Проверенный AAR: SHA-256 `b686b7674fd7285ddda369e155ca9663b9787f2b2f470b76691980782e13cd26`. При обновлении WebRTC нужно пересмотреть plugin и повторно проверить содержимое AAR. Это исправление упаковки для R8; работоспособность AV1 на конкретном устройстве этим анализом не подтверждается.

Первичные источники: [upstream Dav1d Java wrapper](https://webrtc.googlesource.com/src/+/main/sdk/android/api/org/webrtc/Dav1dDecoder.java), [SoftwareVideoDecoderFactory](https://webrtc.googlesource.com/src/+/main/sdk/android/api/org/webrtc/SoftwareVideoDecoderFactory.java), [его C++ JNI implementation](https://webrtc.googlesource.com/src/+/main/sdk/android/src/jni/software_video_decoder_factory.cc), [upstream consumer keep rules](https://github.com/react-native-webrtc/react-native-webrtc/blob/master/android/consumer-rules.pro).
