# iOS и Android

## #522: SOURCE-now и отдельные факты приёмки · 2026-11-15

Один React Native + Expo/Router клиент, backend и User, единые бизнес-правила. E «Траектория» — introduction;
четыре конечных корня **Игры / Игроки / Мои игры / Сообщения**, профиль — destination из постоянного header.
Onest, black-on-green, safe edges и масштабирование текста сохранены. Это factual reconciliation текущих
исходников, а не новая архитектура и не доказательство физической приёмки.

Текущее состояние по предоставленным qualified inputs для alpha.94; новый DEV release, подпись и
публикация native code9 этим metadata-изменением не подтверждаются. Native runtime source остаётся
`a44cd7b22259f61ed1dd31ddeb07224f60fb609d`; будущий metadata source/merge и принятый серверный SHA — отдельные факты.
Приложение `0.1.0-alpha.94` подготовлено как описание функций, API-контракт остаётся `0.44.0`.

| Стадия | Текущий подтверждённый факт / обязательная открытая граница |
|---|---|
| Принятый сервер / rollback | DEV `0.1.0-alpha.93`, source `12b5024ae2fb47f5bc8ef3bd755aba24d9bbc8a6`, release `r43712227701-a1`, принято `2026-11-15T12:21:01Z`; это текущий принятый rollback target, не будущий native source |
| Два развёртывания alpha.93 | Сначала `f145863cdd098b016bdd1ae2fbbb8520fd71d83b` / `r43707786262-a1` / `2026-11-15T11:26:35Z`, затем `12b5024ae2fb47f5bc8ef3bd755aba24d9bbc8a6` / `r43712227701-a1` / `2026-11-15T12:21:01Z`. Первый STRICT39461 завершился FAIL из-за DOC alias; исправление и второе развёртывание сохранены в истории, первый FAIL не переименован в PASS |
| Native normal23 source / static | `a44cd7b22259f61ed1dd31ddeb07224f60fb609d`, versionName `0.1.0`, versionCode **9**. Supplied static parent PASS: typecheck, changed-mobile lint, meaningful units, оба exports, неизменность source/archive; parent SHA256 `79810e52e583d557dc8dee53d18c3a9a0a1d0fb042cdf174c6e44283505615f6` |
| Независимая source QA | Normal23 focused P2/all-delta PASS без findings, receipt SHA256 `fcf173047e7990f7d717764721c88f22c5c9327d45847ecbd874a1d47edb1c8c`. Предыдущий normal22 full review на `859afdc176f08d81c3540ceae77d956bfac537d5` сохраняет raw CHANGES_REQUIRED / protocol-invalid verdict, не PASS; Root disposition SHA256 `235a899f29b9ebed51abe16ad609b82b2aabfe879f22f41deac7a12e1b0b171f` |
| Android code9 build | Предоставлен actual standalone build PASS receipt `NATIVE522-NORMAL23-CODE9-ANDROID-STANDALONE-BUILD.json`, SHA256 `803d1709e4c55ee8d44cf9ffdddb95dc75cfb6a04614058d834cbd366c4b7c66`. Это digest квитанции, не APK; owned-sign proof отсутствует (`owned_sign_sha256: null`), подписанная публикация code9 не подтверждена |
| Публичный APK сейчас | **APK8** остаётся фактически опубликованным. Build code9 не заменяет APK8; нового публичного URL, digest артефакта или даты публикации code9 не заявлено. APK7 ниже сохранён как историческое evidence |
| Backend native opt-ins | В source адресно подготовлены ещё **8** bearer API routes для MyGames/Postgame. Общий установленный inventory **22** допустимо фиксировать только после фактического нового DEV acceptance; сейчас это не факт установки. Права, версии, idempotency и WEB cookie-поведение сохраняются |
| Устройства / приёмка | Physical Android / Samsung S23 **NOT_TESTED**, native visual **NOT_VERIFIED**; исторический S23 FAIL и Owner UAT **FAIL_RECHECK_PENDING** сохранены. Source QA и build не доказывают taps, вход, verified links или установленный authenticated journey |
| Полный объём | Full web-to-native parity **MANDATORY_NOT_COMPLETE**, оставшиеся сценарии обязательны; real signed OTA A→B **NOT_DONE**, Android device/S23 и iOS acceptance обязательны и открыты. Новый Product CI/STRICT DEV, independent metadata QA и release acceptance выполняет trusted route; PROD, production OTA и stores требуют отдельного Owner GO |

