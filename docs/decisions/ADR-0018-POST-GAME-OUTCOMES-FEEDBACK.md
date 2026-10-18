# ADR-0018 — завершение игры и контекстная обратная связь

Status: **TECH_SELECTED — implementation pending**. 2026-10-18 UTC.
Product authority: [Owner model v001](OWNER_DECISION_POST_GAME_MODEL_V001.md).
Inspected source: gobadminton-clean dev @ af210f82e65ab028f8e06927a88175d1ac373c31.
Scope: docs/contracts design; no runtime mutation.

## Context

Attendance/GameOutcome существуют как архитектурные понятия, но просмотренные controller/OpenAPI не предоставляют полного сценария. Safety.createReport ограничен player; support_cases/evidence в 0031 имеют internal synthetic-only constraints. Нельзя объявить поддержку реальных споров готовой по наличию таблицы.

## Alternatives

- Attendance как Participation.status: отклонено — смешивает место и факт встречи.
- Один публичный player rating / общая comments таблица с произвольным target: отклонено — смешивает разные факты и ACL.
- Новый сервис/очередь/чат/система жалоб: отклонено — не требуется для модульного монолита.
- Отдельные typed records и команды в существующих модулях: выбрано.

## Decision

Sessions владеет roster context, GameOutcome, Attendance, revisions и correction/dispute commands.
Небольшой Feedback submodule того же backend владеет personal notes, contextual reviews и одной reply.
Safety/Trust сохраняет владение abuse_reports/support_cases; расширяется типизированными ссылками и scoped review, не получает прямой write в Sessions.
Communications доставляет durable in-app notices; push необязателен и не источник истины.

Исторический контекст участия не исчезает после изменения текущего статуса. Attendance version и disagreement lifecycle разделены. Отзывы не требуют положительной manager-отметки: допустима подача с self-attested/contested provenance, но нельзя представить её как установленный совместный опыт. Никаких public/algorithmic reputation effects.

Вся запись — авторизованная локальная SQL transaction с version/idempotency, audit и durable notice intent. Использовать текущую инфраструктуру; не внедрять новый самописный worker. На baseline legacy outbox сам по себе не доказывает работающую доставку.

Полный normative design, ограничения, миграция и матрица прав: [POST_GAME_V001](../architecture/POST_GAME_V001.md). Wire-design: [API addendum](../api/POST_GAME_CONTRACT_V001.md). Проверка/доставка: [delivery pack](../delivery/POST_GAME_DELIVERY_V001.md).

## Consequences

Нужны additive schema/DTO/API, связанный notification/correction UI, independent QA и case-readiness. Больше записей, чем один rating, зато нет бессрочного общего досье и зависимости recourse от чата. Простота обеспечивается тремя attendance values, тремя peer responses, одним reply и одной БД.

## Compatibility / supersession

Дополняет, не заменяет capacity/participation, per-Game authority, friendship, invitation, messaging и auth. Уточняет прежние общие Attendance/GameOutcome строки; для этого сценария current GameManager, не глобальный OrganizerMembership, является authority.
Regular creator initial seat из ADR-0012 сохраняется, но не даёт present/review права автоматически.
Cancelled Game не восстанавливается через outcome. Никакого backfill held/present по времени/confirmed.
Не меняет hosting, Radar, transport, existing release hold или текущие unrelated tasks.

## Verification

Обязательны сценарии PG-Q01…PG-Q18 из delivery pack. Пока выполнено только source/document review; приложение/миграции/CI/DEV/PROD не проверены этой работой. Rollback документации — revert docs commit; будущий runtime rollback не удаляет attendance/dispute/evidence.
