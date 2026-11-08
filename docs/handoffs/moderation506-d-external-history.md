# #506 MOD-V2-D handoff — provider avatar quarantine + bounded Admin metadata

Attempt 56. Author: Cursor Auto. Base: actual DEV alpha.55 `edc6744ce0f96dcaa922dafcd373fdab8e482bf8`. One candidate: D1 then D2. No push/merge/deploy by author. Whole #506 not DONE solely by this source.

## D1 — public providerUrl quarantine

Unreviewed VK/Yandex `providerUrl` is null at all four public projection branches:

1. Shared — `avatar-presentation.ts` `avatarForUser` / `avatarForPlayer` / `avatarForGameCreator` (profiles, games, messaging, friendships, radar list/redeem, inbox).
2. Comment author — `comments.service.ts` `projectAuthor` + controller replay quarantine via `projectCommentAvatar`.
3. Unified/batched Radar — `unified.service.ts` avatarMap.
4. Geographic Radar — `geographic.service.ts` player.avatar.

Presentation helper: `profiles/public-avatar-projection.ts` (DTO/replay boundaries only — not a recursive idempotency sanitizer).

Preserved:

- `safeProviderAvatar` for OAuth/identity INGEST (`vk`/`yandex` adapters, `identity.service`).
- M1 uploadedUrl / initials / failed replacement.
- Auth, block, directory, restriction gates on owning reads.
- Historical receipt bytes untouched; HTTP/DTO presentation returns `providerUrl=null` while status/IDs/uploadedUrl preserved.
- No remote download/classification/copy; no mass identity rewrite.

## D2 — bounded Admin metadata

- `GET /v1/admin/audit/moderation` sibling of `audit/security`.
- Permission: existing `audit.security.read` + fresh step-up + `privilegedRead`/`appendAudit`.
- Explicit column projection; keyset `beforeCheckedAt`+`beforeId`; filters surface/decision/policy/model/time.
- Returns approval/binding IDs, surface, decision, provider/model/policy versions, timestamps, resource kind/id/version, human-decision refs; nested bindings capped at 20.
- Honest scope: saved allow/review upsert/cache + bindings only — not append-only attempt history; rejects/temp/budgets not fabricated.
- UI: `ModerationJournal` inside existing Security section; clears on session/permission/step-up loss.
- Cases exact raw source remains assigned/independent/consented/step-up only. Metadata ≠ raw body.
- pilot_viewer / support / content_manager do not gain this global metadata route.

## Contracts / version

- Admin operation inventory 51→52 (`check-admin-protocol.mjs`).
- API additive minor `0.39.0`; app `0.1.0-alpha.56`.
- Trusted alpha.55 seed preserved in `TRUSTED_HISTORICAL_SEED` (deployments 64). No fake acceptance for 56 (`source_sha: null`).
- No migrations / schema / worker / SMTP / quota changes. Quantity-only DEV pause51 unchanged until 2027-01-01 UTC.

## Inventory reference (NOT fresh eligibility proof)

current55 SELECT-only: uploaded refs avatars10 / profilecovers9 / gamecover1 / venuecovers103 / activegallery184, missing matching OpenAI ALLOW 0; stored unreviewed provider metadata VK2 / Yandex1. alpha44/53 counts HISTORICAL — no mass recheck.

## Checks run / NOT_RUN

- `packages/contracts/scripts/check-admin-protocol.mjs` — **PASS** (52 Admin operations; moderation GET present).
- Unit/integration/package test suites — **NOT_RUN** (sandbox lacks installed `node_modules` / PostGIS; parent CI owns full matrix).
- Disposable tests present: `provider-avatar-projection.disposable.test.ts`, `admin-moderation-metadata.disposable.test.ts` (gated on `RUN_DB_INTEGRATION=1`).

Parent owns: independent QA → full CI 7 → guarded DEV 56 → smoke. Author does not push/merge/deploy.

## Remaining NOT_TESTED / open

- Independent QA, Product CI, guarded DEV.56 smoke, Owner UAT.
- Admin UI / GoBad visual for D2 journal.
- Legacy C2 NULL expiry raw unavailable — Owner question unanswered.
- Private external processing OFF; no legal/retention policy invented.
- #507 venue discussion remains separate.
- Whole #506 not DONE by source alone.
