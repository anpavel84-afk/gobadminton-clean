# Документация GoBadminton

**Foundation v1, 2026-10-01.** Связная архитектурная база для web, iOS, Android, backend и дальнейшего развития; не утверждение о готовности продукта.

## Порядок чтения

| Вопрос | Основной документ |
|---|---|
| Какие project rules обязательны для всех? | [Rules index](rules/README.md), [Project Record & Handoff Policy](rules/PROJECT_RECORD_POLICY.md) |
| Что должен прочитать Cursor? | [CURSOR.md](../CURSOR.md), [Cursor onboarding](governance/CURSOR_ONBOARDING.md), [Cursor workflow](governance/CURSOR_EXECUTION_WORKFLOW.md) |
| Как работает очередь Cursor на PLAN? | [Cursor Queue](operations/CURSOR_QUEUE.md) |
| Что строим и что решил владелец? | [Манифест](manifest/PROJECT_MANIFEST.md), [Owner decisions](manifest/OWNER_DECISIONS.md) |
| Что делаем сначала, что откладываем? | [Scope](product/SCOPE.md), [открытые решения](manifest/OPEN_DECISIONS.md) |
| Как устроена система? | [Overview](architecture/OVERVIEW.md), [Stack](architecture/STACK.md), [ADR](decisions/README.md) |
| Какая текущая MVP topology? | [Environments](operations/ENVIRONMENTS.md), [MVP runtime](operations/MVP_VPS_RUNTIME.md), [ADR-0010](decisions/ADR-0010-SPLIT-MVP-HOSTING.md) |
| Где границы модулей? | [Module boundaries](architecture/MODULE_BOUNDARIES.md), [Scaling](architecture/SCALING.md) |
| Как работают игры/места? | [Domain model](domain/MODEL.md), [States/invariants](domain/STATES_AND_INVARIANTS.md) |
| Кто что может видеть/менять? | [Permissions](domain/PERMISSIONS.md), [Security/privacy](security/SECURITY_AND_PRIVACY.md) |
| Как храним/меняем данные? | [Data model](data/DATA_MODEL.md), [Migrations/retention](data/MIGRATIONS_AND_RETENTION.md) |
| Как клиенты общаются с backend? | [API policy](api/API_POLICY.md), [OpenAPI](../packages/contracts/openapi.json) |
| Как устроен вход? | [Auth](integrations/AUTH.md), [Providers](integrations/PROVIDERS.md) |
| Что отличается на платформах? | [Web/admin](platforms/WEB_AND_ADMIN.md), [iOS/Android](platforms/IOS_ANDROID.md) |
| Что проверять и в каком порядке? | [Tests](quality/TEST_STRATEGY.md), [Acceptance](quality/ACCEPTANCE_MATRIX.md), [Slices](delivery/IMPLEMENTATION_SLICES.md) |
| Какое текущее Implementation-задание? | [F-01 Split Runtime v004](prompts/implementation/f01-split-runtime-continuation-v004.md) |
| Кто отвечает и как войти в контекст? | [Team](governance/TEAM.md), [Bootstrap](governance/BOOTSTRAP.md) |
| Где drafts/prompts/handoffs? | [Workbench](workbench/README.md), [Prompts](prompts/README.md), [Handoffs](handoffs/README.md) |
| Откуда требования? | [Sources](reference/SOURCES.md), [Presentation brief](reference/PRESENTATION_BRIEF.md) |
| Что проверено в foundation? | [Foundation handoff](delivery/FOUNDATION_HANDOFF.md) |

## Статусы

**OWNER_CONFIRMED** — Owner decision. **TECH_SELECTED** — delegated technical decision. **PROPOSED_PRODUCT** — product default. **DESIGN_DRAFT** — design contract/draft. **DEFERRED** — future extension. **UNVERIFIED** — fact not established.

Не поддерживаем два источника одного правила. При конфликте обновлять зависимые документы вместе.

Для долговременной памяти действует [Project Record & Handoff Policy](rules/PROJECT_RECORD_POLICY.md).
