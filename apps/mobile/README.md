# Мобильный прототип

Android/iOS, Expo SDK 58 development build, React Native 0.88 и react-native-webrtc 155. UI и адаптер используют общий `@messenger/core`, как браузерный диагностический клиент.

## Запуск

Из корня монорепозитория после `npm install`:

```sh
npm run typecheck -w @messenger/mobile
npm run lint -w @messenger/mobile
npm run build -w @messenger/mobile
```

`build` экспортирует JavaScript и ресурсы обеих мобильных платформ в `apps/mobile/dist`. Это **не APK/IPA** и не проверка нативного исполнения WebRTC.

Для устройства скопируйте `.env.example` в `.env` в этом каталоге и укажите адрес своего сигналинг-сервера. На физическом телефоне `localhost` означает сам телефон; используйте HTTPS или адрес компьютера в той же локальной сети. Сервер по умолчанию слушает loopback: для осознанного LAN-теста задайте ему `HOST=0.0.0.0`.

При разработке с локальным HTTP:

```sh
MESSENGER_ALLOW_LOCAL_HTTP=1 npm run native:prebuild -w @messenger/mobile
npm run android -w @messenger/mobile
npm run start -w @messenger/mobile
```

Для Android нужны JDK и Android SDK. Для локальной iOS-сборки нужны macOS и полный Xcode:

```sh
MESSENGER_ALLOW_LOCAL_HTTP=1 npm run native:prebuild -w @messenger/mobile
npm run ios -w @messenger/mobile
```

В обычном prebuild без `MESSENGER_ALLOW_LOCAL_HTTP=1` отключён Android cleartext и iOS arbitrary loads. Флаг меняет нативную конфигурацию: после изменения нужен повторный prebuild и rebuild. Сам клиент разрешает HTTP только к loopback/private LAN/`.local` **в dev-сборке**. Для внешнего сервера нужен HTTPS. Приложение не подключается автоматически, пока пользователь не введёт сервер и приглашение и не нажмёт «Подключиться».

Expo Go не содержит нативный WebRTC. Опционально `eas.json` содержит development-профиль с APK; облачная сборка требует вашей настройки EAS и не запускается автоматически. Профиль development разрешает локальный HTTP, preview требует HTTPS.

GitHub Actions дополнительно собирает самостоятельный внутренний arm64 APK со
встроенным JavaScript и тестовой подписью. Только этот лабораторный workflow явно
включает `EXPO_PUBLIC_ALLOW_LOCAL_HTTP=1` вместе с нативным cleartext-флагом:
это разрешает HTTP к частным LAN-адресам для первого испытания. Внешние адреса
по-прежнему требуют HTTPS. Этот APK не предназначен для публикации в Google Play.

## Проверка на двух устройствах

1. Откройте development build на обоих устройствах, задайте одинаковый сервер.
2. Создайте приглашение на одном, передайте 64 символа по доверенному каналу и вставьте на другом. Секрет не отправляется серверу и не включается в URL.
3. Подключитесь, дождитесь «На связи», передайте текст, фото/видео и документ не больше 5 МиБ. Полученный файл можно открыть/сохранить через системное меню.
4. Проверьте аудио- и видеозвонок: разрешения, принятие, отклонение, mute, hangup. Камера/микрофон запрашиваются при вашем действии.
5. Откройте диагностику: маршрут, RTT, аудиобитрейт, jitter, накопленные потери. Отсутствующие метрики отображаются как «—».
6. Повторите с включённым на обоих устройствах «Только через TURN» и настроенным TURN. Без него подключение должно завершиться явной ошибкой.

## Границы прототипа

Только 1:1 в переднем плане. Нет офлайн-доставки, фоновых push, CallKit/Android Telecom, голосовых заметок, групп, ботов, каналов, бэкапов и долговременной истории. При обычном сворачивании сеанс и медиатреки закрываются; временный переход в системный picker/share sheet не считается выходом пользователя. ОС всё равно может приостановить процесс, гарантии доставки в это время нет.

Прямой P2P раскрывает IP собеседнику. TURN передаёт сетевой трафик через relay. Шифрование и адаптация аудио берутся из общего core/WebRTC; завершённого аудита, Double Ratchet и гарантированного обхода DPI нет. Не используйте прототип для чувствительных данных.

Android/iOS каталоги генерируются Expo и исключены из git. `metro.config.cjs` сохраняет стандартную поддержку монорепозиториев Expo, добавляя только разрешение `.js` ESM-импортов общего TypeScript core.

Версии сверены с `expo/bundledNativeModules.json`. Peer ranges WebRTC/config-plugin допускают выбранные версии, но upstream README plugin пока перечисляет матрицу лишь до Expo 56; совместимость на устройстве подтверждается отдельно нативной сборкой и испытанием.

## Android release: WebRTC 155 и R8

Expo 58 генерирует `android.enableMinifyInReleaseBuilds=true`. Минификация остаётся включённой. `plugins/withWebRtc155Release.cjs` добавляет только правило `-dontwarn org.webrtc.Dav1dDecoder$Natives` и строгий Gradle constraint на `org.jitsi:webrtc:155.0.1`, заменяющий плавающий upstream-диапазон `155.+`.

Причина: в проверенном AAR 155.0.1 остался `org.webrtc.Dav1dDecoderJni`, хотя Java-обёртка `Dav1dDecoder` и её `Natives` не упакованы. `jar`/`javap` и проверка ссылок всех классов показали, что имя Dav1d встречается только в этом неиспользуемом bridge и native-объявлении `org.jni_zero.GEN_JNI`. Действующие `SoftwareVideoDecoderFactory` и его anonymous decoder вызывают собственный `SoftwareVideoDecoderFactoryJni` и C++ decoder factory. Они не создают отсутствующую Java-обёртку Dav1d. Правило не меняет factory, кодеки и native-библиотеки; общего подавления ошибок `org.webrtc.**` нет.

Проверенный AAR: SHA-256 `b686b7674fd7285ddda369e155ca9663b9787f2b2f470b76691980782e13cd26`. При обновлении WebRTC нужно пересмотреть plugin и повторно проверить содержимое AAR. Это исправление упаковки для R8; работоспособность AV1 на конкретном устройстве этим анализом не подтверждается.

Первичные источники: [upstream Dav1d Java wrapper](https://webrtc.googlesource.com/src/+/main/sdk/android/api/org/webrtc/Dav1dDecoder.java), [SoftwareVideoDecoderFactory](https://webrtc.googlesource.com/src/+/main/sdk/android/api/org/webrtc/SoftwareVideoDecoderFactory.java), [его C++ JNI implementation](https://webrtc.googlesource.com/src/+/main/sdk/android/src/jni/software_video_decoder_factory.cc), [upstream consumer keep rules](https://github.com/react-native-webrtc/react-native-webrtc/blob/master/android/consumer-rules.pro).
