# Направления разработки, внешние команды и владение

**Навигатор, а не новые полномочия PMA.** Применяются [EOM](../rules/ENGINEERING_OPERATING_MODEL.md), [TEAM](TEAM.md), [CONTRIBUTING](../../CONTRIBUTING.md) и [Project Record Policy](../rules/PROJECT_RECORD_POLICY.md). Наличие этого документа не даёт доступ к GitHub, серверу, приватным данным или PROD.

## Иерархия

Один продукт GoBadminton CLEAN и один backlog (GitHub Issues/Projects):
- Web/PWA/Windows browser-installed → `apps/web`.
- Android и iOS → **единый** `apps/mobile`, разные build/test/release channels.
- Cross-platform contracts/logic → `packages/*` и owning backend modules.
- Admin → `apps/admin`; не подменяет пользовательское приложение.
- Enterprise partner — отдельная будущая approved граница, [см. integrations](../integrations/ENTERPRISE_PARTNER_BOUNDARY.md), **не новая архитектура сегодня**.

## У каждого задания — понятные признаки

Exact Owner scope + одна продуктовая Issue; затронутые поверхности Web/Android/iOS/API/Admin/partner; base SHA; expected UI/API; allowed paths; dependencies; expected release; независимая QA; обязательные device/visual gates; результат и честные ограничения. Один общий результат может быть выпущен ограниченными PR-срезами, но отдельные платформенные срезы **не становятся тремя независимыми продуктовыми backlog**.

Для постановок можно позже создать GitHub labels `surface:web`, `surface:android`, `surface:ios`, `surface:shared`, `surface:partner` и статусы по действующей доске; **никаких меток этим PR не создаётся**. Источник назначения и допуска — существующий GitHub/Owner flow, не новый markdown registry.

Один разрешённый source writer в существующем PMA. Краткоживущие scoped branches от проверенного base; продуктовая интеграция через `dev`, общие canonical docs в `main` только по текущему порядку. Нет долгоживущих веток по платформам, второго runner или release pipeline.

## Подключение внешней компании — конкретный процесс

1. Owner выбирает **какая** компания, какие функции/каталоги, какие данные и сроки. Различать подрядчика кода и партнёра-оператора продукта.
2. GitHub-администратор **после отдельного разрешения** назначает реальные identities/teams, минимальные роли, MFA/SSO при наличии, branch/review protections, CODEOWNERS с существующими командами; сейчас это **НЕ НАСТРОЕНО**.
3. Внешний разработчик делает ограниченный PR, не получает прямого доступа к production, root, secret store или реальной базе игроков. Contract-changing PR требует review владельца API/security и независимую QA.
4. Соответствие Web/Android/iOS оценивается через [платформенную матрицу](../platforms/PLATFORM_DELIVERY_MATRIX.md). Не менять серверные права интерфейсной проверкой; E2E использует synthetic/sanitized fixtures.
5. При завершении договора: revoke доступа, tokens и deploy credentials, передача ADR/contracts/README/runbook, сохранение audit/rollback.

До определения реальных команд **не создавать фиктивный CODEOWNERS**, не выдавать партнёру root/PROD и не включать новые branch rules, которые остановят работающий train. Актуальные статус/задачи — существующие Issues/Projects и CI, не новый реестр в docs. [PR template](../../.github/PULL_REQUEST_TEMPLATE.md).
