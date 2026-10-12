# Выбранный стек

Статус: **TECH_SELECTED**. Дата решения: 2026-10-01. Выбор технологий разрешён OD-006. Совместимость полного runtime ещё не проверена сборкой.

| Область | Выбор | Зачем / ограничение |
|---|---|---|
| Язык | TypeScript, strict mode | Один язык сервисов/клиентов; не один общий UI |
| Runtime | Node.js 24 LTS | Поддерживаемая LTS-линия, а не экспериментальный Current |
| Monorepo | pnpm workspaces | Один lockfile; task runner подключается только при необходимости |
| Public web | Next.js 16, App Router, React | SSR публичных карточек/SEO; self-hosted Node, без обязательного Vercel |
| Mobile | React Native + Expo, Expo Router, development builds | Одна codebase для iOS/Android; native modules допустимы |
| Backend | NestJS 11 + Fastify adapter | Явные module/use-case boundaries, единый API для всех клиентов |
| Worker | Отдельный entrypoint того же backend release | Фоновые задания без отдельной бизнес-модели |
| Persistence | PostgreSQL 18 + поддерживаемый совместимый PostGIS 3.x | Транзакции, geo-index и реляционные ограничения |
| Доступ к БД | Drizzle + `pg`, versioned SQL migrations | Типизированные обычные запросы; parameterized SQL для locks/PostGIS; SQL review обязателен |
| API | REST/JSON, OpenAPI 3.1.1, schema-first | Независимость mobile/web/backend; генерируемый SDK |
| Validation | JSON Schema request/response из API-контракта; Ajv на сервере | Не вести параллельно ручные DTO как второй wire-contract; бизнес-инварианты отдельно |
| Client data | TanStack Query + generated SDK | Серверное состояние отдельно от локального UI; не источник прав/мест |
| UI | Отдельные web/native components, общие design tokens | Не переносить DOM-компоненты в RN и не наследовать чужую дизайн-систему |
| Web/admin styling | Tailwind CSS; семантические компоненты | Native стили независимо, токены общие |
| Файлы | S3-compatible object storage за адаптером | Upload quarantine, signed URLs, нет файлов в БД/Git |
| Async | PostgreSQL transactional outbox + worker leases | At-least-once, idempotent consumers; без обещания exactly-once |
| Auth | Provider adapters VK ID/Яндекс ID + собственные application sessions | Без клиентского хранения provider secret и без auto-merge по email |
| Testing | Vitest, реальные PostgreSQL/PostGIS integration tests, Playwright, mobile device tests | Не подменять SQL-тесты SQLite; mobile checks на обеих ОС |
| Delivery | OCI images, compose для local/раннего isolated DEV; CI в GitHub | Продвижение immutable images, не сборка на PROD |
| Observability | Structured JSON logs, OpenTelemetry-compatible tracing/metrics | Самостоятельное/согласованное размещение, redaction по умолчанию |

## Версии и воспроизводимость

Это выбор технологических линий, не dependency lock. В срезе F-01 Implementation фиксирует точные patch-версии, pnpm `packageManager`, Node patch, image digests, `pnpm-lock.yaml` и результат clean install/build. Для Expo выбирается стабильный SDK на дату F-01, а React/React Native — **только совместимая с ним пара**, не произвольные latest. Версии React web и mobile не обязаны совпадать; каждый app владеет своими peer dependencies.

Не создавать сейчас фиктивный package.json/lockfile без проверенной установки. Каждый последующий upgrade — отдельный PR с migration notes, security check и тестом обоих native targets. Beta/RC не выбираются молча.

## Почему не альтернативы

Swift + Kotlin дают независимые native команды, которые пока не нужны; возможность отдельных native modules сохранена. Один Next.js с бизнес-правилами в Server Actions упростил бы web, но создал бы риск второго API для mobile; поэтому backend отдельный. Полный BaaS связывает identity/data residency с одним поставщиком. Микросервисы добавили бы распределённые транзакции там, где сейчас важнее атомарно подтвердить последнее место.

Drizzle не скрывает SQL: raw SQL только parameterized; extensions/constraints входят в reviewed migrations. CMS можно добавить позднее для редакционных страниц, но она не будет владельцем участия, денег или прав.

Основания по возможностям/поддержке: [S01–S07, S14 в реестре](../reference/SOURCES.md). Не интерпретировать документацию framework как benchmark или подтверждённую ёмкость GoBadminton.
