# Project bootstrap — GoBadminton v1

Canonical repository: `anpavel84-afk/gobadminton-clean`. The old `anpavel84-afk/gobadminton` remains a historical archive, not an implementation or release target.

Загрузить точный commit этой инструкции вместе с [Project rules](../rules/README.md), [Project Record & Handoff Policy](../rules/PROJECT_RECORD_POLICY.md), [Owner decisions](../manifest/OWNER_DECISIONS.md), [манифестом](../manifest/PROJECT_MANIFEST.md), [scope](../product/SCOPE.md), [архитектурой](../architecture/OVERVIEW.md) и документами своего bounded slice.

## Cursor startup

Если работа выполняется через Cursor:
- прочитать [ChatOps route](../operations/chatops/README.md); legacy root `CURSOR.md` отсутствует в Clean extraction;
- найти exact assigned GitHub Issue через [PM / Projects route](../operations/chatops/PM-CHEATSHEET.md); legacy `.cursor/rules/` отсутствует в Clean extraction;
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

Для handoff и project prompt использовать обязательные поля из [Project Record & Handoff Policy](../rules/PROJECT_RECORD_POLICY.md), разделы 5–6. Legacy `HANDOFF_TEMPLATE.md` и `PROMPT_TEMPLATE.md` отсутствуют в Clean extraction.
