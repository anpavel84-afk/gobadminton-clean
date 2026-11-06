# Regions #485 — bounded Badminton4u import adapter (DEV)

Source-only OPS adapter for Owner Direct #485. Publishes reviewed `import_ready=yes` regional venues into the existing catalog using current admin/audit/normalize primitives. No product redesign, no PROD, no author-side apply.

## Files

- `tools/venues/import-badminton4u-regions.cjs` — CommonJS CLI + exported validator/planner/runner
- `tools/venues/import-badminton4u-regions.test.cjs` — `node:test` pure validation / injectable client tests
- This handoff

## Runtime assumptions

Execute inside the existing API container with cwd `/app/apps/api` so `createRequire(./package.json)` resolves `pg`, `./dist/venues/venue-normalize.js`, `./dist/admin/admin-db.js`, and `./dist/config/env.js`.

Trusted parent owns: disposable PostGIS integration, deploy locks, reviewed manifest preparation, `--apply` on DEV, and DEV acceptance. Author must not run live import/deploy.

## Manifest schema `REGIONS485_IMPORT_V1`

Allowlisted top-level keys only:

| Key | Rule |
| --- | --- |
| `schema` | Exact `REGIONS485_IMPORT_V1` |
| `batch` | Short slug `[a-z0-9][a-z0-9_-]{0,63}` |
| `sourceArchiveSha256` | Exact `18022f227b237cd7d5b5e193dd0bf1c7b299c843297c4a356b6e2f9cb837221e` |
| `cities` | Exact **11** approved cities (Челябинск / Уфа / Пермь excluded) |
| `venues` | 0..50 reviewed rows; FIRST_15 is the publication priority, not a hard schema count |

### Cities (11)

Frozen `nameRu` → IANA timezone / `nameEn` (validated with `Intl.DateTimeFormat`):

- Новосибирск → `Asia/Novosibirsk` / Novosibirsk
- Екатеринбург → `Asia/Yekaterinburg` / Yekaterinburg
- Казань → `Europe/Moscow` / Kazan
- Нижний Новгород → `Europe/Moscow` / Nizhny Novgorod
- Самара → `Europe/Samara` / Samara
- Омск → `Asia/Omsk` / Omsk
- Ростов-на-Дону → `Europe/Moscow` / Rostov-on-Don
- Красноярск → `Asia/Krasnoyarsk` / Krasnoyarsk
- Воронеж → `Europe/Moscow` / Voronezh
- Волгоград → `Europe/Volgograd` / Volgograd
- Краснодар → `Europe/Moscow` / Krasnodar

Each city also supplies: deterministic `id` (trusted preparation UUIDv5), `centerLatitude` / `centerLongitude`, `centerSourceUrl` (https), `centerCheckedAt`.

### Venues

Required: `id`, `sourceVenueId` (`B4U-V-` + 8 uppercase hex), `name`, `address`, `cityId`, `latitude`, `longitude`, `importReady` literal `yes`, `sourceUrls` (`https://badminton4u.ru/clubs/<digits>`), `clubSources` (`clubId` `B4U-C-<digits>` + name + matching url), `collectedAt`, `nameBasis` (`SOURCE_VENUE_NAME` \| `EXPLICIT_SOURCE_CLUB_LABEL`), `contactSources`.

Optional: `publicContacts` (normal app shape only; empty/null OK; no private fields), `courtCount` ≥ 0.

`id` must equal UUIDv5 (URL namespace) of `gobadminton:badminton4u:` + `sourceVenueId`.

New venues are forced within **40 km** (inclusive) of their city center via planning haversine + SQL `ST_DWithin` (does not filter historical Moscow/SPb catalog rows). Source coordinates are never adjusted.

Unknown keys / `privateRaw*` / unsafe URLs / empty title|address / invalid coords / duplicates / club URL mismatches are hard rejects. Held-for-review rows must not appear in the manifest. Photos/logos/about/reviews are out of scope; cover fallback remains the existing deterministic media path.

A distinct later manifest may carry the 13 explicit source-club fallback names. Flagged phone venues omit phone values until proof.

## Operator CLI

```bash
# default: READ ONLY transaction, no audit/write
node /path/to/tools/venues/import-badminton4u-regions.cjs \
  --manifest /reviewed/regions485.json \
  --manifest-sha256 <sha256-of-file-bytes> \
  --actor-principal-id <active-principal-uuid>

# disposable full write path then ROLLBACK
node ... --manifest ... --manifest-sha256 ... --actor-principal-id ... --trial-rollback

# trusted DEV apply (parent only after QA/CI)
node ... --manifest ... --manifest-sha256 ... --actor-principal-id ... --apply
```

`--actor-principal-id` must be an active principal bound to an active user with active `superadmin` or `content_manager` (`venue.manage`) grant. No session/grant minting.

Modes:

- `DRY_RUN` — `BEGIN` + `SET TRANSACTION READ ONLY`, plan only, `ROLLBACK`
- `APPLY` — `adminTransaction` (admin authority lock) + `gobadminton_venue_catalog` lock, commit
- `TRIAL_ROLLBACK` — same locks/writes/audits as apply, then `ROLLBACK`

## Write contract

- Insert missing cities (`country_code=RU`); exact id/name/timezone reuse; conflicts abort the whole batch
- Insert only **new** venues: `lifecycle_state`/`data_status` = `unverified`, `provenance` = `admin_created`, `created_by_user_id` = validated actor user id
- Identity via existing `venue-normalize` + `venue_identity_keys`
- Durable `review_markers` strings: `SOURCE_VENUE_ID=…`, `REGIONS485_DIGEST=…`, `B4U_SOURCE_V1=<json>`, `B4U_CONTACTS_V1=<json>`
- Per new venue: `appendAudit` (`venue.manage`, reason `owner_regions485_import`) + `venue_admin_actions` + `outbox_events` (same shape as `AdminVenuesService.create`)
- Exact id/source replay with identical immutable facts + contacts + identity → **SKIP**, zero writes/audits
- Contact drift on an existing row → conflict (never overwrite admin-edited contacts)
- Address normalized equality **and** `ST_DWithin` ≤ 150 m with a different id → abort (no auto-merge; name alone never merges)
- No edits/deletes of existing venues/games/users; no status promotion; baseline unrelated venues retained
- stdout: sanitized JSON counts/ids/digest/transactionMode only (no secrets, env, or private fields)

## Tests

```bash
node --test tools/venues/import-badminton4u-regions.test.cjs
```

Parent still runs disposable PostGIS integration before any DEV `--apply`.

## Out of scope / limitations (this milestone)

- Business attribution UI, map packs, and other #485 product surfaces
- Live DB apply, GitHub mutations, PROD, pipeline/`.github` changes
- Replaying the historical 106-row importer (DEMO deletion, game reassignment, municipality reconstruction) — reference only
- Claiming QA PASS or DEV ACCEPTED
