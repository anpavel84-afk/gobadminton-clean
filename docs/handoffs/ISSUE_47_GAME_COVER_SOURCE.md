# Issue 47 — independent game photo and live venue inheritance

From: source author. To: trusted publisher → independent exact-SHA SOURCE QA.
Date: 2026-10-16. Status: UNVERIFIED / NOT_TESTED. Prior independent QA supplied: `{}`.

Base: `bc6d98230a890998bff846956bf6fdd4a35dbde7`, initially clean branch `automation/issue-47`.
Exact base reference: https://github.com/anpavel84-afk/gobadminton-clean/tree/bc6d98230a890998bff846956bf6fdd4a35dbde7
This is the supplied claim checkout. Accepted DEV provenance cannot be established from this checkout alone; do not relabel it ACCEPTED. It includes migration 0034 and venue-cover source. No live release record, account, database, environment, service or deployment was accessed.

## Authorized bounded assignment

Caller supplied immutable `GOBADMINTON_AUTONOMY_V1`, `target=dev`, `kind=source_only`, `max_attempts=3`, Issue 47. Only paths under `apps/api/**`, `apps/web/src/**`, `apps/web/test/**`, `apps/web/public/**`, `packages/contracts/**`, `docs/handoffs/**` may change. No commit, push, Git metadata modification, automation, secrets, services, PROD or self-QA. No new task, media/RBAC/moderation stack, queues, design system or second writer. Existing assignments remain untouched.

Owner behavior: two upload/edit targets only: authorized venue management and optional image for one game during existing creation, with replacement/removal under current game-management rights. Ordinary organizers require no global admin role. Effective priority is approved own-game image → current approved cover of the immutable stored game venue → standard default. Venue media is never copied into a game. All public media must use decoded/sanitized/moderation-approved derivatives and current resource authorization. Preserve game confidentiality, replay/session/actor/CAS/rate rules and organizer avatars. Same effective image in Discovery, cards, detail, My Games and map schedules. Existing venue management remains separately authorized.

## Source implementation facts (not executed behavior)

- Additive `apps/api/migrations/0035_game_cover.sql`: nullable game-owned key/approval/actor binding, current approved own/effective URL functions, existing GC trigger, account-retirement cleanup. Exact fallback uses `g.venue_id`, including when venue display data resolves a merge chain. No copied venue key and no input URL.
- `GameCoverService` and controller provide GET/PUT/DELETE `/games/{gameId}/cover` through consumer session auth, Origin/CSRF, shared Game version CAS, actor/session-fenced MutationRunner, current Game owner/manager authorization and reauthorization on replay. Preflight scopes the game before decoding/provider work. Provider remains synchronous and uses existing image policy/rate budgets; bounded image processing and existing stage verification bind exact approved sanitized bytes. Only draft/published games can change media.
- GET `/media/game-covers/{key}` checks current approved own slot, existing Game detail viewer rights, reads storage, then rechecks access/current key. `no-store`, `Vary: Cookie`, nosniff and sandbox CSP. Game keys are never resolved by venue/profile/global image routes. Draft/unlisted media is manager-only, matching current Game detail rights; no new invitation/share-token entitlement is invented.
- Existing avatar store collector also recognizes game references. Replaced/deleted files are journaled; inactive uploader slots are retired. Public own images hidden by moderation are withheld, retaining a removable owner slot and safe venue/default fallback.
- Common Game projection and map preview SQL expose additive `cover`. Venue cover projection now also uses immutable `g.venue_id`. API contracts/generated types updated. Clients use `GameCover` for discovery, GameCard, detail, personal cards and own upcoming games. Map venue schedules already reuse DiscoveryGameCard. Venue photograph and organizer avatar remain separate.
- Create form uses optional local selection/crop/preview/confirmation, then existing create-draft → approved cover upload → publish with the updated Game version. No selected photo uses the original create/publish path. Failed or uncertain image upload leaves a draft and stops publishing. The management screen can retry/replace/remove and publish the retained draft through the existing publication API. No second cover picker or navigation replacement.
- Existing profile-cover editor is removed from ProfilePage, and profile cover HTTP writes are retired to enforce two edit targets. Existing legacy profile media/read privacy and internal storage code remain. This is an intentional compatibility consequence of the explicit two-location rule; older clients attempting `/me/cover` PUT/DELETE receive 404. Legacy storage/privacy regression tests now seed via the internal service rather than exposing a third public write route. Account retirement still cleans legacy images.

