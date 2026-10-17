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
