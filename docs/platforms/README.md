# Платформы GoBadminton — единая карта

**Навигация, не новый ADR, не runtime/Owner admission.** Основа: [ADR-0002](../decisions/ADR-0002-MONOREPO-MODULAR-BACKEND.md), [ADR-0003](../decisions/ADR-0003-WEB-AND-NATIVE-CLIENTS.md), [ADR-0008](../decisions/ADR-0008-CONTRACTS-AND-COMPATIBILITY.md), [инженерный регламент](../rules/ENGINEERING_OPERATING_MODEL.md). Текущие решения Owner и exact assignment имеют приоритет.

## Три продуктовых направления, но не три независимых репозитория

| Направление | Код | Канал |
|---|---|---|
| **Web**, включая mobile browser, установленный на домашний экран сайт, PWA, Windows Edge/Chrome «установить приложение» | `apps/web`, Next.js | Web build/deploy и browser-install |
| **Android**, самостоятельное нативное приложение | `apps/mobile`, React Native/Expo Router | APK/AAB, Android testing/signing, отдельно store |
| **iOS**, самостоятельное нативное приложение | **тот же** `apps/mobile` | iOS binary/TestFlight, отдельные signing/device/store gates |
| Admin | `apps/admin` | Отдельный интерфейс/доступ, не consumer main menu |

Общие источники: `apps/api` (authoritative business API), `apps/worker`, `packages/contracts`, `packages/sdk`, `packages/design-tokens`. Последний пакет на дату аудита содержит только README: общие исполняемые токены **не объявлять внедрёнными**. Рабочий визуальный эталон — актуальный принятый Style Guide и exact Owner source. Не импортировать в клиенты server-domain/ORM/DB/secrets.

**Windows:** web app через браузер — часть Web, не собственная нативная Windows-программа. Если когда-либо понадобится EXE/MSIX, это новый Owner-approved scope, а не причина создавать `apps/windows` сегодня.

**Web/PWA факты:** существует `apps/web/src/app/manifest.ts` с `display: standalone` и `apps/web/public/sw-push.js`. Эти файлы не доказывают offline support, установку на каждом устройстве или работу web push. Проверки отдельны по браузеру, HTTPS и разрешениям. [PWA Web Push decision](../decisions/OWNER_DECISION_PWA_WEB_PUSH_MESSAGING_V001.md).

## Где читать и куда направлять изменение

| Изменение | Затрагиваемая область | Проверка |
|---|---|---|
| Web UI, installable browser app/PWA | `apps/web` | Web + browser-install, mobile viewport |
| Android-only native module | `apps/mobile`, Android config | APK/native-device/security |
| iOS-only native module | `apps/mobile`, iOS config | iOS build/native-device/store gates |
| Общие native screens | `apps/mobile` | Android и iOS evidence раздельно |
| Client-independent logic/contracts | `packages/contracts`, `packages/sdk`, owning `apps/api`/worker | contract + backward compatibility старого mobile client |
| Стиль/токены | утверждённые макеты/Style Guide, затем scoped shared tokens | web/native визуальные проверки, не подмена platform UX |
| Partner/Admin | `apps/admin`, owning API; [enterprise boundary](../integrations/ENTERPRISE_PARTNER_BOUNDARY.md) | actor/resource ACL и isolation |

Платформенный статус: [матрица поставки](PLATFORM_DELIVERY_MATRIX.md), [Web/Admin](WEB_AND_ADMIN.md), [Android/iOS](IOS_ANDROID.md). Фактическая очередь — GitHub Issues/Projects, [ACTIVE_BACKLOG](../ACTIVE_BACKLOG.md); **не создавать второй список задач в docs**.

## Ветки и владение

Один репозиторий; `dev` — продуктовая интеграция, `main` — существующий default/discovery и принятые общие docs по текущим правилам. **Не создавать долгоживущие `web` / `android` / `ios` ветки.** Разрешённая точная база → ограниченная краткоживущая ветка → PR → независимая QA/CI → разрешённая интеграция; один source writer в рамках PMA. Группировка в Issues/Projects и затронутые каталоги определяют направление, не имя постоянной ветки.

[Ответственность платформ и внешних команд](../governance/PLATFORM_WORKSTREAMS_AND_EXTERNAL_TEAMS.md) · [EOM](../rules/ENGINEERING_OPERATING_MODEL.md) · [QA](../quality/TEST_STRATEGY.md).
