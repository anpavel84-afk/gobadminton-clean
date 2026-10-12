# Project bootstrap — GoBadminton v1

Canonical repository: `anpavel84-afk/gobadminton`.

Загрузить точный commit этой инструкции вместе с [Project rules](../rules/README.md), [Project Record & Handoff Policy](../rules/PROJECT_RECORD_POLICY.md), [Owner decisions](../manifest/OWNER_DECISIONS.md), [манифестом](../manifest/PROJECT_MANIFEST.md), [scope](../product/SCOPE.md), [архитектурой](../architecture/OVERVIEW.md) и документами своего bounded slice.

## Cursor startup

Если работа выполняется через Cursor:
- root [CURSOR.md](../../CURSOR.md) обязателен;
- project-local `.cursor/rules/` обязателен;
- прочитать [CURSOR_ONBOARDING](CURSOR_ONBOARDING.md);
- точный assignment имеет приоритет над общим IDE context;
- Cursor не выбирает следующий task самостоятельно.

## Обязательное исправление предыдущего контекста

GoBadminton **не является BadmintonOpen**, его successor или адаптацией. Owner прямо отменил прежнюю ошибочную связь. Поэтому старые ссылки на BadmintonOpen runtime/Payload/DB/design неприменимы.

## Свежесть и полномочия

Проверить актуальный branch/HEAD, Owner decisions и активные writers до изменений.

При использовании Hub прочитать фактический Project/profile/membership/assignment; отсутствие binding обозначить явно. Bootstrap сам по себе не создаёт Project/Employee/grants/Mission.

Hub availability не отменяет [Project Record & Handoff Policy](../rules/PROJECT_RECORD_POLICY.md): разрешённые working artifacts/prompts/handoffs должны получать durable GitHub representation.

Новая модель не должна заново искать источник в старых чатах, когда есть этот пакет.

## Минимальная готовность по ролям

PM: repo/context/активный work state.  
Product: scope/journeys/open product defaults.  
Architect: Owner decisions + ADR/domain/contracts.  
Design: brief + approved/current visual sources.  
Implementation: exact source, exact slice, allowed effects, checks, target and rollback.  
QA: exact candidate/environment/criteria and independent producer.

В конце bounded работы вернуть short status, exact artifact permalink/commit, выполненные проверки, gaps и следующий разрешённый шаг.

Для handoff использовать [handoff template](../handoffs/HANDOFF_TEMPLATE.md), для project prompt — [prompt template](../prompts/PROMPT_TEMPLATE.md) или эквивалент.