Восемь source opt-ins: `GET /me/game-results`, `GET /games/:gameId/results`,
`PUT /games/:gameId/outcome`, `PUT /games/:gameId/attendance/:contextId`,
`POST /games/:gameId/attendance/bulk-present`, `POST /games/:gameId/attendance/:contextId/acknowledgements`,
`GET /me/postgame-reminders`, `POST /me/postgame-reminders/:reminderId`.
Disputes/history/help и остальные закрытые сценарии этим списком не объявляются перенесёнными.

### Исторические факты alpha.92 и venue candidate (не текущее состояние)

Фактические границы из Root `NATIVE522-VENUE-ACTUAL-ACCEPTED-SUMMARY.json`
(SHA256 `05648644db9c5431d7af0c7bdf08f1957748576f943fcc20e14b16dc48069776`):

| Стадия | Подтверждённый факт / отдельная граница |
|---|---|
| Принятый native safety source | `8cb33c634cb0f840ae3f2dc9f7ad330cda9057dc`; **four completed author runs**, не четыре разных автора |
| Независимая source QA | Первый whole safety FAIL `6821f5f535d89ab13d015b3de0af0c622ad113ee7bd2bb79ad672cb3600adea6` сохранён; focused closure PASS `c9a31a48c6a42819796e45611fca67b738c2b603ce5138972640c6d2b483fe3b`, не замена whole FAIL |
| Product CI | Run `43654442331` для принятого safety release; не CI нового venue candidate |
| DEV ACCEPTED | Приложение `0.1.0-alpha.92`, source `2a0b8207b8cc28d0e56a1ec5abecc604e934faed`, workflow `43655345631`, receipt/release `r43655345631-a1`, принято `2026-11-15T00:10:09Z`; receipt SHA256 `fad69c4b23fa6ce1764e9de8fb972e5f4268da940c24b215d4ebeee6deb4dbef` |
| API / DB | API-контракт `0.44.0`, source migration inventory 72; actual DB schema query NOT_PERFORMED (public meta не имеет schema field) |
| Публичный owned APK | Native source `8cb33c634cb0f840ae3f2dc9f7ad330cda9057dc`, versionName `0.1.0`, versionCode **7**, 31842785 bytes, SHA256 `7c0865de47af271ca0f775b193e0994d21e2afee2f3c3e3ac07ac39988f5eee5`; publication receipt `962c6bb5af184dcc2e40e72373f2febac134f887d671e7b0531c77078b7c517e` |
| Текущий venue source | SOURCE_CANDIDATE на accepted alpha.92, versionCode **8**; независимая QA/CI/DEV/APK этого изменения ещё не подтверждены |
| Устройство / UAT | Physical device NOT_TESTED, прежний Samsung S23 FAIL сохранён; Owner UAT **FAIL_RECHECK_PENDING**, native visual **NOT_VERIFIED** |
| Полная parity / OTA / iOS | Full native parity **MANDATORY_NOT_COMPLETE**; real signed OTA **NOT_DONE**, iOS **NOT_DONE**, PROD не разрешён |

Исторический APK7: https://files.anpavel.ru/projects/gobadminton/mobile/dev/alpha92-safety-8cb33c634cb0-7c0865de47af/GoBadminton-DEV-native-0.1.0-7-arm64.apk

### Реализовано в текущем native source и обязательные ограничения

