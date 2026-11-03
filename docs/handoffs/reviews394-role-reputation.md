# Handoff · #394 role reputation consumer UI + safe contract projection (attempt 24)

Assignment: `OWNER394_ROLE_REPUTATION_CONSUMER_UI_AND_SAFE_EXISTING_CONTRACT_PROJECTION`
Base: `2bb9fc8df60894ac3b0449720b1620e721655731`
Attempt: **24** · continues preserved #394 history (not UNKNOWN replay)
Parent: #372 · same coordinated PR; Admin UI + alpha20 release are **next** sequential pass (not this scope)
C5 OFF · PROD forbidden · no Git commit/push/deploy / no dependency install in this author pass

## Inputs viewed

| Material | Path | Notes |
|---|---|---|
| training-list desktop/mobile | design-inputs `training-list-*.png` | Trainer identity + reviews before join; card footer actions |
| organizer profile desktop/mobile | design-inputs `organizer-profile-*.png` | Held count + reviews; both roles; no skill rating |
| public composer desktop/mobile | design-inputs `public-composer-*.png` | Personal-to-organizer default; public consent separate |
| CURSOR_BRIEF.md | design-inputs | v2 usecase / seams |
| disposable-admin log | design-inputs | `not_held` fixture failed `game_outcomes_check` (reason required) |

## Scope of this pass

Consumer UI + necessary API companions. Sections 4 (Admin UI) and 7 (alpha20) deferred to next pass on same coordinated PR — **not** partial DONE of the full delivery.

### Backend companions
1. **`profileSurfaceOpen`** — full directory gate: `SOCIAL_DIRECTORY_ENABLED` + `directory_visible`/`social_eligible`/`active` + `unrestrictedSql(... account.access, profile.public, social.directory)` + blocks (aligned with `ProfilesService.getDirectoryPlayer`). Opaque handle alone cannot bypass restrictions.
2. **`gameSurfaceOpen`** — `publicModerationSql` / taken_down fence; private/unlisted uses `GameAttendanceService.resolveAccessRole` (historical own access), not blind `withdrawn|removed` membership. Public surface still readable without attendance/login.
3. **Legacy CLEAN held derivation** in unapplied `0054_role_reputation.sql`: provenance `legacy_game_contract` from immutable `organizer_id IS NULL` + `created_by_user_id` / `trainer_profile_id`→`trainer_profiles.user_id` + explicit `held`. Excludes legacy `organizer_id` nonnull, cancelled, not_held. No current-manager guess.
4. **Batched** `GET /v1/role-reputation-summaries?gameIds=` + discovery `trainerRoleHandle` filter (opaque handle ≠ authorization).
5. Admin disposable fixture: `not_held` UPDATE supplies `reason`; restore to `held` clears reason (0042 constraint). **Do not** alter production authorization.

### Consumer UI
- `RoleReputationPanel` / `RoleReputationCardActions`, `RoleReviewsDialog`, `RoleReviewComposer`, `RoleReviewsHistory`
- Wired: discovery cards (batched), `GameTerms` before join, public player profile both roles, My Games history `RoleReviewsHistory`, private org labels → «Организатору лично»
- Typed api-client + consumer-types; public handle/revision from responses; UNKNOWN latch on report/reply/create; consent unchecked + reset on edit/role/subject/session
- CSS: `role-reputation.css` (Spacious40 / Onest / forest / lime; ≥44px)

## Paths touched (allowed)

`apps/api/src/games/role-reputation.{service,dto,controller,policy}.ts`, `games-discovery.query.ts`, `games.controller.ts`, `migrations/0054_role_reputation.sql`, OpenAPI, web api-client/consumer-types, discovery/detail/profile/feedback components, new Role* components + CSS + tests, handoff.

## Author checks run / not run

| Check | Result |
|---|---|
| Unit discovery + policy | source written; **notrun** (no node_modules in author slot) |
| UI role-reputation.test.tsx | source written; **notrun** |
| Disposable admin/consumer HTTP | **notrun** — PMA after import; fixture reason fix included |
| Product CI / security / DEV smoke | not claimed |
| Independent QA | not started |
| Owner UAT | NOT_TESTED |

## Remaining gates (same coordinated PR)

1. **Next pass:** Admin Cases RoleReputation child UI; alpha20 / API note / release history seed
2. Trusted PMA: migrate 0054, types/contracts, disposable HTTP (PostGIS), targeted UI tests, Product CI, DEV smoke
3. Independent Codex Sol Medium QA
4. Merge `dev` → DEV ACCEPTED; human moderation UAT = NOT_TESTED until authorized Admin session observes decide path
5. Do not claim source finished = DEV / human UAT

## Notes

- Private PG-3 never published via this path; venue writer CLOSED; Mode B / AGY READY not claimed.
- Missing legacy history stays unavailable / incomplete — not «never hosted», not invented 15/20.
- Source PASS ≠ DEV claim.
