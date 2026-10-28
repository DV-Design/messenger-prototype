# LastCall · Android и iOS

Версия 0.4.0 / Android versionCode 5. Package ID `dev.messenger.prototype` и ключ подписи сохраняются для обновления без удаления данных. Основной сервер: `https://lienad.ru/messenger`.

Светлый интерфейс со стандартными системными шрифтами: вкладки «Чаты», «Контакты», «Настройки», личные диалоги и группы до 8 участников. Телефон, SMS и доступ к телефонной книге больше не нужны.

## Регистрация и ключ устройства

Один ключ установки владеет одним неизменяемым логином на выбранном сервере. Логин уникальный: 3–24 латинские буквы/цифры/underscore, без учёта регистра. Отображаемые имена могут повторяться. Регистрация считается завершённой только после подтверждения сервера; никакой Firebase Authentication для неё не требуется.

Если локальный профиль отсутствует, `resolveDeviceProfile` подписывает отдельный серверный challenge существующим ключом. Только подтверждённый ответ `null` разрешает форму регистрации; сеть/timeout не трактуются как отсутствие привязки. Уже зарегистрированный ключ восстанавливает канонический серверный профиль. Потеря ответа регистрации или ошибка локального сохранения не дают выбрать второй логин. Повторное нажатие блокируется синхронным process-level busy guard.

Канонические имя/логин из `ready.self` сохраняются только при изменении. Записи SecureStore сериализованы и дедуплицируются; ошибка сохранения не отменяет привязку на сервере. Seed Ed25519 остаётся в существующем SecureStore record (`WHEN_UNLOCKED_THIS_DEVICE_ONLY` на iOS), не попадает в файловую систему и никогда не регенерируется для исправления ошибки регистрации. Старые ключи телефонного сценария не читаются и не удаляются. Потерянный ключ нельзя восстановить по публичному логину.

При наличии локального профиля открывается кешированная история даже без сети. `runtime.ts` владеет одним `MessengerClient` на процесс; навигация и обычный background не разрывают контакты/звонок. Смена сервера сначала проверяет привязку того же ключа, затем подключается к выбранному серверу; история хранится отдельно для каждого server/identity.

## Каталог пользователей

Вкладка «Контакты» показывает каталог сервера отдельно от сохранённых чатов. `listUsers(cursor?)` загружает страницы до 100 пользователей; кнопка «Загрузить ещё» использует серверный keyset cursor. Сами строки каталога не создают контакты, чаты или P2P-сессии. Только выбор человека открывает чат.

Поиск по полному серверному каталогу принимает имя или @логин, включая русские имена: NFKC, trim, удаление ведущего @, lower-case. Debounce 350 мс; поколения запросов исключают перезапись новым запросом старым ответом и присоединение старой страницы к новому поиску. Новый server/identity получает отдельный controller. При отсутствии сети каталог явно помечается как необновляемый; сохранённые чаты остаются на вкладке «Чаты».

Обновление идёт при фокусе вкладки, reconnect, foreground resume и каждые 30 секунд, пока вкладка видима и приложение активно. На background/потере фокуса таймеры и актуальность запросов отменяются. Кнопка обновления и pull-to-refresh доступны отдельно. Каталог сохраняется только в памяти.

## История и передача

Core шифрует контакты, группы, недавний текст и локальную очередь ожидающих сообщений. FileSystem-адаптер пишет только sealed ciphertext последовательными записями через временный файл и `move(overwrite: true)`, с пределом, согласованным с core. Повреждённые данные не сбрасываются молча.

Сообщения и звонки идут по защищённому WebRTC соединению; при наличии настроенного сервера TURN возможен relay. Текстовые статусы: часы — ожидает, одна отметка — отправлено, две — ACK получателя, не прочтение. Файлы до 5 МиБ требуют доступных получателей и не входят в постоянную историю. Preview/share используют временный cache с очисткой.

## Разрешения и push

Остались только камера, микрофон, фото/видео и уведомления. При первом запуске после локальной загрузки ключа, до завершения сетевой проверки регистрации, открывается экран доступов. Системные запросы автоматически идут в порядке микрофон → камера → фото → уведомления; отказ или ошибка одного не мешает остальным. ОС сама решает, нужен ли запрос для уже доступной категории. Повторное событие foreground не запускает новую последовательность; перед первым запросом сохраняется attempted marker, после завершения — done. Завершённый marker прежней версии сохраняет силу. В настройках остаются индивидуальные и повторные ручные запросы. Камера/микрофон не включаются для проверки доступа. `expo-contacts`, телефонные экраны и READ/WRITE_CONTACTS удалены из активного продукта. Старые пользовательские данные не очищаются.

Android FCM остаётся независимым от регистрации. Системное разрешение уведомлений можно запросить без Firebase; интерфейс отдельно показывает OS permission и отсутствие push-конфигурации. Для получения FCM-токена требуется внешняя клиентская конфигурация `MESSENGER_GOOGLE_SERVICES_FILE=/absolute/path/google-services.json`, с Android package `dev.messenger.prototype`. Тот же env нужен при native prebuild и финальном JS/native build. Без него `extra.nativeFcmConfigured=false`, token API не вызывается и push-статус показывает «Не настроено». Firebase Admin JSON и SMS API keys никогда не входят в мобильное приложение.

