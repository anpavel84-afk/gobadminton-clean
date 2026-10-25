# Issue 64 — Admin venue management source handoff

From: source author. To: commissioned independent QA / PM. Date: 2026-10-17.
Status: WORKING_DRAFT / UNVERIFIED. No implementation acceptance or live readiness claim.
Base: `3c1f7c84da17e3af506a605cc9c353960e1d23af`, branch `automation/issue-64`.
Base permalink: https://github.com/anpavel84-afk/gobadminton-clean/tree/3c1f7c84da17e3af506a605cc9c353960e1d23af

## Assignment and effect ceiling

Owner-direct 2026-10-16 19:36 America/Sao_Paulo, provided as immutable GOBADMINTON_AUTONOMY_V1 source-only task, target DEV, max_attempts 3. Implement usable existing Admin venue metadata/photo management; superadmin may manage eligible imported/nonowned catalog venue photos without changing creators. Other roles retain ownership restrictions. Exact selected venue only, existing Admin session/passkey, RBAC, sanitized moderated media, audit, CAS and replay. No new role, auth/media architecture, dependency, runtime config, migration or deployment.

Allowed writes: apps/admin/src/**, apps/admin/test/**, apps/api/src/admin/**, apps/api/src/venues/**, apps/api/test/**, docs/handoffs/**. Explicit user instruction prohibits commits, pushes, git metadata changes, automation, services, secrets, PROD, private operator directories, real DB access and self-QA. No external publication performed; PM must publish this source artifact and replace the base-only link with the exact candidate permalink. Current DEV freshness / prior 61 and 62 deployment / global writer coordination were not independently established by this source author. This assignment did not authorize accessing operator state.

## Previous defects and source changes

FACT from source: venue detail/edit followed the entire list and opened through an obscure action; no Admin photo editor existed; Admin BFF exported only GET/POST and excluded cover subroutes; cover scope required creator ownership for every role.

Source changes:
- Existing Venues editor appears before list, scrolls into view when opened, offers explicit Open/Edit labels, actual selected state, city display, timezone, room discriminator and coordinates. Existing fields remain real API fields, city remains immutable on ordinary edits. Cancel, bounded validation and human-facing audit reason options added. Filter explicitly identified as a list filter; current page cursor retained after writes. Merge, duplicate review, archived/merged API policies and explicit state commands remain.
- Admin detail DTO resolves existing cities.name_ru without altering city ownership or records.
- Exact-venue photo editor reads current receipt, prepares local JPEG/PNG/WebP with a local copy of the existing bounded avatar-preprocess helper, centered 1200x400 cover preview, and calls existing PUT/DELETE API. No URL uploads or consumer sessions. Preparation is aborted on unmount. Controls report work/errors, confirm removal, explain fallback and retain identical operation/key/body/version after unknown transport outcome. Other venue actions are locked while photo work is active or unresolved. Successful changes reload selected detail and retain page/filter.
- Real existing passkey step_up flow is exposed in Venues and photo error feedback. Successful proof never automatically retries a mutation: operator must explicitly click the action again. Server checks are unchanged.
- BFF adds only exact UUID /cover GET/PUT/DELETE and /cover/access GET; binary byte transport has 5 MiB upload / 64 KiB JSON caps, bounded reading and upstream timeout. Cover query strings are rejected. PUT MIME whitelist, CAS/CSRF/replay headers, Admin-only cookie filtering, no bearer forwarding, origin/host/path guards and upstream status/body semantics retained. PUT and DELETE now require explicit matching Origin just like POST.
- VenueCoverService changes only creator scope predicate: eligible unverified/verified venues allow current superadmin OR existing creator ownership. Current active user, principal/session authorization, moderation, replay reauthorization, CAS and immutable audit pipeline remain. No creator update.

## Evidence and limits

No tests, build, lint, HTTP servers, browser, screenshots, DB fixture, CI or deployment were executed by this author, per explicit no-self-QA instruction. No PASS. No screenshots fabricated. Prior independent QA input was `{}`; no historical FAIL is superseded.

Authored, NOT RUN:
- apps/admin/test/venue-cover-http.test.ts: actual loopback HTTP upstream for BFF binary byte preservation, DELETE JSON, headers/cookie fences, status semantics, route/method/origin/type/query and payload caps. Synthetic transport only, not hosted standalone evidence.
- apps/api/test/integration/venue-cover.test.ts: additional disposable synthetic superadmin imported/nonowned venue coverage, creator immutability, existing foreign-manager denial, retired denial, and named two-venue cover isolation/reload persistence. Existing ownership/ordinary-user/CSRF/stepup/moderation/CAS/replay suites remain required.

Independent QA must compile/run source and tests, add any missing executable/browser cases, inspect exact candidate SHA and report findings without treating these authored tests as results. Required hosted seven-job ProductCI (including Admin build/standalone HTTP and receiver), commissioned three-image DEV release with backup/rollback and fresh root ACCEPTED/live SHA/noPending/exact digests are pending outside source-author authority. Required actual viewport 390/430/768/1024/1440 before/after screenshots and interaction checks are pending. Full revoked/expired/merged/notfound/CAS/replay/moderation-failure preservation and game-own-photo/public fallback regressions must be independently established.

Real authenticated DEV UAT blocker: this author has no legitimate test Admin session, no access to Owner session, and must not fabricate one. Synthetic API fixtures in test source are not real authenticated DEV UAT. Owner's reported login is preserved as a report, not reused as evidence by this author.

## STYLE_GUIDE_PARITY

Read Owner Style Guide first decision. Reused existing canonical Admin tokens (Onest, lime/purple, radii) and named canonical families: SurfacePanel/ContentCard, ListRow, FormGroup/input/select/validation, Button, Notices, image block. No broad redesign or consumer screen composition change. Source recipe is selected card before list, using existing primitives. No OWNER_VISUAL_OVERRIDE. Frozen external Make screen was not accessed here; exact visual parity remains UNVERIFIED. The referenced docs/operations/FRONTEND_STYLE_GUIDE_FIRST_V001.md is absent in this extraction. No new visual family proposed; independent visual review must verify parity against authorized frozen guide.

## Continuity / next bounded action

No commit or candidate permalink exists from this source-only author. Publication is pending, not represented as durable GitHub completion. Do not confuse source implementation, independent QA, CI, deployment, live UAT or Owner acceptance. No PROD action. Rollback before publication: revert this task's source diff only; after publication PM uses the exact reviewed candidate's normal rollback process. Do not discard unrelated edits.

Next bounded action: independent read-only QA of the exact published source SHA against immutable task acceptance, followed by PM's existing CI/release route if authorized. Preserve historical FAIL and max-three-attempt limit; no second writer or automatic next assignment. Remaining visual, browser, authenticated-UAT and release evidence must be recorded with exact permalinks by their authorized producer.


## Independent QA FAIL repair — 2026-10-17

From: source author. To: commissioned independent read-only QA / PM.
Status: WORKING_DRAFT / UNVERIFIED; source repair only.
Exact repair base / reviewed SHA: `34458f6d6a0edd4461fcde6822f1a18bae274a47`.
Base permalink: https://github.com/anpavel84-afk/gobadminton-clean/tree/34458f6d6a0edd4461fcde6822f1a18bae274a47
Branch: `automation/issue-64`; initial working tree clean. Immutable assignment and effect ceiling above remain in force. This repair addresses only the two supplied independent QA findings, not another assignment. Max-three-attempt limit remains; no new writer started.

Historical independent verdict: **FAIL**, reviewed SHA above. Findings preserved:
1. Initial cover GET failure leaves receipt null and photo controls disabled, with no read retry. Confirmation only performs step-up; reopening unchanged venue does not remount the same key. Transient failure therefore blocks management until venue switch or reload.
2. Missing executable moderation-service failure test during replacement of an already published cover. Initial rejection and hiding an approval do not establish preservation during failed replacement.

Source edits (not verified by execution):
- `apps/admin/src/components/VenuePhoto.tsx`: one GET per mount or explicit retry, bounded by a 20-second timeout and aborted on unmount. Failed initial reads expose “Повторить загрузку фото” without requiring venue switch/reload. Read loading ends on failure and shows a distinct failed state. Confirmation awaits the existing step-up workflow and schedules a fresh bounded GET; server authorization remains authoritative, including if confirmation is cancelled or fails. No mutation auto-retry. Read/preparation/confirmation disables conflicting controls; unresolved mutation receipts continue to fence new work and keep their original replay key/body/version.
- `apps/admin/src/lib/admin-client.ts`: actual `MODERATION_TEMPORARILY_UNAVAILABLE` code maps to the existing honest retryable previous-photo-preserved notice.
- `apps/api/test/integration/venue-cover.test.ts`: authored disposable test publishes a real sanitized synthetic cover, submits distinct replacement bytes with unavailable moderation, asserts provider consultation and 503 code, unchanged version/cover key/approval/actor, unchanged Admin receipt and public venue projection, identical publicly served old bytes, and no extra cover audit action. Provider fixture restored in finally. Existing initial rejection, ownership negatives, CAS and game fallback tests retained.

STYLE_GUIDE_PARITY: added retry action and loading/error text use the canonical Button and Error/Notices families documented in the Owner Style Guide first decision; existing panel/form/image composition retained. No new visual family, STYLE_GUIDE_GAP or OWNER_VISUAL_OVERRIDE. Referenced operations guide remains absent; external frozen Make parity remains UNVERIFIED.

No tests, lint, build, browser, screenshots, DB execution, self-QA, CI, deployment, service, secret or git metadata mutation performed. Authored assertions are not results. Historical FAIL remains unresolved pending NEW independent exact-candidate-SHA read-only QA. No candidate SHA/permalink exists from this uncommitted source author. Publication is pending with the authorized executor; do not represent this local handoff as published GitHub evidence.

Readiness remains separate: full hosted seven-job ProductCI including Admin build/standalone HTTP and receiver; same commissioned three-image DEV pipeline with backup/rollback, fresh root ACCEPTED/liveSHA/noPending/exact digests; before/after browser evidence at 390/430/768/1024/1440; and real authenticated DEV UAT are not established here. No legitimate test Admin session is available to this author; Owner's session is neither assumed nor accessed. Synthetic disposable tests cannot establish real DEV UAT PASS.

Rollback: remove only this repair's edits in the four files named above, preserving earlier implementation and unrelated work. No runtime rollback is needed because no runtime effect was performed. Next bounded action: authorized executor publishes exact candidate, then independent read-only QA evaluates both historical findings and the immutable acceptance before any authorized existing CI/release route. Preserve historical FAIL and the max-three-attempt ceiling.

## Independent QA FAIL repair, final bounded source attempt — 2026-10-17

From: source author. To: commissioned independent exact-SHA read-only QA / PM.
Status: WORKING_DRAFT / UNVERIFIED. Base/reviewed SHA:
`632befd79846a588fd5fa9e219f5015330541fce`, branch `automation/issue-64`, initially clean.
Exact base: https://github.com/anpavel84-afk/gobadminton-clean/tree/632befd79846a588fd5fa9e219f5015330541fce
Same immutable source-only assignment; no new assignment or writer. Preserve max_attempts=3;
this is the third source iteration represented in this handoff, not permission for another iteration.

Historical independent verdict **FAIL** at that SHA remains recorded:
1. AdminApp inline onAuthorityLoss changes fail/effect identity on parent renders; the
   15-second refresh reloads page one and clears the paginated cursor.
2. Named API two-venue GET/upload test is not executable browser selection, metadata/photo
   action isolation or browser reload persistence coverage.

Source changes authored:
- `apps/admin/src/components/AdminApp.tsx` passes existing useCallback-stable `clear`
  directly to Venues. Authority clearing behavior is identical; normal parent session
  refresh no longer changes Venues.fail and retriggers its initial list effect. The
  existing status-dependent load continues to reset pagination on deliberate filter changes.
- `apps/admin/test/venue-selection.browser.mjs` is an executable Node test using
  QA-provisioned Playwright/Chromium against an independently started disposable loopback
  Admin server. It exercises the actual AdminApp browser UI and real client image
  preprocessing, with synthetic API interception strictly inside its browser context.
  Separate fixtures per 390/430/768/1024/1440 viewport cover opening two venues from a
  paginated list, edit validation/cancel/save, actual 15-second parent refresh preserving
  page and selected detail, photo selection/preview/upload on the other venue, switching
  back, browser reload and reopening persisted synthetic metadata/photo, removal/fallback,
  exact mutation target assertions and document overflow assertions. Optional before/after
  screenshots are emitted only when QA provides ADMIN_BROWSER_EVIDENCE_DIR.
  The intercepted in-memory store outlives browser reload; it does not establish backend
  persistence. Disposable DB/API tests remain separate evidence. No fake session is sent
  to any real backend; a synthetic auth/me response exists only within this test context.

Independent invocation (NOT RUN by author): provision Playwright and Chromium outside
repository dependencies; build/start existing Admin separately on loopback, then
`node --test apps/admin/test/venue-selection.browser.mjs`.
Optional ADMIN_BROWSER_URL selects that loopback server (default localhost:3010).
PLAYWRIGHT_MODULE may specify the absolute module entry of the QA-provisioned Playwright;
no package manifest, lockfile, CI automation or dependency was changed. This standalone
browser suite is intentionally separate from Node-environment Vitest discovery and must
be explicitly run by independent QA. Missing browser tooling is an execution prerequisite,
not a passing result. Tests and screenshots have NOT been executed/generated here.

No self-QA, tests, lint, build, browser launch, servers, network, DB, deployment, git
metadata changes, commits or pushes performed. The initial edit command used unavailable
`python`; the source edit was subsequently applied using `python3`. No test result inferred.
No new candidate SHA/permalink exists until the authorized executor publishes these edits.
Publication remains pending under the user's explicit no-commit/no-push ceiling.

STYLE_GUIDE_PARITY: no visual/composition change, new family, gap or override in this
repair. Existing canonical Admin panel/form/button/notice/image patterns remain.

Readiness remains UNVERIFIED: NEW independent exact-SHA QA, hosted seven-job ProductCI
including Admin build/standalone HTTP and receiver, commissioned three-image DEV pipeline
with backup/rollback and fresh root ACCEPTED/liveSHA/noPending/exact digests, actual
before/after viewport evidence and authenticated DEV UAT remain pending. No legitimate
test Admin session was supplied; Owner login/session is not accessible or assumed.
Synthetic browser/API evidence cannot become real authenticated DEV UAT PASS.

Rollback: remove only this repair's callback replacement, new browser test and this
handoff section. No runtime effect needs rollback. Next bounded action: authorized
executor publishes candidate; commissioned independent read-only QA runs the browser
suite and full required checks against the exact candidate, preserving all historical FAILs.