## STYLE_GUIDE_PARITY

Authority read: `docs/decisions/OWNER_DECISION_FRONTEND_STYLE_GUIDE_FIRST_V001.md`; canonical published references https://nougat-wise-76949869.figma.site/#guide and https://nougat-wise-76949869.figma.site/#construction-kit . Frozen source identity recorded by that decision: `5a04ac69a259245c72da3ed5618326e8398396b4dd2c861b6eef4aecd726b1d6`.

Patterns named by authority and retained: Forms/FormGroup/validation, Buttons/input/range controls, media/image blocks, GameCard, existing detail media and personal cards, status/error notices. Existing screen navigation and composition remain. The game editor composes these families without new CSS/tokens or layout systems. It reuses existing bounded media preprocessing and crop behavior.

`STYLE_GUIDE_GAP`: `docs/operations/FRONTEND_STYLE_GUIDE_FIRST_V001.md` is absent in this checkout. Frozen Make source is not present locally; PLAN is excluded from this assignment and no external reference was fetched. Exact screen-specific Make parity and the canonical standard image appearance are UNVERIFIED. No frozen reference is invented and existing frontend is not claimed as visual authority. The bounded extension is optional game-photo selection inside the current form and management flow using the families listed in the Owner decision. No `OWNER_VISUAL_OVERRIDE` was supplied. Independent visual QA must compare actual guide/kit and screen-specific source before acceptance. Existing venue/default media component is reused, not presented as newly verified canonical design.

## Evidence and actual results

- Source author read canonical rules and inspected source. Initial worktree was clean; exact base is above.
- Contract Game types were regenerated with the existing generator (`--write`), not validated.
- Tests, typecheck, lint, build, disposable PostGIS, hosted CI, browser execution, authenticated UAT and runtime checks: **NOT_TESTED**, per explicit no-self-QA instruction. There is no author PASS or independent QA result.
- Added API executable cases in `apps/api/test/integration/venue-cover.test.ts`: ordinary consumer game creation, own/venue/default priority, two games, current venue replacement, removal/hide, draft/unlisted confidentiality and cross-route negatives, real sanitized image dimensions/metadata, provider rejection, CSRF/foreign/session/replay/CAS/concurrent replacement, budgets, retirement and additive upgrade/rollback. Runs only under the existing disposable DB integration gate. Unit contract tests cover Game CAS and retired third write target.
- `apps/web/test/game-cover.test.tsx`: rendering/projections, safe URL filtering, optional local selector and upload/delete wire protocol. `apps/web/test/game-cover.browser.mjs`: executable loopback mobile/desktop management selection/crop/confirmation, uncertain save reconciliation/retry, replacement, own priority after venue change, deletion to current venue/default and denied controls. Browser script requires an independently prepared local web server and the existing Playwright tool installation; it does not start services or use live accounts. Mocked browser evidence cannot substitute for authenticated hosted UAT.

## Rollback and review limits

Before publication, discard only this author's task edits; no Git changes are performed by the author. After release, use the normal previous immutable images/source rollback procedure under authorized release control. Keep additive schema 0035 and a cover-aware collector: the pre-47 collector does not know game references and must not sweep retained game media. Do not run schema rollback on populated slots. `migrations/rollback/0035_game_cover.sql` is for unused installations only, refuses populated slots under a table lock and must run transactionally with writers stopped by the authorized operator. No rollback has been executed.

Publication, accepted-base provenance, new exact-SHA independent SOURCE QA, full same-SHA hosted Product CI with disposable PostGIS, normal DEV backup/images/smoke/receiver/ACCEPTED records and real authenticated synthetic mobile/desktop UAT remain separate gates. Do not infer product DONE, accepted DEV, pending=false or PROD from this source handoff. Preserve NOT_TESTED/history. Product UAT must show independent venue/game sources, inheritance-only propagation, own priority/deletion, foreign/private/unmoderated negatives and actual guide parity.

