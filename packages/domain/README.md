# Server-only domain

Pure policies/value objects для бизнес-модулей, когда их размещение здесь действительно уменьшает дублирование. TypeScript, без React/Nest/ORM/SDK providers и сетевых вызовов.

F-03 adds capacity invariant helpers in `src/capacity.ts` (INV-01..03). The Nest API currently mirrors the same pure helpers under `apps/api/src/domain/` so the production build stays inside `apps/api/src` (`rootDir` constraint). Keep both copies behaviorally identical until a shared build packaging step exists.

Клиенты НЕ импортируют этот пакет ради получения прав: они используют DTO/SDK и UI capabilities, а сервер всегда перепроверяет. Не превращать пакет в универсальную библиотеку User/Game ORM entities для всех приложений.

[Domain](../../docs/domain/MODEL.md), [state machines](../../docs/domain/STATES_AND_INVARIANTS.md), [module rules](../../docs/architecture/MODULE_BOUNDARIES.md).
