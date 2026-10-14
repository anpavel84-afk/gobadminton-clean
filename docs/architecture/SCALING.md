# Расширение без преждевременной распределённости

Статус: **TECH_SELECTED**. Цифры ниже — проектные тестовые ориентиры, не прогноз спроса и не измеренная производительность.

## Что закладываем сразу

Внутренние UUID, independent external identities, явные organization memberships, UTC instant + IANA timezone, currency code + integer minor units, versioned taxonomy уровней, country/city IDs, geo coordinates, API compatibility, transactional capacity и outbox. Эти границы уменьшают число разрушительных изменений; гарантии «никогда ничего не переделывать» нет.

Не добавляем multi-region writes, service mesh, глобальный tenant framework, универсальный спорт-конструктор или абстрактные payment tables до соответствующего этапа.

## Путь роста

| Наблюдаемый симптом | Следующий шаг | Условие |
|---|---|---|
| Медленные discovery-запросы | EXPLAIN ANALYZE, составные/GiST indexes, ограничение результатов | Сначала профилирование на representative dataset |
| API CPU/соединения исчерпаны | Несколько stateless API replicas, connection pool budget, общий limiter | Capacity correctness проверена параллельно |
| Read traffic влияет на записи | Кеш публичной выдачи/реплика | Команды и актуальные права остаются на primary; lag известен |
| Outbox lag растёт | Больше workers с leases, выделение queue transport | Дедупликация, replay и ordering уже проверены |
| Полнотекст/ранжирование не помещаются в SQL SLO | Отдельный search index как восстанавливаемая projection | Не новый источник мест/видимости |
| Один модуль имеет независимые нагрузку/команду/SLO | Архитектурный ADR на выделение сервиса | Владение данными, versioned events, failure/recovery описаны |
| Международный rollout | Regional data plane, provider/currency/timezone policies | Юридический review, data-flow решение и план миграции |

## География

Москва — seed/config, не `if city == Moscow` во всех слоях. Venue хранит страну, город и координаты; Game фиксирует timezone. `homeRegion` у аккаунта/оператора как будущая routing metadata не означает глобально реплицировать все PII. Первый продукт работает в одном data plane.

Дальнейшее региональное разделение сначала по целостному ownership boundary игры/организатора. Один Game не редактируется active-active в нескольких БД. Международный каталог можно собрать из минимальных публичных projections без переноса всех identities/contacts. Точный межрегиональный identity и migration protocol — отдельный ADR перед expansion.

## Совместимость приложений

Mobile обновляется не одновременно с backend. В API v1 разрешены совместимые добавления; нельзя переиспользовать старое поле с новым смыслом. Clients имеют обработку неизвестных enum/status и server capabilities. Breaking change — параллельная версия, telemetry использования и объявленный срок поддержки. Цель: минимум текущая и предыдущая публичные mobile-версии; календарное окно фиксируется перед первым store release.

## Нагрузочный baseline

Предложенный acceptance profile первого load test: 10 000 публичных будущих игр в нескольких городах, 100 параллельных browsing clients и отдельный burst конкурирующих подтверждений последнего места. Не обещаем поддержку этого объёма без измерения. p95/p99, lock contention, DB connections, error rate и outbox lag сохраняются как evidence. Требования времени ответа: исторический `OBSERVABILITY_AND_SLO.md` (отсутствует в Clean extraction; конкретные SLO здесь не восстановлены).