One next bounded action: trusted publisher records the exact candidate SHA and commit permalinks for this handoff/source, then hands that SHA to independent SOURCE QA. This author is forbidden to commit/push; no candidate permalink or durable GitHub publication is claimed here.

## Bounded repair after independent SOURCE QA FAIL (2026-10-16)

Repair base/reviewed SHA: `8de7ae100b7764139b8c9e7ece2f0112b2772424`, clean `automation/issue-47` at entry.
Exact reference: https://github.com/anpavel84-afk/gobadminton-clean/tree/8de7ae100b7764139b8c9e7ece2f0112b2772424
The caller supplied independent QA **FAIL** on that SHA: (1) cancelling preprocessing left preparation busy forever; (2) executable create-flow coverage was missing. This supersedes the initial “Prior independent QA supplied: {}” only for this repair; earlier source history is retained.

Source changes in this repair:
- `apps/web/src/components/consumer/games/GamePhotoSelection.tsx`: clearing selection resets preparation immediately and the no-file effect also clears it. Aborted work remains fenced from updating the current selection; its cleanup still releases preview resources.
- `apps/web/test/game-cover-create.browser.mjs`: executable real-page synthetic browser scenarios at 360/1440 widths. Holds actual image decoding pending, cancels selection, asserts busy/progress reset, enabled form, no late preview, and successful no-photo creation. Separately drives confirmed custom selection → draft version 7 → upload receipt version 11 → publish with version 11; moderation 422 and committed-but-lost upload response both stop publication and reconcile the retained draft. Explicit no-image case publishes with original draft version and never calls cover upload. Requests are intercepted, same-origin only, with synthetic session/venue/game data. Checks local selection causes no writes and game mutations retain CSRF/CAS. Existing management/browser/projection tests remain in place.

STYLE_GUIDE_PARITY for repair: no visual composition, CSS, tokens, copy or navigation changes. Only existing preparation-state behavior and executable coverage change. Original guide references, missing operations document/frozen-source gap and UNVERIFIED visual parity remain unchanged; no new visual pattern or override is claimed.

Actual results: author read source/rules and wrote the above files. **NOT_TESTED**: new browser regression, all existing tests, typecheck/lint/build, disposable DB, CI and hosted UAT. No self-QA was run, no PASS asserted, no services started, no Git metadata/commit/push or deployment performed. Independent QA must execute against the new published exact SHA; the previous FAIL is not cleared by this source repair.

Independent execution entry point, from repository root with the existing Playwright tool installation and an independently prepared local Web build/server: `P1_ORIGIN=http://127.0.0.1:18984 node apps/web/test/game-cover-create.browser.mjs`. Runner refuses a non-loopback hostname, starts no server and contacts no live account. Continue running existing management runner and required same-SHA source/CI/product gates; mocked browser tests are not authenticated hosted UAT.

Rollback: remove only the repair changes in the selector, new browser runner and this handoff addition before publication. No schema/API/runtime changes in this repair. Next bounded recipient/action remains trusted publisher → independent exact-SHA SOURCE QA; publishing is prohibited to this author, so this local artifact has no new commit permalink yet. No product acceptance or accepted DEV provenance is claimed.

## Bounded preview round-trip repair after independent SOURCE QA FAIL

From: source author. To: trusted publisher → independent exact-SHA SOURCE QA.
Date: 2026-10-16. Status: UNVERIFIED / NOT_TESTED.
Base/reviewed SHA: `f89c69ba2075644bf0521388d8955fd89749cea2`; branch `automation/issue-47`, clean at entry.
Exact source: https://github.com/anpavel84-afk/gobadminton-clean/tree/f89c69ba2075644bf0521388d8955fd89749cea2

Caller supplied independent FAIL: confirmed selection disappeared from the editor after publication-preview → «Назад к редактированию», while the parent retained an uploadable photo. The selector's file, crop and derivative were unmounted independently of the parent's confirmed Blob.

