# Стратегия качества

Статус: **TECH_SELECTED**, тесты приложения ещё не реализованы. Проверка foundation не является независимым QA.

## Уровни проверки

1. Статическая целостность: локальные ссылки документов, JSON-контракт, ссылки схем, operation IDs, ограничения scope. Текущая команда: `python3 scripts/check_foundation.py`.
2. Unit/property tests: state transitions, money/time parsing, permissions и расчёт availability. Property test должен сохранять инварианты при последовательностях request/confirm/withdraw/cancel, а не только проверять happy path.
3. Integration: настоящий PostgreSQL/PostGIS, миграции и конкурирующие транзакции. SQLite/mock repository не доказывают корректность locks, constraints или spatial query.
4. Contract: OpenAPI validation, request/response fixtures, generated SDK, backward compatibility diff. Consumer tests для текущего и предыдущего mobile client после первого релиза.
5. E2E: public web, VK/Яндекс в разрешённом test environment, player/organizer/admin separation, mobile development builds на iOS и Android.
6. Операционные проверки: backup restore, deployment/rollback, rate limits, outbox retry/replay, logs redaction, network/provider failures, согласованный нагрузочный профиль.

## Независимость и evidence

Implementation выполняет self-tests и публикует exact candidate. QA получает этот commit/image, scope, fixtures, окружение и критерии. QA не исправляет приложение в той же review-роли. После исправления — новый candidate и проверка затронутого плюс regression scope. Нельзя выдавать просмотр документов или screenshot за тест backend.

Evidence содержит commit/image digest, schema revision, время, environment, команды/сценарии, реальные результаты, ограничения и producer/reviewer. Секреты и данные реальных игроков в evidence не попадают. Если provider test недоступен, это NOT_TESTED, не PASS.

## Accessibility и визуальное качество

Для каждого critical flow проверяются keyboard/focus, screen reader labels, увеличение шрифта, достаточный контраст, touch targets, reduced motion, error announcement и layout при длинных русских строках. Для web — целевой ориентир WCAG 2.2 AA; это цель проверки, не сертификат соответствия. iOS VoiceOver и Android TalkBack требуют отдельных проходов.

Design Director принимает направление; Visual Designer создаёт экраны/прототип; Spec Engineer уточняет состояния при необходимости. Visual QA сравнивает exact design version и candidate, не заменяя функциональный QA. Токены не считаются утверждёнными только потому, что создана папка.

## Release blockers

Любой обход прав, утечка PII/секретов, overbooking, потеря committed participation, невозможность отмены или непроверенное восстановление real-data системы блокирует соответствующий release. SLO и store/legal gates: [наблюдаемость](../operations/OBSERVABILITY_AND_SLO.md), [открытые решения](../manifest/OPEN_DECISIONS.md).