| Пользовательский сценарий | Исходная реализация сейчас | Ещё требуется |
|---|---|---|
| Intro/city, public games/detail/share | Ручной город, public GET, пагинация/ошибки/retry, upcoming expiry, нативные карточки и Share | S23 visual/taps, keyboard/safe edges/large text/offline и полная card parity |
| Вход/restore/logout/свои сессии | Root AuthProvider, system browser, SecureStore PKCE/refresh, actor/session fences, адресные bearer ports; существующий DEV native registry включён | Реальный provider/login/restart/logout и verified links на установленном телефоне |
| Мои игры/участие/организатор | Hub объединяет загруженные managed/participations/own results/reminders без потери связей; фильтры «Все», «Создаю и управляю», «Заявки и участие», upcoming/drafts/history/terminal/unknown, сортировка и отдельные ошибки источников. Apply/withdraw, create/preview/publish, roster и confirm/reject/remove сохранены | Только загруженный union, не полный inventory аккаунта; приглашения/советы и remaining WEB hub flows, полное редактирование/отмена, роли/гонки/сеть на устройстве |
| Итоги / посещение / напоминания | Исход held/not-held, посещение и self-attestation, provenance/late/open-dispute display, точное versioned acknowledgement; выбор отдельных участников для bulk-present. Reminders: к итогам и «Позже». Review → явное подтверждение; UNKNOWN сохраняет исходный пакет, actor/session fences очищают private view | Полный разбор споров/help/history посещения и остальные Postgame flows не перенесены; внимание считается по загруженным источникам независимо от фильтра. История заявки не доказывает посещение/оплату; device acceptance обязательна |
| Игроки | Каталог/фильтры/пагинация/карточка через существующие права/privacy | Остальная социальная функциональность и visual parity; без новых rating/level правил |
| Сообщения/приглашения/game chat | Inbox/counts, личная и игровая история/чтение, ответы на полученные приглашения, первое явное текстовое обращение, same-packet UNKNOWN reconciliation | Создание/отзыв приглашений, остальные messages flows и установленный authenticated journey |
| Свой профиль / contact | Ручные публичное имя/город и редактор публичного контакта игры, явное versioned/idempotent save, conflict/UNKNOWN/actor fences и возврат к форме без auto-create | Level/photo/privacy settings, методы/link/email/reauth и полный профиль |
| Safety | Явные block/unblock/report, scoped authority reads/fences, сохранение исходных UNKNOWN и черновиков; historical replay не доказывает текущий block state | Повторная пользовательская проверка и физические native interruption flows |
| Площадка: реализовано в source | Game → native public venue facts/gallery/credits/contacts → public upcoming schedule → game; typed venue-create → явный выбор в существующей форме → preview/publish | Полная venue parity и device taps обязательны; source, build/sign и публикация разделены выше |
| Maps/Radar/Swipe | Native public games/venues map, venue sheet и переход к create; Radar origin/conditions/results/явное управление поиском; просмотр игроков по одному, явный play interest и переход при mutual interest. Смена условий/остановка убирает устаревшие результаты; privacy/consent fences сохранены | Это ограниченный core, не полные карты/Radar/matching; все remaining WEB contracts/consents/privacy, permissions и device visual/taps обязательны |
| UGC/остальное | Неперенесённые native сценарии не заявлены завершёнными | Ratings/comments/reviews/uploads/новые площадки, оставшиеся сообщения/социальные сценарии и весь обязательный parity |

Pure type-only `@gobadminton/contracts/native-auth` исключает `node:fs` root из Metro. DOM, cookies и CSRF
не переносятся как native transport. Сервер авторитетен для identity, прав, участия и вместимости;
bearer включается адресно, без изменения cookie-поведения WEB. Исторические FAIL/UNKNOWN сохраняются.

Android package `ru.gobadminton.mobile.dev`, clientId `gobadminton-native-dev`, exact callback
`https://dev.gobadminton.ru/auth/native/callback`, exact-path autoVerify source и owned certificate SHA256
`5208faba0b474c6c94e4c237cbc345a10c7d3d0f5b3eb285ac8e271f9bd8c051` сохранены.
Registry enablement и публичный signed APK не являются Android domain verification на устройстве.
Custom scheme не служит auth fallback. Для iOS Team/AASA/binary/store нет подтверждения; отдельный HOLD сохранён.
APK signing не является OTA signing. expo-updates/service/config не добавлены, подписанный OTA A→B не проверен.

### Совместимость, config и обновления — отдельные границы

Backend изменения additive: текущий и непосредственно предыдущий принятый binary/runtime проверяются с новым API;
ранее выданные клиенты не выводятся из поддержки без решения/upgrade path. Optional неизвестные поля допустимы,
unsupported operation явно недоступна. App version/build, API version, runtimeVersion и OTA update ID различаются.
Preferences остаются в старом ключе, secure-session/pending — отдельный namespaced v1; неизвестная secure-версия
не переписывается старым клиентом. Rollback кода не откатывает local/DB migration.

