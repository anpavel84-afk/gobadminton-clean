# iOS и Android

## #522: текущее решение · 2026-11-14 · SOURCE ONLY

Согласовано с hash-pinned `decision-draft.md` (`8dd5af5c0e5be2da662232f937e553047d4906218be1b33cb3450a009dc2f93e`)
и `scenario-matrix.md` (`0f28622e47ae78b7bf91762f07dcb5c05c98f899800f3a1c86d9aa37f52202c3`).
Это reconciliation существующих документов, не новый архитектурный проект и не runtime receipt.
Один React Native + Expo/Router клиент, backend и User, единые бизнес-правила. E «Траектория» — только introduction;
остальные экраны следуют принятому mobile WEB. Samsung S23 Owner FAIL сохраняется, native visual **NOT_VERIFIED**,
полный Android-first/iOS parity **MANDATORY_NOT_COMPLETE**. Подготовленный backend `05602db…` имеет предоставленный
Root focused security PASS; исторические whole FAIL и UNKNOWN остаются историей. API 0.44/миграция 0072 — source,
принятый WEB/DEV API 0.43 — отдельный release факт; здесь ни runtime, ни schema inventory не меняются.

Клиент переиспользует native preferences/city, public DTO parsing, отмену/stale-response fences, media и форматирование.
Pure type-only `@gobadminton/contracts/native-auth` исключает `node:fs` root из Metro. DOM, browser events,
cookies и CSRF не переносятся как native transport. Сервер авторитетен для identity, прав, участия и вместимости;
bearer включается адресно по маршрутам, без изменения cookie-поведения WEB.

Четыре конечных корня: **Игры / Игроки / Мои игры / Сообщения**. Профиль — destination из постоянного header,
не пятый tab. Сейчас нет фиктивных tabs: работают public games/detail/city и ограниченный auth/profile shell.
Постоянный header даёт один canonical WEB SVG, выбор города, профиль и contextual Back. Safe edges,
компактные размеры, Onest и fontScale сохранены; это не device visual PASS. Карточка получила overlay badge
при реальной обложке, available/total, Trainer → Organizer, arrow и RN Share канонического публичного URL.
Avatar/reputation disclosure с реальными данными и полная visual/card parity ещё обязательны.

| Пользовательский сценарий | Source сейчас / точная граница | Следующая приёмка |
|---|---|---|
| Intro → city → guest games/detail, direct game | Сохранены optional stories, ручной город, upcoming/pagination/errors/retry, public GET | S23 captures/taps, compact/large text, safe edges/keyboard, offline; FAIL не закрыт |
| Вход из игры / restore / logout | Один root AuthProvider, system-browser broker, SecureStore PKCE/refresh, memory access; default-off server честно unavailable | Реальный email/VK/Yandex по доступности, restart/cancel/duplicate/lost-response, same-game public reread, ноль auto-application |
| Свои сессии | Только opted-in `/me`, `/me/sessions`, revoke/revoke-others | Ownership/authority loss, текущая/другие сессии, logout fences и WEB regression |
| Apply/withdraw, organizer, My Games | Private routes остаются cookie-only; native UI/ports не готовы | Explicit bearer каждого endpoint, capacity race/idempotency/stale rights; private 404 сохраняются |
| Players / profiles / friends | Native destinations и private порты не готовы | Blocks/privacy/filter parity, без новых rating/level правил |
| Messages / invitations / game chat | Native UI и cookie-only private порты не готовы | Session-scoped reads, membership/expiry, zero ambiguous send replay, logout cleanup |
| Profile edits / methods / avatar / reauth | Только NativeMe identity и sessions; editing/link/email не заявлены | Отдельный secure native flow каждого endpoint, account switch/upload cancellation |
| Maps / venues / Radar | Native renderer/permissions/private ports не готовы | City/filter/consent/location-denied/manual choice; native modules требуют binary |
| UGC и остальные consumer flows | Native comments/reviews/media/results не готовы; source-only WEB не выдаётся за release | Реальные принятые контракты, moderation/ownership/privacy и interruption |

Android verified-link source: `ru.gobadminton.mobile.dev`, proposed Root-reviewed clientId `gobadminton-native-dev`,
exact `https://dev.gobadminton.ru/auth/native/callback`, exact-path autoVerify filter и source assetlinks с единственным
owned public SHA256 `5208faba0b474c6c94e4c237cbc345a10c7d3d0f5b3eb285ac8e271f9bd8c051`.
Это не live association/registry enablement и не device proof. Custom scheme не служит auth fallback.
Для iOS Team/AASA нет: entitlement/TeamID не выдумываются; verified iOS runtime — внешний HOLD, Android source продолжается.
Смена старой public-debug signing identity требует отдельного ручного reinstall с потерей локальных данных;
здесь reinstall не выполнялся. Последующие binary должны сохранять owned identity.

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

Порядок: auth/profile source → независимая QA/CI и настоящий Android sign-in/restart/logout → games/application/My Games
с endpoint ports → Players/Messages → Maps/Venues/Radar/UGC/remaining parity. Update foundation последующая, не блокирует
авторизованные Android ports; Owner signed OTA A/B proof остаётся обязательным NOT_DONE.

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