Source repair: `apps/web/src/components/consumer/pages/CreateGamePage.tsx` retains the existing form and selector instance across form/preview navigation. Header/form are hidden during preview, with explicit display suppression so existing layout CSS cannot override the hidden state. Their controls leave the accessibility tree and keyboard navigation. Other steps still unmount the form, including session reset/loading. No extra picker, URL persistence, API/schema or upload-policy changes.

Executable regression: `apps/web/test/game-cover-create.browser.mjs` adds `roundtrip` and `roundtrip-remove` at 360/1440 widths. Select and confirm a noncentral crop, enter preview, return to editing, assert the same preview URL, both crop values, confirmation status and enabled form. Assert preview hides editor controls. Change the restored crop and require reconfirmation before normal upload/publication; separately remove the restored selection and publish without a cover write. All selection/navigation operations remain local. Existing cancellation, no-photo, moderation rejection and uncertain-receipt scenarios remain.

STYLE_GUIDE_PARITY: no new visual component, composition, copy, CSS class, token or screen navigation. Existing Forms/FormGroup, media/image and Button families remain; only their lifetime/visibility changes across existing steps. Canonical authority remains the Owner decision and guide/kit URLs cited above. Previously recorded missing operations document/frozen-source gap remains UNVERIFIED; no new reference or OWNER_VISUAL_OVERRIDE is invented.

Actual results: canonical rule/source inspection and edits only. Regression execution, typecheck, lint, build, all other tests, disposable DB, hosted CI, authenticated UAT and visual parity: **NOT_TESTED**, as the caller explicitly forbids self-QA. Previous independent FAIL remains historical evidence; this repair does not clear it. No commit, push, Git metadata changes, automation, secrets, live account/DB/service or deployment actions. No product DONE/ACCEPTED/PROD claim.

Independent regression entry point remains `P1_ORIGIN=http://127.0.0.1:18984 node apps/web/test/game-cover-create.browser.mjs`, using an independently prepared loopback server/build and existing Playwright installation. The author did not run it or start services. Hosted authenticated UAT and all same-SHA gates remain separate requirements.

Rollback: undo only this repair's form-lifetime changes, browser scenario additions and this handoff section. No schema/runtime rollback needed for this bounded repair. Next bounded action: trusted publisher records the new exact candidate SHA and GitHub permalinks, then independent QA executes the regression and required source checks against that SHA. Publication is prohibited to this author; this addition is local pending authorized publication, with no invented candidate permalink or accepted-base provenance.

## Bounded native correction after auto3 and hosted CI defects

From: source author. To: parent publisher → NEW independent exact-SHA SOURCE QA / full hosted Product CI → normal existing DEV unit.
Date: 2026-10-16. Status: UNVERIFIED; source correction only, no product acceptance.
Correction base: `6c82c2700250ccc0c20ff7b0cc9de2eb3da863f1`, clean existing `automation/issue-47` worktree at entry.
Exact base: https://github.com/anpavel84-afk/gobadminton-clean/tree/6c82c2700250ccc0c20ff7b0cc9de2eb3da863f1

**Actual PM scope correction**, supplied by caller, durable reference:
https://github.com/anpavel84-afk/gobadminton-clean/issues/47#issuecomment-6205963893
The two photo upload/edit locations concern GAME images (own-game image versus venue fallback). They do not retire previously Owner-approved/ACCEPTED personal profile header #36. Earlier statements in this handoff about “two targets only” and “retired third write target” are superseded in that scope; retained as history, not current implementation authority. This is an actual scope fix, not a new Owner assumption. No privacy default or real account changed.

