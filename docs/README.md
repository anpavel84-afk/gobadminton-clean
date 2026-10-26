# Документация GoBadminton CLEAN

**[START_HERE.md](../START_HERE.md)** — единый вход для всех моделей. [AGENTS.md](../AGENTS.md) задаёт границы, [полный регламент](rules/ENGINEERING_OPERATING_MODEL.md) — организацию разработки. [Реестр](rules/DOCUMENT_REGISTER.md) разделяет нормативные документы, контракты, runbooks, drafts и историю.

## Управление разработкой

| Вопрос | Единственный источник |
|---|---|
| Роли и модели, attempts, FAIL/QA/CI/DEV | [Engineering Operating Model](rules/ENGINEERING_OPERATING_MODEL.md) |
| Точная принятая редакция и доставка | [Context Sources](rules/CONTEXT_SOURCES.json), §10 канона |
| Что осталось принять | [AI Train Master Plan](ops/AI_TRAIN_MASTER_PLAN.md) |
| Кто управляет и откуда продолжать | [CURRENT handoff](handoffs/CURRENT.md), точное решение Owner |
| Как хранить решения и evidence | [Project Record Policy](rules/PROJECT_RECORD_POLICY.md) |
| Backlog/приоритеты | [GitHub Issues/Projects](ACTIVE_BACKLOG.md), не копия в Markdown |
| Технический запуск | [Actions train](operations/chatops/ACTIONS_TRAIN.md), точный допуск и installed receipts |

## Предметные документы приложения

Читать их **в exact source/design revision, привязанной к заданию**. Они не заменяют регламент PMA и не дают execution authority. Отсутствующий вход нельзя подменять более старой branch-копией или догадкой.

| Область | Источники |
|---|---|
| Продукт и решения | [Owner decisions](manifest/OWNER_DECISIONS.md), [манифест](manifest/PROJECT_MANIFEST.md), [scope](product/SCOPE.md), [открытые вопросы](manifest/OPEN_DECISIONS.md) |
| Архитектура | [Overview](architecture/OVERVIEW.md), [stack](architecture/STACK.md), [границы модулей](architecture/MODULE_BOUNDARIES.md), [все ADR/Owner decisions](decisions/README.md) |
| Домен и данные | [Модель](domain/MODEL.md), [инварианты](domain/STATES_AND_INVARIANTS.md), [права](domain/PERMISSIONS.md), [данные](data/DATA_MODEL.md), [миграции](data/MIGRATIONS_AND_RETENTION.md) |
| API/auth/privacy | [API policy](api/API_POLICY.md), [OpenAPI](../packages/contracts/openapi.json), [auth](integrations/AUTH.md), [security/privacy](security/SECURITY_AND_PRIVACY.md) |
| UI | [Design materials registry](manifest/DESIGN_MATERIALS.json), [M2R working spec](product/M2R_DESIGN_SPEC.md); [Style Guide first](decisions/OWNER_DECISION_FRONTEND_STYLE_GUIDE_FIRST_V001.md), применимый later Owner override и exact макет; [локальные web instructions](../apps/web/AGENTS.md) |
| Проверки | [Test strategy](quality/TEST_STRATEGY.md), [acceptance matrix](quality/ACCEPTANCE_MATRIX.md), exact критерии текущего задания |
| Окружения и выпуск | [Environments](operations/ENVIRONMENTS.md), [deployment/recovery](operations/DEPLOYMENT_AND_RECOVERY.md) |

## История не равна текущему заданию

[Handoffs](handoffs/README.md), dated `docs/delivery/`, `docs/workbench/`, старые prompts и конкретные receipts сохраняют происхождение решений/результатов. Их команда «следующее действие» не возобновляет старую задачу. Принятые части перенесены в постоянный канон либо соответствующий контракт; непринятые остаются proposal. [Порядок принятия](prompts/pma-adopt-engineering-rules-20261022.md) больше не требует заново выполнять старый PR #217.
