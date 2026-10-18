# Модель данных v1

Статус: **TECH_SELECTED**, логическая схема до исполняемых migrations. БД ещё не создана. PostgreSQL 18 + PostGIS; одинаковая семантика в local/integration/production.

## Таблицы первого доменного контура

| Таблица | Ключевые поля и ограничения |
|---|---|
| users | UUID PK, status, locale, created_at, deletion_requested_at; никакого глобального взаимоисключающего player/coach role |
| external_identities | user_id FK, provider_key, issuer_namespace, subject, created_at; unique(namespace,subject); email не identity key |
| auth_transactions | state_hash unique, provider, client/audience, PKCE material protected at rest, return_path, binding_hash, expires_at, consumed_at |
| app_sessions | user_id, audience, token_hash/session_hash, family_id, expires_at, revoked_at; индекс active expiry; raw refresh token не хранить |
| player_profiles | user_id PK/FK, display_name, city_id nullable, level_scale_id, level_id, declaration_source |
| organizers | UUID, kind, display_name, onboarding_status, owner metadata; не юридическая сущность по умолчанию |
| organizer_memberships | organizer_id, user_id, role, status; unique(organizer_id,user_id); last-owner policy enforced transactionally |
| cities | country_code, localized names, default_timezone; canonical ID, не свободный текст в каждом Game |
| venues | UUID, city_id, address, timezone, geography(Point,4326), data_status, provenance; GiST(geography) |
| games | UUID, organizer_id, venue_id, starts_at/ends_at timestamptz, timezone, application_deadline_at, status, visibility, capacity, external_reserved_count, format_key, level refs, price_minor bigint nullable, currency, settlement_mode, settlement_terms, version |
| participations | UUID, game_id, user_id, status, attempt_number, version, requested_at, confirmed_at; unique(game_id,user_id) |
| participation_transitions | participation_id, from/to, actor_id, reason_code, aggregate_version, at; append-only для бизнес-аудита |
| game_outcomes / attendance | game_id/participation_id, outcome, attested_by, attested_at, source, correction linkage; не auto-held |
| share_links | game_id, token_hash unique, source_code, expires_at/revoked_at; token не хранить в application logs |
| attribution_touches | pseudonymous actor/context, bounded channel fields, occurred_at; snapshot связан с request attempt |
| outbox_events | UUID, type/version, aggregate_id/version, occurred_at, payload, lease_until, attempts, next_attempt_at, delivered_at |
| idempotency_records | actor_id, operation, key_hash, request_hash, result_ref/status, expires_at; unique(actor,operation,key) |
| notifications / delivery_attempts | recipient, event_id, channel, status, attempt, retry time; unique semantic dedupe key |
| audit_events | actor, action, resource, minimal before/after fields, correlation_id, at; access-limited |

Presence в этой таблице — target первой системы, не требование создать всё до первого read-only каталога. Конкретный migration вводит только таблицы своего среза, сохраняя модель.

## Constraints и индексы

`starts_at < ends_at`; `application_deadline_at <= starts_at`; `capacity > 0`; `external_reserved_count >= 0`; nonnegative money; currency обязателен при известной сумме. Для cross-row capacity одного CHECK недостаточно: применяется протокол [States/invariants](../domain/STATES_AND_INVARIANTS.md).

Начальные индексы: games(venue_id,starts_at,id), games(organizer_id,starts_at,id), partial games(starts_at,id) where status='published' and visibility='public'; participations(game_id,status); participations(user_id,requested_at,id); outbox(next_attempt_at) where delivered_at is null. Любой добавленный индекс проверяется на write cost и реальные планы запросов.

FK не CASCADE-delete исторические игры/подтверждения вслед за User. Удаление аккаунта — controlled pseudonymization/deletion по retention policy. UUID не заменяет access control. Жёсткое ограничение идентификатора провайдера enum в БД не требуется: registry + allowlist, чтобы новые adapters не переписывали User.

## Time / geo / money

UTC instants + исходная IANA timezone. API принимает ISO8601 с offset и timezone; backend проверяет согласованность/неоднозначное локальное время. Смена timezone устройства не меняет дату Game. Для будущих series сохраняются local wall time + timezone и отдельно materialized instants: DST не решается добавлением 24 часов.

GeoJSON/SQL point: longitude, latitude; API объекты явно называют обе координаты. География площадки публична; координаты пользователя запрашиваются только для конкретного поиска и по умолчанию не сохраняются. Distance — метры, не градусы.

API money: строка целого количества minor units + ISO currency, чтобы не терять точность JS. В БД bigint; для будущих расчётов допустим exact numeric по ADR. Никогда float для денежных сумм. RUB — единственная стартовая валюта UI, не единственный код в storage model.

Источники: [S04–S07](../reference/SOURCES.md). Проектная схема не утверждает поддержку миграций, пока не выполнен F-01/F-03.

## Post-game schema extension (design, not applied)

[ADR-0018 model](../architecture/POST_GAME_V001.md#3-владение-и-минимальная-модель) уточняет прежнюю строку game_outcomes/attendance: historical contexts, versioned assertions/revisions/disputes, author-private notes, typed reviews/one reply, existing Safety contexts. Это additive migrations будущего slice; старые файлы SQL immutable. No automatic backfill from confirmed/time. Actual readiness определяется текущими migrations/source, не исторической фразой «БД ещё не создана» в foundation heading.