| Изменение | Канал доставки / граница |
|---|---|
| Игры, текущая вместимость, approved media | Data API/cache; обычные права/UGC/privacy |
| Уже реализованный bounded page-size/poll interval | Будущий typed versioned config существующего API: finite/range/schema, TTL, bundled defaults + last-valid cache, без startup зависимости |
| Исправление уже принятого JS/assets flow | Только квалифицированный совместимый подписанный OTA; effect/store policy проверяется отдельно |
| Новые Messages/Radar/application возможности | Планируемый reviewed binary/release; не скрытая активация через config/OTA |
| Native module/SDK/permission/app link/entitlement/OTA trust root | Новый signed binary/runtime; JS export этого не добавляет |
| Authorization/schema | Отдельный additive API release + old-client checks; config не выдаёт права |

Generic config ещё не реализован: никакого executable code/screen generator/auth origin/trust-root override,
скрытых features или authorization policy. `/radar/config` — отдельный domain contract.

Следующая обязательная update foundation: стандартный **expo-updates**, при фактически доступном owned eligible
EAS Update/Expo Update service. В этом auth slice **нет expo-updates зависимости/config implementation, аккаунта,
оплаты, OTA enablement или custom platform**. До отдельного signed service/account/trust допуска всё отключено.
Будущая отключённая bootstrap-конфигурация потребует нового binary для включения; remote config/OTA её не включат.
После квалификации: platform + fingerprint runtime policy, фиксированные dev/preview/production channels,
embedded last-working bundle, отдельный embedded OTA verification certificate, offline private signing key;
канал не заменяет подпись, APK signing и OTA signing — разные trust systems. Никаких придуманных project ID/URL/cert.
Account/plan/project/permissions/key ownership и eligible signing service — UNKNOWN; PROD требует отдельного решения.

Enabled policy после допуска: cached/embedded запускается без ожидания сети, `useEmbeddedUpdate: true`,
`fallbackToCacheTimeout: 0`, `checkAutomatically: ON_LOAD`, anti-bricking включён. Compatible signed download
применяется только при **следующем естественном cold launch**. Нет обычного `reloadAsync`, горячей подмены auth/form,
перезагрузки при background/login/message/upload/mutation или нового OS scheduler. Early fatal recovery — исключение,
может сопровождаться crash, late/post-content recovery ограничен и обычно требует forward fix. Stop rollout не удаляет
уже скачанный update; rollback только с доказанной совместимостью API/local state, иначе fix forward.

| Обязательная signed OTA runtime-проверка | Статус |
|---|---|
| Installed A → signed compatible B, тот же package/versionCode/cert и binary; B только после cold launch; city/session сохранены | NOT_DONE |
| Update во время login/form; pending PKCE переживает restart, нет normal reload | NOT_DONE |
| Offline/service outage/partial download: быстрое cached/embedded открытие, incomplete update не запускается | NOT_DONE |
| Wrong runtime/platform, unsigned/untrusted/tampered payload отклоняются | NOT_DONE |
| Broken preview: раннее recovery и отдельно late-error limits/forward fix, совместимость persisted state | NOT_DONE |
| Текущий/предыдущий accepted client против нового API: public parsing, refresh/me, changed private routes + WEB cookie regressions | NOT_DONE |