Restored from `bc6d98230a890998bff846956bf6fdd4a35dbde7`:
- Entire profile `cover.controller.ts`, `ProfilePage.tsx` and `integration/cover-upload.test.ts` match baseline byte-for-byte. Real PUT/DELETE HTTP tests replace the invented internal service/fake response helper. Existing DELETE body validation remains 400 for malformed commands; no server/404 workaround. Cookie/CSRF/session/CAS/replay/rate/moderation/read privacy and consumer selection/crop/delete remain the baseline implementation.
- `/me/cover` OpenAPI path and existing profile cover schemas match baseline. Original profile contract/CAS/controller unit suite is retained in full, with additive game contract/controller tests alongside it. Game/venue write endpoints, game authorization distinctions, private media, projection and fallback code are retained.
- Removed TS18048 source by restoring original real HTTP tests, rather than widening types or asserting away an undefined cookie.

Other actual defects corrected:
- `game-cover.test.tsx` tests effective cover in GameHero/Discovery/My Games. Organizer identity/avatar assertions run in real Discovery, detail GameTerms and personal-card identity slots, with a separate approved avatar URL and explicit rejection of game/venue cover URLs in those slots. No new identity UI was added to Hero.
- Create publication keeps the legitimate `if (busy) return` guard, photo readiness and synchronous mutation-ref concurrency fence; adds a preview-step fence. No replay or retry is introduced. Existing WEB-01 guard assertion stays intact.
- Real-page synthetic browser runner retains cancel-during-decode, selection→preview→back crop/confirmation, roundtrip removal, upload rejection, no-image and lost upload receipt cases. Adds two publication clicks in the same JavaScript task, lost create receipt and committed-but-lost publish receipt. Assertions require exactly one create/upload/publish sequence, read-only recovery and no creation replay or unsafe retry. These are executable scenarios, not browser execution evidence.

STYLE_GUIDE_PARITY: restores accepted #36 UI exactly; no new presentation, CSS, tokens, identity UI or second game picker. Canonical Owner decision read; local `.tools/style-reference/README.md`, manifest and guide text inspected as rendered reference inputs only. The operational guide file named by AGENTS is absent. Frozen PLAN parity remains UNVERIFIED and original bounded game-photo STYLE_GUIDE_GAP remains; no network/PLAN access or invented visual override.

Actual offline results:
- Baseline byte comparison of the three restored files, profile OpenAPI path/schemas and retained original unit suite: passed. Game/venue/media paths retained. The first structural script used `{venueId}` instead of the actual existing `{id}` venue parameter and failed that assertion; corrected script passed without changing the contract.
- `node --check apps/web/test/game-cover-create.browser.mjs`: passed (syntax only).
- Existing contract scripts `generate-game-types.mjs`, `generate-unified-types.mjs`, `generate-friendship-types.mjs`: verified without writes. `check-admin-protocol.mjs`: passed.
- `git diff --check`: passed.
- Full `check-openapi.mjs`: could not execute, `ERR_MODULE_NOT_FOUND` for `@apidevtools/swagger-parser`. No node_modules/Vitest/TypeScript/Playwright installation is available in this worktree; no dependencies downloaded or Corepack network used.
- Vitest, API/Web typecheck/lint/build, browser execution, disposable PostGIS, full hosted CI, independent SOURCE QA, authenticated mobile/desktop UAT and DEV acceptance: **NOT_TESTED** here. No author check is independent QA. Caller reports hosted ProductCI 38834328919/38834332419 failure on `f89c69ba2075644bf0521388d8955fd89749cea2`; that history is not cleared by this correction.

All edits remain in the original allowed paths. No second writer, commit/push/Git metadata write, assignment/controlfile/CI change, secrets/liveDB/env/accounts/services/network/downloads/root/PROD/PLAN/VPN action. No new unit or attempt counter reset. Rollback before publication: reverse only this correction's diff against the exact correction base, retaining prior history and game-cover implementation. No runtime/schema rollback executed.

One next bounded action: parent commits on the normal branch, records candidate exact SHA/permalinks, resumes the SAME existing unit for NEW independent exact-SHA SOURCE QA and full hosted Product CI including disposable PostGIS; then normal authorized DEV backup/immutable images/smoke/receiver/root-owned ACCEPTED same SHA/digests/pending=false and real authenticated synthetic UAT. This local correction is not DONE/ACCEPTED/PROD and has no new GitHub permalink until parent publication.
