# P4 internal Admin/Venues API

SOURCE_ONLY candidate; not deployed or independently accepted. Exact base and admission are recorded in ADR-0017.

OpenAPI `servers` already includes `/v1`; Admin paths are `/admin/*`. All existing consumer paths/schemas remain intact. Separate Admin host cookie, exact Origin, current database roles, WebAuthn, CSRF, expected versions, reason code, idempotency and no-store apply. Admin is local/test-only and disabled by default. No consumer bearer/cookie fallback.

Venue endpoints under `/v1/admin/venues`: bounded list/create; `/{id}` detail/history; `/{id}/games`; `/{id}/commands` (`edit`, `verify`, `retire`, `restore`, `merge`); `/duplicates` queue; `/duplicates/{id}/dismiss`. Content Manager/Superadmin only. All writes require fresh step-up. Command replay rechecks current authority. Merge requires both source and final target versions. Conflicts return409 and require reload/new confirmation. Edit collision returns `reviewRequired:true` with unchanged Venue/version and commits an audited duplicate candidate. Historical aliases remain resolvable and proposals using old keys reuse the canonical row. Different explicit hall/unit discriminators cannot merge. Restore returns a retired Venue to unverified review.

Current Game list/map use the same moderation projection. Game force-cancel invokes Sessions cancellation; restoration never resurrects a cancelled game. User restriction commands retain capability-specific expiry/reversal and separate deliberate session revocation. Unified/geographic Radar proof paths recheck relevant restrictions; no broad ban flag is added.

Cases and minimal evidence preserve current assignment/role checks on reads and idempotent replay. Policy is disabled unless explicitly synthetic; purge always denied. No global chat browse/export, raw code/token/contact/GPS evidence, real staff privileges, real SMTP or production effects.

The private dependency supplement is cache evidence only. No executor dependency install or future frozen-install claim. Full author checks and independent QA disposition belong to the exact candidate handoff.


## Контакты площадки: T0a-1

`GET /games/{gameId}` добавляет в `venue` необязательные `contactPhone`,
`contactWebsite`, `bookingNote` только для текущего активного управляющего игры
(`game_managers`: `owner` или `manager`, `status=active`) либо участника этой игры
с `participations.status=confirmed`. Значения могут быть `null`.
Для остальных, включая анонимных, pending/rejected/withdrawn/removed,
`cancelled_by_game`, expired, посторонних и заблокированных без указанных прав,
все три ключа отсутствуют. Сам факт блокировки не предоставляет прав.
Списки игр (включая управляемые), карта, discovery и каталог/деталь `/venues`
не раскрывают эти поля. Ответ детали игры остаётся `Cache-Control: no-store`.

Существующая admin-команда `edit` принимает три необязательных строковых поля:
`contactPhone` (до 40), `contactWebsite` (до 300, префикс `http://` или `https://`),
`bookingNote` (до 500). Пробелы по краям удаляются, пустая строка записывает SQL
`NULL`, пропуск сохраняет значение. `contact_updated_at` меняется только при
изменении хотя бы одного значения. Контакты не добавлены в admin create или
новые endpoint/UI; audit, step-up, expectedVersion и idempotency сохраняются.
Ошибки валидации используют существующий problem-формат.

## V1a #170: persisted public profile (UNVERIFIED source)

Exact base `865d02c7ea39ae8210172629c3cb8e20c8fa52a8`; bounded Owner-approved
product scope is model/API V1a. The technical choices here are proposed source,
not independent QA or release acceptance. See [API semantics](API_POLICY.md#v1a-venue-public-profile--170-source-candidate-unverified)
and [source/evidence handoff](../handoffs/V1a-venue-profile-source.md).

Existing edit adds optional `fields.profile` only:

```json
{"action":"edit","expectedVersion":1,"reasonCode":"synthetic_review","fields":{"cityId":"a0000000-0000-4000-8000-000000000001","name":"Synthetic","address":"Synthetic address","timezone":"Europe/Moscow","latitude":55,"longitude":37,"profile":{"courtCount":0,"amenities":{"parking":false,"showers":null}}}}
```

Omit profile to preserve; null clears court_count/amenity_parking/amenity_showers;
a strict complete object replaces all three. Nullable integer range is
0..2147483647; amenities are booleans or null. NULL means unknown; 0/false are
explicit facts. All nested keys are required; unknown/private keys and server-owned
updatedAt/gallery are rejected. Create/propose and private contact write surfaces
are preserved; no arbitrary media URL writes. Migration0039 and schema mirror
add nullable facts/date without defaults, backfill or copies from private data.
List/detail/command responses emit full profile and retain existing cityName
(now declared in OpenAPI). Profile remains optional in the contract for old
API/receipt rollout compatibility.

`profile.updatedAt` is DB-generated stored-public-content edit time since0039,
not verification/factual freshness/import time. Legacy rows remain NULL until
tracked name/address/timezone/location/discriminator/public-contact/fact/cover
binding-or-credit change. Normalized equivalent public input, omission/no-op,
private-only, version/provenance/lifecycle-only edits and replay preserve it.
It never exposes private contact_updated_at or generic updated_at. Pure dynamic
moderation visibility changes do not update it; a cleared cover does. Audit,
history, outbox, receipt and all content/date effects share the existing transaction
and roll back together on failure; audit/outbox contain metadata, not profile or
contact payloads.

Gallery is always coverage=cover_only with zero or one actual current moderated
photo and its safe HTTPS credit, derived from venue_cover_url. The unchanged
attribution string itself must pass URI-format validation; normalizable but
invalid URI text (such as a literal space) excludes the photo. Logo/illustration/
unclassified/unsafe credits, denied moderation, inactive cover actor, retirement,
replacement/removal leave no eligible photo. Empty items assert no full-gallery
inspection. Existing cover stays intact. Full multi-photo gallery remains a
single-cover platform residual; no new media platform, generated photos, rating,
review count, gallery total or fabricated factual default exists.

Keep #142 public organization contact normalization: trimmed ASCII phone bounds,
WHATWG HTTP(S)/IDN URL serialization with normalized length bound and safe
messenger host whitelist; tolerant public reads. Only public_contacts is public.
Private contactPhone/contactWebsite/bookingNote remain confined to #82 detail
for an active owner/manager or confirmed participant of that exact game.
Admin cookie, exact Origin/CSRF, current permission/fresh step-up, expectedVersion,
replay reauthorization, catalog fence, collision no-profile-write and metadata
audit/history/outbox are preserved. No game or Radar changes.

Public N-1 reads safely extract absent columns per-key via to_jsonb; old API on
new additive schema remains supported. Existing generated Game/Unified/Friendship
closures exclude full Venue/AdminVenue/AdminVenueCommand, so these changes use
runtime-vs-OpenAPI AJV tests and unchanged read-only generator checks, no new
or fabricated generator output. Author check evidence and exact NOT_TESTED reasons
are in the handoff. Full source/DB/restore/actual-old-image gates and independent
QA remain integrator duties on the actual published candidate. Roll back the
application while retaining additive schema/data/trigger, without a destructive
down migration. Integrator publishes source/body/handoff tied to #170 with actual
candidate commit/permalinks. V1b, V3b, V2 and operational FR-2 are separate.
