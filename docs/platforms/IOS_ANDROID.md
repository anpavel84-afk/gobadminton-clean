# iOS и Android

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
