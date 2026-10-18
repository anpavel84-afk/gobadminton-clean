# Issue 82 / T0a-1 — контакты площадки

- From: source author (Codex). To: независимый QA / PM.
- Date: 2026-10-18. Status: UNVERIFIED, source-only, не acceptance.
- Exact source/base: `b601d0752da59f30c271787a853f0645046fee6f`.
- Ветка на старте: `automation/issue-82`, рабочее дерево было чистым.
- Base permalink: https://github.com/anpavel84-afk/gobadminton-clean/tree/b601d0752da59f30c271787a853f0645046fee6f
- Assignment: переданный владельцем immutable GOBADMINTON_AUTONOMY_V1,
  target=dev, kind=source_only, T0a-1, max_attempts=3; только разрешённые пути.

## Поручение и границы

Добавить nullable contact_phone (40), contact_website (300, http(s)), booking_note
(500), contact_updated_at в venues новой миграцией 0036 и отразить в schema.ts.
Сохранить прежние create/publish/read flows и совместимость старых API-образов.
Деталь GET /games/:gameId раскрывает три nullable contact-поля только активным
owner/manager или confirmed-участникам именно этой игры. Остальным ключи
не возвращать. Не менять participations, web UI, зависимости, endpoints,
automation, секреты, сервисы, git metadata или PROD; только synthetic fixtures.
Расширить существующий admin edit с trim, пустая строка → NULL, пропуск →
сохранение; timestamp обновлять только при изменении. Сохранить audit,
step-up, expectedVersion, idempotency. Обновить OpenAPI, generated types,
API policy, admin docs и интеграционные тесты. Commit/push и self-QA запрещены.

## Изменения исходников (FACT: файлы записаны; выполнение не подтверждено)

- `apps/api/migrations/0036_venue_contacts.sql`: additive nullable-колонки
  и SQL CHECK. Применённые миграции не редактировались.
- `apps/api/migrations/rollback/0036_venue_contacts.sql`: откат только пустых
  контактов, с блокировкой и отказом при заполненных данных/времени изменения.
- `apps/api/src/database/schema.ts`: зеркало четырёх колонок.
- `apps/api/src/games/games.service.ts`: каноническая проекция контактов;
  opt-in только getGame, SQL EXISTS по game_managers/participations в том же
  запросе чтения. Mapper по умолчанию не включает ключи. Контроллер уже
  передавал viewerId и устанавливал no-store, менять его не потребовалось.
- `apps/api/src/admin/venues.dto.ts`: контакты доступны только в edit,
  create сохраняет прежний strict-набор полей.
- `apps/api/src/venues/admin-venues.service.ts`: обновление контактов в
  существующей транзакции команды, с сохранением version/audit/replay.
- `packages/contracts/openapi.json`, `packages/contracts/src/game.generated.ts`,
  `packages/contracts/src/unified.generated.ts`: необязательные nullable-поля
  venue; optional строки в admin edit. Типы записаны штатными генераторами.
- `apps/api/test/integration/migration.smoke.test.ts`: ожидается 0036.
- `apps/api/test/integration/venue-contacts.test.ts`: синтетическая изолированная
  БД; upgrade N-1/nullable/ledger rerun/rollback; матрица доступа, null,
  отсутствие ключей в списках/карте/каталоге; edit/replay/version/audit,
  API/SQL validation. Статус cancelled представлен существующим SQL-статусом
  cancelled_by_game; blocked — user_blocks без manager/confirmed-прав.
- `docs/api/P4_ADMIN_VENUES.md`, `docs/api/API_POLICY.md`: правила доступа
  и записи. Новых визуальных паттернов нет, apps/web не затрагивается.

## Проверки и ограничения

Self-QA, tests, typecheck, foundation, contracts check и CI не запускались
согласно прямому поручению. PASS не заявляется. Выполнена только генерация
типов командами `node packages/contracts/scripts/generate-game-types.mjs --write`
и `node packages/contracts/scripts/generate-unified-types.mjs --write`.
Независимое prior QA из задания: `{}`.

Тестовый код не заменяет выполненное evidence. Реальный старый API image,
fresh/upgrade/idempotency/restore CI, PostgreSQL backup restore и source jobs
нуждаются в независимой проверке. Тест старой явной SQL-проекции показывает
намерение совместимости, но не является проверкой старого образа.

Контакты раскрываются по точным двум основаниям assignment; social block
сам по себе не даёт доступа и не является новым статусом participations.
Отдельную новую политику отзыва уже существующих confirmed/manager-прав
через social block этот slice не вводит.

Вне allowed_paths необходимые изменения не выполнялись. Новых зависимостей,
реальных данных, внешних запросов, deployment и изменений git metadata нет.
Публикация и exact result commit permalink отсутствуют: commit/push запрещены
в этом assignment. Это локальный handoff для последующей разрешённой
публикации; durable GitHub representation результата пока не создана.

## Откат и следующий bounded action

Обычный rollback приложения сохраняет additive-схему; SQL rollback применять
только к незаполненной установке в транзакции. Нельзя терять контакты при
откате. Исходники можно отменить отдельным последующим разрешённым изменением;
автор не исполнял откат и не стирал работу других.

Следующий получатель: независимый QA. Проверить точный будущий candidate
по A1–A5 задания: fresh/N-1/rerun/restore, старый образ, privacy matrix,
admin gates/audit/version/replay/validation, contracts check/foundation и API
source jobs, allowed_paths. PM затем публикует source/handoff разрешённым
процессом и добавляет exact commit permalinks; этот документ не разрешает
новый slice или deployment.
