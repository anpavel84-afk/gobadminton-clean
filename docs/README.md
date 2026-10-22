# Документация GoBadminton CLEAN

## Работа и управление

**Первый вход:** [AGENTS.md](../AGENTS.md). **Единый действующий регламент:** [Engineering Operating Model](rules/ENGINEERING_OPERATING_MODEL.md). **Запись и передача:** [Project Record Policy](rules/PROJECT_RECORD_POLICY.md).

[Bootstrap](governance/BOOTSTRAP.md), [PMA checklist](operations/chatops/PM-CHEATSHEET.md), [окружения](operations/ENVIRONMENTS.md), [Actions train](operations/chatops/ACTIONS_TRAIN.md), [выпуск и восстановление](operations/DEPLOYMENT_AND_RECOVERY.md) — прикладные представления регламента, не альтернативные источники полномочий.

## Продукт и инженерные контракты

| Вопрос | Источник |
| --- | --- |
| Решения и объём | [Owner decisions](manifest/OWNER_DECISIONS.md), [манифест](manifest/PROJECT_MANIFEST.md), [scope](product/SCOPE.md), [открытые решения](manifest/OPEN_DECISIONS.md) |
| Архитектура | [Overview](architecture/OVERVIEW.md), [stack](architecture/STACK.md), [границы модулей](architecture/MODULE_BOUNDARIES.md), [ADR](decisions/README.md) |
| Домен и данные | [Модель](domain/MODEL.md), [инварианты](domain/STATES_AND_INVARIANTS.md), [права](domain/PERMISSIONS.md), [данные](data/DATA_MODEL.md), [миграции](data/MIGRATIONS_AND_RETENTION.md) |
| API и доступ | [API policy](api/API_POLICY.md), [OpenAPI](../packages/contracts/openapi.json), [auth](integrations/AUTH.md), [security/privacy](security/SECURITY_AND_PRIVACY.md) |
| UI | [Style Guide first](decisions/OWNER_DECISION_FRONTEND_STYLE_GUIDE_FIRST_V001.md), [попапы карты](decisions/OWNER_DECISION_MAP_POPUPS_V001.md), exact принятый макет задачи |
| Проверки | [Test strategy](quality/TEST_STRATEGY.md), [acceptance](quality/ACCEPTANCE_MATRIX.md), exact критерии задачи |

Предметные документы не переопределяют current executor, host, backlog и routing. Датированные источники/старые commit-ссылки — provenance, не сегодняшняя готовность.

## История и изменения правил

[Отчёт ревизии 22.10.2026](workbench/rules-revision-20261022/REVIEW.md) фиксирует найденные противоречия и замены. [Задание PMA на включение](prompts/pma-adopt-engineering-rules-20261022.md) отделяет публикацию правил от их применения и технического commissioning.