Нужны source SHA, binary/build/signing identity, runtime/platform/channel, update ID, signature result и device state.
JS export, Expo Go, download-only и reinstall B не являются A→B proof. Expo58.0.25 / RN0.88.1 / React19.3.0 /
Router58.0.31 сохраняются. Installed bundled manifest SHA256 `5167339fa4e919d0c8675c7bee4492d6289c6356e0609428b07ddee3f7f909eb`
подтверждает compatibility ranges SecureStore ~58.0.3, Crypto/WebBrowser ~58.0.8, будущий updates ~58.0.22;
это не exact resolved pins. Lock генерирует trusted parent. SDK/React upgrades здесь не нужны.
Apple 2.5.2/2.5.19 и Google Play interpreted-code exception не дают общего разрешения на скрытую смену functionality.
Источники supplied review: [Expo runtime](https://docs.expo.dev/eas-update/runtime-versions/),
[signing](https://docs.expo.dev/eas-update/code-signing/), [recovery](https://docs.expo.dev/eas-update/error-recovery/),
[Apple](https://developer.apple.com/app-store/review/guidelines/),
[Google](https://support.google.com/googleplay/android-developer/answer/16559646). Это не проверка entitlement аккаунта.

Auth/profile, games/application/My Games и Players/Messages уже имеют source ports в указанных выше границах.
Native venue/map/Radar/Swipe/contact/safety и MyGames/Postgame core реализованы в source в описанных границах;
remaining parity и все оставшиеся сценарии обязательны и не завершены. Source static/focused QA, standalone build,
owned signing, Product CI/STRICT DEV, публикация и Android device acceptance разделены. Accepted E introduction
с чёрным текстом на зелёном сохранён. Реальный signed OTA A→B, S23 и iOS acceptance остаются обязательными открытыми gates.

## Историческая архитектурная основа (сохранена)

Статус: **TECH_SELECTED**. Один `apps/mobile` на React Native + Expo/Expo Router; разные store artifacts и platform-specific configuration. Это не webview-обёртка сайта.

## Архитектура клиента

UI → generated API SDK/query layer → HTTPS API. Никаких прямых подключений к PostgreSQL, provider client secret, server-only domain packages или прав из локального профиля. Состояние навигации, фильтров и UI локально; заявка, availability, permission и payment status — серверные.

Общий код RN для экрана discovery, карточки, заявок, organizer confirmation и профиля. Платформенные controls, permissions, safe areas, keyboard и accessibility адаптируются отдельно. Native modules допускаются через Expo tooling; зависимости проходят совместимость с выбранной RN architecture.

Expo development builds применяются для проверки реального OAuth/deep-link behavior, не Expo Go как доказательство успешного входа. Точная Expo/RN/React связка фиксируется при runtime bootstrap. EAS cloud не обязательный hosting/runtime; native builds можно организовать через собственную согласованную инфраструктуру [S08–S09, S19].

## Sessions и ссылки

Auth — system browser и [двухступенчатый handoff](../integrations/AUTH.md). Refresh credentials — secure storage; logout/revoke очищает credentials, private caches и device notification binding. Account switch не оставляет чужую историю и заявки в кеше.

Game/share links — HTTPS universal links / Android App Links с проверенными association files; до утверждения домена примеры используют `.invalid`. Запасной web landing открывается без приложения. Token, cookie или code exchange result не вкладывается в постоянную публичную ссылку. App restart во время OAuth — отдельный тест.

## Важный gate: iOS login

Owner выбрал VK/Яндекс. App Store guideline 4.8 при third-party/social login требует эквивалентный способ с определёнными privacy-свойствами, если не действует исключение. Архитектура допускает Sign in with Apple как вероятный путь, но это **O-04, не молчаливое расширение текущего MVP**. Перед public iOS submission нужен подтверждённый compliance-путь и повторная проверка актуальных правил. Два consumer providers сами по себе не доказывают соответствие [S16].

## Store release gates

Apple Developer / Android publisher accounts, юридический оператор, bundle/package IDs, signing/keystore backups, privacy disclosures, account deletion, support/deletion URL, permission strings, возрастная политика и review credentials. Android channels (Google Play/RuStore/другие) и их необходимость отдельно фиксируются перед публикацией; их доступность/условия не предполагаются.

При создании аккаунтов нужны account deletion routes и documented handling of retained data. Google описывает in-app initiation и внешний web route; Apple также требует соответствующих возможностей [S16–S17]. Удаление приложения не равно удалению аккаунта.

## Обновления и проверка

Backend сохраняет совместимость с предыдущими публичными mobile clients. Remote config выключает capability, но не выполняет произвольный код. OTA updates, если позже используются, только в совместимом runtime/подписанном канале с rollback; native change требует нового binary. Store policies не обходятся OTA.

На обеих ОС проверяются cold start/deep link, keyboard/large font/reader, slow network, duplicate tap, auth cancel, revoke, full game race, outdated app, timezone, notification permission denied и privacy after logout. TestFlight/closed Android tests предшествуют public release. Сроки и платформенная очередность ещё не утверждены.
