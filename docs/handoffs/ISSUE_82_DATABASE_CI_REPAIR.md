# Issue #82 — исправление fixture database CI

- От: source author. Кому: PM / независимый CI reviewer.
- Дата: 2026-10-18. Статус: READY_FOR_REVIEW; результат CI не подтверждён.
- База: `c4b02bc9dadb013c2080573a5c7605fd789e267b`, ветка `automation/issue-82`; исходное рабочее дерево чистое.
- Exact source: https://github.com/anpavel84-afk/gobadminton-clean/blob/c4b02bc9dadb013c2080573a5c7605fd789e267b/apps/api/test/integration/venue-contacts.test.ts

## Поручение и изменение

Только CI repair существующего кандидата T0a-1: database job, run `39131841412`, attempt `1`, шаг `Run bash scripts/chatops/db-ci.sh`. По переданному Owner note разрешена последняя попытка (3/3): исправить INSERT площадки в `venue-contacts.test.ts`, не менять миграцию без доказанной ошибки.

FACT: миграция `0018_venue_catalog_dedupe.sql` требует NOT NULL для `lifecycle_state`, `normalized_name`, `normalized_address` без defaults. Прямой INSERT в migration fixture теперь задаёт `unverified` и нормализует синтетические название/адрес существующей функцией `venue_normalize_v1`. Остальные изменения кандидата, миграции, проверки и assertions сохранены.

## Evidence и ограничения

Прочитаны project rules, canonical context и связанные исходники. Self-QA, тесты, lint и database CI не запускались согласно прямому поручению. Переданный независимый QA PASS относится к базовому SHA, а не к этой правке. Коммит, push, изменение git metadata, automation, сервисов, секретов и deployment не выполнялись. Новый permalink результата должен быть зафиксирован публикующим PM: автору запрещена публикация.

Откат: вернуть только изменённый INSERT и удалить этот handoff; весь исходный кандидат сохранить.

Следующее ограниченное действие: уполномоченному PM передать исправленный candidate в database CI и записать фактический результат с exact SHA. Успех исправления до этого не заявлен.
