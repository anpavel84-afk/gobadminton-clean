# ADR-0004 — Данные, география и места

Status: TECH_SELECTED. Date: 2026-10-01.

## Decision

PostgreSQL18 + совместимый PostGIS, Drizzle/pg и reviewed SQL migrations. Capacity — инвариант владельца Game/Participation, с Game row lock, unique current participation, external-reserved accounting и audit/outbox в одной транзакции. Availability в кеше не является разрешением подтвердить место.

## Alternatives

SQLite test/prod divergence отвергнут для transaction/geo core. Документная БД или distributed booking на старте усложняют реляционные ограничения. Event sourcing не требуется для audit и повторяемой доставки. NoSQL/search можно добавить как восстанавливаемую read projection по измеренной потребности.

## Consequences

Raw SQL/locks требуют review и настоящих concurrent tests. Одна игра сериализует конкурирующие записи, что соответствует предметной области; это не глобальный lock системы. PostGIS — storage/query capability, не автоматически купленная карта.

## Verification

Q-05–08, Q-14, schema upgrade/restore, query plan/index checks. [Data model](../data/DATA_MODEL.md), [инварианты](../domain/STATES_AND_INVARIANTS.md). Cross-row capacity не защищается одним CHECK constraint.
