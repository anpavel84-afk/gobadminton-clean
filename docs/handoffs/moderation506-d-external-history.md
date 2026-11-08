# #506 MOD-V2-D handoff — provider avatar quarantine + bounded Admin metadata

Attempt 61. Author: Cursor Auto. Frozen base `be37d222dfc4fef637d2eb35079faa01454f83d1`. Repair of exact two independent full D QA60 findings (no product/architecture repeat). Assignment `OWNER506_D_QA60_LEGACY_GAME_AVATAR_AND_APPLIED_FILTER_SCOPE_FIX`. No push/merge/deploy by author. Whole #506 not DONE solely by this source. Actual DEV55 accepted; D target 56 / API 0.39 unreleased.

## HIGH — games.create/publish/cancel receipt organizer.avatar.providerUrl

QA60: cached GameDto receipts could embed legacy `organizer.avatar.providerUrl`; `GamesController` returned `result.body` unsanitized after service authorization.

Fix (presentation only):

- `projectGameOrganizerAvatar` in `profiles/public-avatar-projection.ts` (reuses `projectPublicAvatar` / PlayerAvatar quarantine).
- Applied to all three controller responses after service auth: create, publish, cancel.
- Preserves `statusCode` / id / status / version / uploadedUrl / other DTO fields; does not rewrite stored receipt bytes.
- No GamesService / auth / lifecycle / venue / permissions / image-provider / cache-DB changes.

Coverage:

- Unit: helper keeps uploadedUrl, nulls providerUrl, preserves id/status/version (`provider-avatar-projection.test.ts`).
- Disposable HTTP (`provider-avatar-projection.disposable.test.ts`, `RUN_DB_INTEGRATION=1`): real create → publish → cancel with stable keys/bodies; embed legacy organizer.avatar.providerUrl into each completed receipt; same-key/body replay returns `providerUrl=null` with other fields + stored legacy bytes preserved; session revoke denies create replay (existing auth-loss pattern). Existing avatar/DM sealed replay + M1 uploadedUrl proof retained. GamesModule added to this disposable harness only.

## MEDIUM — ModerationJournal draft filter + load-more cursor mix

QA60: load-more used live draft `filtersRef` with the old page cursor, so editing draft surface then clicking «Ещё» without «Обновить» mixed filter contexts.

Fix:

- Keep draft inputs separate from an **applied** filters snapshot of the loaded page.
- «Обновить» / initial fresh load: first page with draft filters, then set applied = draft (replace, no cursor).
- «Ещё»: uses applied filters + existing cursor only; disabled while draft ≠ applied (explicit refresh required; no auto-refetch loop).
- Request generation + mounted guards avoid stale responses committing the wrong scope.
- Role / step-up / session clearing / bounded responses / no raw metadata unchanged.

Coverage: mounted-state behavior regression in `moderation-journal.test.tsx` (Cases/journal harness): first filtered page → edit draft → More disabled → restore draft → More keeps applied+cursor and appends → refresh new filter replaces without mixed rows. Existing affordance checks retained.

## Allowed paths only

`games.controller.ts`, `public-avatar-projection.ts`, avatar projection unit + disposable integration, `ModerationJournal.tsx` + behavior test, this handoff. No versions/contracts/migrations/schema/roles/provider/quota flags/API shape changes.

## Checks / NOT_TESTED

- Author: proportional unit + Admin journal behavior where runnable; disposable HTTP suite requires loopback DB (`RUN_DB_INTEGRATION=1`) — parent owns full changed HTTP/API/Admin types lint/unit/behavior; unchanged metadata3/M1/release/contracts proof reused.
- Independent delta QA (two findings + actual delta), full CI7 → DEV56, Product CI, guarded DEV smoke, Owner UAT: **NOT_TESTED** here.
- Real OAuth login / authorized DEV Admin session / physical device: **NOT_TESTED**.
- Original QA FAIL/HOLD/recovery/cost history retained; not DONE / source PASS alone.
