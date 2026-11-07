# Handoff — #506 MOD-V2-B1a public comment gate (pass16)

## Assignment

- Issue: #506 continuation (`OWNER506_MOD_V2_B1A_PUBLIC_COMMENTS_FIRST_COHERENT_SLICE`)
- Base: `2650fcbe21976564b8b1ff90aac67ea4eca5b569` (A45 ACCEPTED DEV / PR #508 / `r42393881246-a1`)
- Author: Cursor Auto
- Scope: first coherent B1a public game comment create/reply/edit text gate only
- Not in this pass: B1b role/venue review queues, B2 venue Admin/import text, #507 venue discussion open, release version/history, PROD

## What changed

- `CommentsService.create` / `update`: `findReplay` → short authorize preflight (parent publicity, capabilities already in runner, block/ownership/version) → `ContentModerationService.approveTexts` → `runIdempotent` final fence → `bindTexts` to `entity_comment` + `comment_body` + comment UUID/version/publication.
- Delete remains provider-independent.
- Broad venue writes stay CURRENT runtime closed pending Owner-approved #507 (not permanent by-design); matrix/OpenAPI/comments say the same. `comment_body` catalogue is ready for allowed venue writes when #507 opens.
- Migration `0062_content_moderation_comments.sql` (+ rollback) expands approval/binding CHECKs; never edits 0061.
- Web: existing CommentsSection inline notice path uses `publicCommentModerationNotice`; drafts clear only on validated success.
- OpenAPI: create/update comment document 422 `fields.text`, 503/429 moderation outcomes; success DTO unchanged.
- Coverage matrix updated with A45 evidence + B1a SOURCE_CANDIDATE; B1b/B2/C/D pending; private external egress OFF.

## Checks run by author

- Targeted unit: `text-moderation` comment_body prose/contextual; `comments` policy; web `comments-api` / `comments` composer notice wiring.
- Integration: `public-comment-moderation.test.ts` (fake provider, disposable DB when `RUN_DB_INTEGRATION=1`) — safe create/reply/edit; reject/503 retain body; unauthorized/blocked/stale/venue-closed zero provider calls; same-key replay / hash mismatch; delete zero calls; concurrent parent cancel final fence.
- Migration smoke expects 0062 + rollback-to-0061 surfaces.
- Author did **not** run real provider, live DB, paid analysis, or claim independent QA/CI/DEV.

## Remaining NOT_TESTED / next

- Independent QA (Codex Sol Medium default) + mandatory product CI + guarded DEV release/smoke for this B1a candidate.
- Owner UAT = NOT_TESTED until Owner tests.
- B1b public role/venue review queues; B2 venue/Admin/import text — same #506, later.
- #507 I1 for opening broad venue comments (no partial feature here).
- #507 D/S retained; no #507 source in this pass.
- Parent integrates current accepted DEV + actual receipt before B1 release candidate; no app version/history edits here.
