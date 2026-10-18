# Issue #82 — T0a-1: исправление замечания QA

- From: source author. To: независимый QA / PM.
- Дата: 2026-10-18. Статус: READY_FOR_REVIEW, SOURCE_ONLY, UNVERIFIED.
- Задание: ограниченное исправление после FAIL независимого QA для T0a-1; только разрешённые пути, без commit/push, automation, services или deployment.
- Точная база: `00e3cca242d5e5d5fac1a7952111d0f899f5f5bc`, ветка `automation/issue-82`; рабочее дерево перед изменениями чистое.
- База в GitHub: https://github.com/anpavel84-afk/gobadminton-clean/commit/00e3cca242d5e5d5fac1a7952111d0f899f5f5bc

## Изменение (FACT: правки исходников)

В `apps/api/test/integration/venue-contacts.test.ts` удалены неиспользуемые
`other`, `support`, `venues`, импорт `VenuesService`, функции `get` и `create`.
Удалено создание неиспользуемых admin fixtures; действующие сценарии используют
прежний `content_manager`. Продуктовая реализация и контракты не менялись.
Основной handoff: [T0a-1](ISSUE_82_T0A_1_VENUE_CONTACTS_SOURCE_ONLY.md).

## Проверки и передача

Автор не запускал lint, тесты, contracts check, foundation или self-QA по прямому
ограничению задания. PASS не заявляется. Предыдущий независимый FAIL относится
к указанной базе; исправленный кандидат требует нового независимого QA.
Следующий bounded action: независимому QA проверить API lint и применимые A1–A5
на опубликованном транспортом задачи кандидате. Публикация автором запрещена,
поэтому permalink нового commit здесь отсутствует.
Откат: отменить только локальные изменения этого исправления в тесте и удалить
этот handoff; миграции, данные и runtime не затрагивались.
