# Документация GoBadminton CLEAN

## Эталон системы разработки

**[ENGINEERING_OPERATING_MODEL.md](rules/ENGINEERING_OPERATING_MODEL.md)** — единственная полная целевая архитектура и регламент PMA. В одном тексте: компоненты и размещение, два интерфейса одной роли PMA, планирование и выбор моделей, два слота, обязательный экспертный разбор FAIL через Astra High, независимая QA, выпуск, бюджеты, контекст и приёмка.

Вход: [AGENTS.md](../AGENTS.md). Хранение/передача: [Project Record Policy](rules/PROJECT_RECORD_POLICY.md). [Bootstrap](governance/BOOTSTRAP.md), [PMA checklist](operations/chatops/PM-CHEATSHEET.md), [окружения](operations/ENVIRONMENTS.md), [Actions train](operations/chatops/ACTIONS_TRAIN.md), [выпуск и восстановление](operations/DEPLOYMENT_AND_RECOVERY.md) — scoped применение/навигация, не конкурирующие источники полномочий.

## Архитектура пользовательского приложения

| Вопрос | Источник |
| --- | --- |
| Решения и объём | [Owner decisions](manifest/OWNER_DECISIONS.md), [манифест](manifest/PROJECT_MANIFEST.md), [scope](product/SCOPE.md), [открытые решения](manifest/OPEN_DECISIONS.md) |
| Архитектура приложения | [Overview](architecture/OVERVIEW.md), [stack](architecture/STACK.md), [границы модулей](architecture/MODULE_BOUNDARIES.md), [ADR](decisions/README.md) |
| Домен и данные | [Модель](domain/MODEL.md), [инварианты](domain/STATES_AND_INVARIANTS.md), [права](domain/PERMISSIONS.md), [данные](data/DATA_MODEL.md), [миграции](data/MIGRATIONS_AND_RETENTION.md) |
| API и доступ | [API policy](api/API_POLICY.md), [OpenAPI](../packages/contracts/openapi.json), [auth](integrations/AUTH.md), [security/privacy](security/SECURITY_AND_PRIVACY.md) |
| UI | [Style Guide first](decisions/OWNER_DECISION_FRONTEND_STYLE_GUIDE_FIRST_V001.md), [попапы карты](decisions/OWNER_DECISION_MAP_POPUPS_V001.md), exact принятый макет задачи |
| Проверки продукта | [Test strategy](quality/TEST_STRATEGY.md), [acceptance](quality/ACCEPTANCE_MATRIX.md), exact критерии задачи |

Предметные документы не переопределяют executor, host, backlog и routing. Dated evidence и старые commit-ссылки — provenance, не сегодняшняя готовность. Ревизия архитектуры разработки не меняет бизнес-инварианты приложения.

## Принятие и история

[Инструкция PMA](prompts/pma-adopt-engineering-rules-20261022.md) — штатное принятие и проверка фактической загрузки. [Ревизия 22.10.2026](workbench/rules-revision-20261022/REVIEW.md) — исторический отчёт очистки правил. Текущую редакцию менять в постоянном каноническом файле; runtime готовность подтверждать отдельно.
