# #506 MOD-V2-D handoff — provider avatar quarantine + bounded Admin metadata

Attempt 59. Author: Cursor Auto. Frozen base `cef05ed3e188b48bfdf7a30998c410ac0afb5ddf`. Coverage-repair only (no product/architecture change). Assignment `OWNER506_D_REAL_ENTRYPOINTS_AND_SEALED_LEGACY_HTTP_REPLAY_REGRESSION`. No push/merge/deploy by author. Whole #506 not DONE solely by this source.

## D1 — public providerUrl quarantine (product already landed)

Unreviewed VK/Yandex `providerUrl` is null at all four public projection branches:

1. Shared — `avatar-presentation.ts` `avatarForUser` / `avatarForPlayer` / `avatarForGameCreator` (profiles, games, messaging, friendships, radar list/redeem, inbox).
2. Comment author — `comments.service.ts` `projectAuthor` + controller replay quarantine via `projectCommentAvatar`.
3. Unified/batched Radar — `unified.service.ts` avatarMap.
4. Geographic Radar — `geographic.service.ts` player.avatar.

Presentation helper: `profiles/public-avatar-projection.ts` (DTO/replay boundaries only — not a recursive idempotency sanitizer). Pure helper shape tests remain in `test/unit/provider-avatar-projection.test.ts` and are not a substitute for HTTP.

Preserved:

- `safeProviderAvatar` for OAuth/identity INGEST (`vk`/`yandex` adapters, `identity.service`).
- M1 uploadedUrl / initials / failed replacement.
- Auth, block, directory, restriction gates on owning reads.
- Historical receipt bytes untouched; HTTP/DTO presentation returns `providerUrl=null` while status/IDs/uploadedUrl preserved.
- No remote download/classification/copy; no mass identity rewrite.

## Attempt 59 — disposable integration coverage repair

File: `apps/api/test/integration/provider-avatar-projection.disposable.test.ts` (gated `RUN_DB_INTEGRATION=1`).

Gap fixed (d58): labels no longer assert locally constructed `{providerUrl:null}` constants or pure-helper DTO calls as projection proof; empty-cookie 401 is not used as the access-loss control.

Now asserts:

1. **Four projections via real entrypoints** — own/public GET; published-game comment create+list; `POST /v1/players/query`; geographic activation + `POST /v1/radar/results/query`; plus `avatarForGameCreator` on a real published game. Stored `external_identities.avatar_url` + `safeProviderAvatar` ingest usability retained. Real OAuth provider login remains **NOT_TESTED**.
2. **Sealed legacy HTTP replay** — real `PUT /v1/me/avatar` and `POST /v1/conversations/requests` complete receipts; disposable-DB embed of safe VK/Yandex `providerUrl` into stored `response_body` while preserving key/hash/status/outcome; same-key/body HTTP replay returns `providerUrl=null` with original resource IDs/status/version/uploadedUrl/receipt fields; stored legacy bytes not rewritten by projection.
3. **Access loss** — session revoke after avatar receipt denies same-key replay; logout after DM receipt denies same-key replay (not empty-cookie-on-first-request).

Allowed paths only for this attempt: the disposable test + this handoff. Product code / versions / contracts elsewhere unchanged.

## D2 — bounded Admin metadata (unchanged product claim)

- `GET /v1/admin/audit/moderation` sibling of `audit/security`.
- Permission: existing `audit.security.read` + fresh step-up + `privilegedRead`/`appendAudit`.
- Explicit column projection; keyset `beforeCheckedAt`+`beforeId`; filters surface/decision/policy/model/time.
- Returns approval/binding IDs, surface, decision, provider/model/policy versions, timestamps, resource kind/id/version, human-decision refs; nested bindings capped at 20.
- Honest scope: saved allow/review upsert/cache + bindings only — not append-only attempt history; rejects/temp/budgets not fabricated.
- UI: `ModerationJournal` inside existing Security section; clears on session/permission/step-up loss.
- Cases exact raw source remains assigned/independent/consented/step-up only. Metadata ≠ raw body.
- pilot_viewer / support / content_manager do not gain this global metadata route.

## Contracts / version

- Unchanged by attempt 59 (test + handoff only). Prior product slice already raised Admin inventory / API minor / app alpha as recorded historically; this attempt does not retouch them.

## Checks run / NOT_TESTED

- Author sandbox: **no** installed `node_modules`, **no** `DATABASE_URL` / loopback PostgreSQL → disposable HTTP suite **NOT_RUN** here.
- Parent owns: `RUN_DB_INTEGRATION=1` disposable suite for this file + reused API types/lint + prior unmodified checks, then independent full D QA.
- Unit helper shapes (`provider-avatar-projection.test.ts`) reused as unit coverage, not as HTTP proof.

## Remaining NOT_TESTED / open

- Independent QA, Product CI, guarded DEV smoke, Owner UAT.
- Real OAuth provider login (not claimed from synthetic session).
- Admin UI / Go Bad visual for D2 journal.
- Legacy C2 NULL expiry raw unavailable — Owner question unanswered.
- Private external processing OFF; no legal/retention policy invented.
- #507 venue discussion remains separate.
- Whole #506 not DONE by source alone.
