# ADR-0002 — Monorepo и модульный backend

Status: TECH_SELECTED по OD-006. Date: 2026-10-01.

## Context / alternatives

У продукта три клиента и небольшая команда. Отдельные repositories/services усложнили бы согласованность contracts и transactional booking. Web-only Server Actions создали бы риск отдельной бизнес-логики для native.

## Decision

TypeScript/pnpm monorepo: web, mobile, api, worker, admin и узкие shared packages. NestJS/Fastify API — modular monolith; Game/Participation находятся внутри одной transactional ownership boundary. Worker — отдельный процесс того же source/release с outbox. Web/mobile/admin не подключаются к БД напрямую.

## Consequences

Согласованные изменения контрактов и клиентов в одном PR; стоимость монолитного release coordination принимается. Границы modules проверяются import rules и тестами. Нет обязательного Redis/Kafka/K8s. `packages/shared` как бесконтрольная свалка не создаётся.

Выделение сервиса допускается после измеренного bottleneck/отдельного ownership/SLO, с отдельным ADR, migration/recovery и event contract. Не нарушать атомарность мест ради раннего разделения сервисов.

## Verification

F-01: clean install/build и import restrictions; F-04: конкурентные транзакции и replay outbox. [Модули](../architecture/MODULE_BOUNDARIES.md), [масштабирование](../architecture/SCALING.md).
