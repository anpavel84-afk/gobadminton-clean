# ADR-0008 — Контракт и совместимость

Status: TECH_SELECTED. Date: 2026-10-01.

## Decision

REST/JSON под `/v1`, schema-first OpenAPI3.1.1, generated SDK, RFC9457 errors. Request/response валидация и локальные domain invariants раздельны. Mutations idempotent, expectedVersion и scoped authorization обязательны. Providers не диктуют внешний GoBadminton API.

## Alternatives

GraphQL/tRPC не выбраны: сейчас нет обоснованной необходимости их гибкости/coupling, а нужен переносимый долгоживущий контракт для store clients. Ручное дублирование интерфейсов в трёх apps создаёт расхождения. Разрешить только newest client означало бы зависеть от одновременного store rollout.

## Consequences

OpenAPI draft нельзя выдавать за endpoint implementation. Полные схемы соответствующего slice замораживаются до code/SDK generation; compatibility checks входят в CI. Старые client versions поддерживаются в объявленном окне; breaking change — параллельная версия и rollout plan, не переименование поля на месте.

## Verification

Static refs check сейчас; полноценная OpenAPI validation/generation F-01, contract fixtures и backwards-compatibility tests по slices. [API policy](../api/API_POLICY.md), [contract](../../packages/contracts/openapi.json).