Канал `lastcall-messages` создаётся до permission/token. Native токен получается через SDK58 `getDevicePushTokenAsync`, регистрируется только после authenticated directory online; listener обрабатывает rotation без рекурсивного получения токена. Нажатие уведомления/resume переподключает directory и позволяет P2P/outbox доставить текст. Push общий, без автора/содержимого. Регистрация токена не доказывает реальную доставку.

Серверного mailbox нет: отправитель должен оставаться доступным. Android force-stop блокирует push до ручного открытия. Google Play Services и физическая проверка нужны для заявления работоспособности. iOS APNs, фоновые звонки, CallKit/Android Telecom, голосовые заметки и групповые звонки не реализованы.

## Запуск и проверки

Из корня после установки workspace-зависимостей:

```sh
npm run typecheck -w @messenger/mobile
npm run lint -w @messenger/mobile
npm run test -w @messenger/mobile
npm run build -w @messenger/mobile
```

`build` экспортирует Android/iOS JS/resources; APK/IPA и native execution не проверяет. Expo Router использует `src/app` и `expo-router/entry`. Expo Go не включает WebRTC; нужна native/dev-сборка. Android требует JDK/Android SDK, локальная iOS-сборка — полный Xcode; `eas.json` содержит профили облачной сборки.

```sh
npm run native:prebuild -w @messenger/mobile
npm run android -w @messenger/mobile
npm run start -w @messenger/mobile
```

Восемь focused tests проверяют permission semantics/последовательность, отсутствие ложного ACK, authoritative registration outcome, восстановление после локального save failure, deduplicated canonical writes, Unicode query/latest-request wins, старую pagination response после смены запроса и маскирование личных данных диагностики. Native upgrade и реальные SMS/FCM не подменяются этими проверками; SMS больше не является частью продукта.

Адрес можно изменить в настройках. Префикс gateway сохраняется. Для локального HTTP задайте `MESSENGER_ALLOW_LOCAL_HTTP=1` при prebuild и `EXPO_PUBLIC_ALLOW_LOCAL_HTTP=1` при JS/native build; валидатор допускает только LAN/loopback/`.local`. Публичные endpoint используют HTTPS. Генерируемые android/ios не редактируются вручную.

Прямое соединение раскрывает IP собеседнику. Double Ratchet/key transparency/независимый аудит и невидимость для DPI не заявляются. Удаление приложения может лишить ключа и локальной истории.

Документация SDK58: [Router](https://docs.expo.dev/versions/v58.0.0/sdk/router/), [SecureStore](https://docs.expo.dev/versions/v58.0.0/sdk/securestore/), [Notifications](https://docs.expo.dev/versions/v58.0.0/sdk/notifications/).

## Логотип

Пользовательская фиолетовая спутниковая антенна из `assets/lastcall-icon.png` используется в app icon, adaptive icon, native splash и onboarding. Expo создаёт размеры платформ; исходный raster не меняется. `withAdaptiveIconInset.cjs` добавляет 12% inset к adaptive foreground после генерации Expo, сохраняя всю антенну внутри безопасной зоны Android. Происхождение asset описано в `assets/README.md`.

## Android release: WebRTC 155 и R8

Expo 58 генерирует `android.enableMinifyInReleaseBuilds=true`. Минификация остаётся включённой. `plugins/withWebRtc155Release.cjs` добавляет только правило `-dontwarn org.webrtc.Dav1dDecoder$Natives` и строгий Gradle constraint на `org.jitsi:webrtc:155.0.1`, заменяющий плавающий upstream-диапазон `155.+`.

Причина: в проверенном AAR 155.0.1 остался `org.webrtc.Dav1dDecoderJni`, хотя Java-обёртка `Dav1dDecoder` и её `Natives` не упакованы. `jar`/`javap` и проверка ссылок всех классов показали, что имя Dav1d встречается только в этом неиспользуемом bridge и native-объявлении `org.jni_zero.GEN_JNI`. Действующие `SoftwareVideoDecoderFactory` и его anonymous decoder вызывают собственный `SoftwareVideoDecoderFactoryJni` и C++ decoder factory. Они не создают отсутствующую Java-обёртку Dav1d. Правило не меняет factory, кодеки и native-библиотеки; общего подавления ошибок `org.webrtc.**` нет.

Проверенный AAR: SHA-256 `b686b7674fd7285ddda369e155ca9663b9787f2b2f470b76691980782e13cd26`. При обновлении WebRTC нужно пересмотреть plugin и повторно проверить содержимое AAR. Это исправление упаковки для R8; работоспособность AV1 на конкретном устройстве этим анализом не подтверждается.

Первичные источники: [upstream Dav1d Java wrapper](https://webrtc.googlesource.com/src/+/main/sdk/android/api/org/webrtc/Dav1dDecoder.java), [SoftwareVideoDecoderFactory](https://webrtc.googlesource.com/src/+/main/sdk/android/api/org/webrtc/SoftwareVideoDecoderFactory.java), [его C++ JNI implementation](https://webrtc.googlesource.com/src/+/main/sdk/android/src/jni/software_video_decoder_factory.cc), [upstream consumer keep rules](https://github.com/react-native-webrtc/react-native-webrtc/blob/master/android/consumer-rules.pro).
