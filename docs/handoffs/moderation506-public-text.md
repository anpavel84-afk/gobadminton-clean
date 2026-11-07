# Handoff · Issue #506 · MOD-V2-A public text (author pass 1)

Source-only candidate. No DONE / QA / DEV / UAT claims.

## Changed routes / services

- `PATCH /v1/me/social-profile` — name/bio create/edit + eligibility restore preflight; bindings
- `PUT /v1/me/social-profile/visibility` — ON requires stored name/bio snapshot; OFF provider-independent
- `PUT /v1/me/trainer-profile` — name/bio + reactivation; deactivate unchanged (no provider)
- `POST /v1/organizers` — displayName + publicContact
- `POST /v1/games` — draft create candidate check (title/host/contact/terms/training/trainer snapshot)
- `POST /v1/games/{id}/publish` — stored snapshot publication check (includes unlisted)
- Radar `start` + unified `start`/`takeover` — existing profile text promotion preflight
- Automatic public name copies → trusted `Игрок` (defaults, avatar missing-profile, Radar bootstrap/seed, unified insert)
- Narrow peer name reads: attendance / feedback / admin disputes / game-chat scrub (no `users.display_name` fallback)

## Migration

- `0061_content_moderation_text.sql` — expand surface CHECK + `content_moderation_bindings`
- Rollback retains additive approvals; restores prior surface allowlist

## Errors

- `422 PUBLIC_TEXT_CONTENT_REJECTED` + `fields` hints (neutral Russian)
- `503 MODERATION_TEMPORARILY_UNAVAILABLE` / policy mismatch UX
- `429 MODERATION_RATE_LIMITED` (text bucket separate from image)

## Tests

- Unit: `local-text-policy.test.ts`, `text-moderation.test.ts` (+ updated social-profile-defaults)
- Integration: `public-text-moderation.test.ts` (requires `RUN_DB_INTEGRATION=1` + disposable Postgres)
- Author sandbox: node_modules/DB absent → integration NOTRUN; parent runs targeted deterministic checks + Codex Sol Medium + Product CI

## Release

- Application `0.1.0-alpha.45` (source_sha/accepted null, Owner UAT NOT_TESTED)
- Historical `alpha.44` seed appended from trusted receipt
- API contract remains `0.37.0` (success shapes unchanged; errors documented in OpenAPI)

## Remaining gaps (not this pass)

- B: comments / public reviews / venue text
- C: private DM/game-chat local safety + message reports (real private egress OFF)
- D: provider-avatar URL suppression + Admin metadata history
- No mass historical text approvals; legacy public text stays legacy_unverified until edit/exposure

## Rollback

Fail-closed: disable defective public text writes via unavailable response while preserving reads/deletes/safety. Do not roll back to unrestricted writers while advertising A active. Additive bindings/approvals retained.
