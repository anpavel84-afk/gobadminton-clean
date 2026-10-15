# Issue #36 — Wave B2 owned profile cover

From: source author. To: PM publisher → independent SOURCE QA → authorized DEV release operator.
Date: 2026-10-15. Status: READY_FOR_REVIEW / UNVERIFIED. No SOURCE PASS, visual approval, CI PASS or product acceptance is asserted.

## Assignment and base

Bounded assignment: issue #36, Wave B2 after organizer avatars #15; Owner authorization reference: https://github.com/anpavel84-afk/gobadminton-clean/issues/5#issuecomment-6182091853 (reference supplied by assignment, not fetched by author).

Exact supplied checkout base: `9b2a4608dbaae65f1161764808739d80579055ba`, branch `automation/issue-36`, initially clean. The author did not claim or independently verify the live DEV revision or remote branch freshness. The orchestrator must associate its claim/base record with this candidate before publication.

Canonical repository: `anpavel84-afk/gobadminton-clean`. Base permalink: https://github.com/anpavel84-afk/gobadminton-clean/tree/9b2a4608dbaae65f1161764808739d80579055ba . Source-only edits are uncommitted by explicit instruction. Publisher must add the final candidate SHA and exact blob permalinks to the Issue/PR; this document is not evidence of GitHub publication.

Allowed writes: `apps/api/**`, `apps/web/src/**`, `apps/web/test/**`, `apps/web/public/**`, `packages/contracts/**`, `docs/handoffs/**`. No commits, pushes, Git metadata, automation, secrets, services, real accounts, deployment or PROD actions. No author self-QA. Prior independent QA supplied: `{}`. Attempt 1 was the initial source submission. Attempt 2 is this PM-authorized bounded continuation on the SAME dirty worktree; all prior implementation was preserved. This is author verification, not independent QA.

## Source result (authored, not execution evidence)

- `apps/api/src/profiles/avatar.service.ts`: cover is a server-owned slot in the existing media service, directory and durable deletion journal. Shared profile CAS, actor/session transaction fence, original-request idempotency, moderation budget, prepublication byte binding, concurrent processing limit and cleanup apply. Existing avatar request hash and operation scope remain unchanged. Cover writes have a separate replay scope; upload requires `profile.public` when existing restriction enforcement is enabled. Delete remains available for privacy-off.
- `cover.controller.ts`, `cover-presentation.ts`, `profiles.module.ts`, `avatar-http.ts`: authenticated GET/PUT/DELETE `/v1/me/cover`; key-only `/v1/media/covers/:key`. Profile responses add optional `cover.uploadedUrl`; public detail adds it only after existing directory/viewer authorization. No list/gallery or independent management system.
- Media reads require a current key, active account, allowed cover-image approval and existing enabled capability restrictions. Owner may read a hidden cover. Other viewers require the existing directory feature, opt-in visibility, eligibility and no bilateral block. Missing, replaced, deleted or disallowed objects return unavailable. Responses use `no-store`, `Vary: Cookie`, `nosniff` and sandbox CSP; only re-encoded PNG bytes leave storage.
- `avatar-image.ts`: existing 5 MiB/16 MP/8192px/single-frame server boundary, MIME/signature/decode verification, timeout, metadata stripping and 2 MiB derivative limit; cover output is 1200×400. Cover-specific envelope checks reject trailing JPEG/PNG/WebP containers; APNG/animated images are rejected. No SVG/HTML/URL/filename/path input is accepted. Valid metadata in a raster source is discarded on re-encoding.
- `moderation/moderation.service.ts`: same existing image policy/categories/provider/budget. Cover approval surface and HMAC fingerprint domain are `cover_image`; avatar domains remain compatible. No moderation bypass/flag enabled. The historical policy identifier remains `avatar-image-v1` deliberately: this reuses the approved image policy rather than introducing a new product moderation policy.
- `apps/web/src/lib/avatar-preprocess.ts`: reuse existing bounded local JPEG/PNG/WebP inspection, orientation handling, timeout and encoding limits. Cover crops in oriented coordinates with keyboard-adjustable x/y sliders; transmitted derivative is 1200×400, at most 512 KiB. Source stays on device, at existing 10 MiB/50 MP bounds. The oriented intermediate canvas is bounded to 2048px. Blob URLs, bitmaps and canvases are released.
- `CoverEditor.tsx`, profile pages and `players.css`: explicit select → crop → desktop/mobile preview → confirm, replace, delete and branded default; allowlisted server image URL with load-error fallback. Existing Button, native ProfileDialog, form, notice and token primitives. Progress is indeterminate stage text. Ambiguous save/CAS conflict requires authoritative reread and full profile reload before retry; session rejection reloads auth state. The 3:1 derivative is displayed with centered object-fit cropping inside the existing desktop media panel and mobile header. Both preview framings disclose cropping. No change to visibility controls or consent defaults.
- `packages/contracts/openapi.json` and exported `profile-cover.ts`: additive routes and schemas, shared version/CSRF/idempotency/authorization semantics and limits.

## Migration and rollback

New ordered migration: `apps/api/migrations/0033_owned_cover.sql`. Earlier SQL is untouched. Nullable cover columns, approval FK and all-or-none binding constraint are additive; the approval surface allowlist is extended. Existing rows/avatars/versions are preserved. Replacement/profile deletion journal prior cover keys into existing `avatar_media_gc`; account retirement clears both cover fields and increments the existing shared version. GC checks avatar OR cover references before unlinking.

Uses the existing sorted transactional migration runner and `schema_migrations` ledger. That runner has no checksum column; no checksum system, old SQL rewrite, workflow change or PROD access was introduced.

Preferred source rollback: return the paired API/Web source/images to the prior authorized version and retain additive schema, approvals and journal. Cover endpoints/UI then disappear; existing avatar functionality remains. Any disk cleanup must preserve still-referenced keys and be performed by an authorized operator using the cover-aware collector. Never manually unlink private storage based on a client URL.

Optional rollback SQL: `apps/api/migrations/rollback/0033_owned_cover.sql`, caller-owned transaction after writers are stopped. It refuses populated cover references OR cover approvals, rather than erasing history. Only unused installation rollback is supported; a populated installation retains additive schema. No rollback or migration was executed by this author.

## STYLE_GUIDE_PARITY

Authority: [Owner Style Guide first decision at supplied base](https://github.com/anpavel84-afk/gobadminton-clean/blob/9b2a4608dbaae65f1161764808739d80579055ba/docs/decisions/OWNER_DECISION_FRONTEND_STYLE_GUIDE_FIRST_V001.md).
Canonical external sources: https://nougat-wise-76949869.figma.site/#guide and https://nougat-wise-76949869.figma.site/#construction-kit . No frozen source hash was verified by this author.

The linked `docs/operations/FRONTEND_STYLE_GUIDE_FIRST_V001.md` is absent in this checkout. Frozen PLAN source was not accessed, and no new network reference was fetched; the supplied primary rendered canonical data were independently inspected in attempt 2. Existing implementation is not asserted to be visual authority. The existing source handoff `ISSUE_15_CANONICAL_REFERENCE.md` concerns identity/card primitives, not evidence for this exact header.

Reused families named by Owner decision: media/image blocks, Hero/header, Buttons, Forms/validation, Modal, Empty/Error/Notices, responsive and accessibility recipes; current own/public profile identity composition is retained, with uploaded media inside the existing header panel. Rendered application parity remains UNVERIFIED.

Primary Owner-rendered canonical data are locally available at **`.tools/style-reference`** for the next reader. Independently inspected actual `profile-desktop.png`, `profile-mobile.png` and `guide.png` during attempt 2; supporting `README.md`, `manifest.json`, `profile.dom.html`, `guide.dom.html`, text exports and construction-kit material remain at that path. These are public rendered reference observations supplied for this assignment, not a frozen PLAN tree. Upstream published source: https://nougat-wise-76949869.figma.site/#profile and #guide; manifest records capture provenance. Parent must retain/access these inputs for independent review; this local path alone is not a GitHub publication claim.

Observed profile composition: desktop lime media/avatar panel on the LEFT, white identity/name/actions on the RIGHT; mobile media/avatar ABOVE identity. Default circles and avatar are retained. Attempt 2 removes the attempt-1 full-width banner addition and places the cover behind the avatar inside that existing panel; profile typography, grid and identity layout stay intact. Source previews show the desktop panel framing and mobile framing. Exact rendered browser equivalence is NOT_TESTED.

`STYLE_GUIDE_GAP #36-cover-crop-preview`: no actual crop/upload dialog is verified by the supplied reference. Supplied edit-control observation reports no dialog, URL or body change. A canonical crop surface is therefore UNVERIFIED, not claimed absent everywhere. Proposed bounded extension uses existing profile modal, Button, form/range controls, notices and image previews. Existing avatar preprocessing is reused, but its auto-upload UX is not asserted as canonical crop confirmation. Independent visual QA must review panel crops, preview fidelity, focus/keyboard behavior and this extension. No `OWNER_VISUAL_OVERRIDE` is asserted; no PLAN access or frozen-hash parity is claimed.

## Tests authored; runtime suites NOT_TESTED

- `apps/api/test/unit/cover-image.test.ts`: formats, metadata, dimensions, animation, MIME, size, active content and trailing container rejection.
- `apps/api/test/unit/cover-contract.test.ts`: cookie/CSRF/CAS/replay/binary route contract.
- `apps/api/test/integration/cover-upload.test.ts`: real Nest injection, synthetic sessions and fake moderation on explicitly disposable loopback PostGIS; auth/CSRF/Origin, private/public/blocked reads, safe bytes, replay, replacement, delete/default, races, other actor, moderation rejection/budget, revocation during provider preflight and account retirement.
- `apps/api/test/integration/cover-migration.test.ts`: isolated temporary database with earlier migrations, additive upgrade, prior avatar/version preservation, unused rollback/reapply, populated rollback refusal, account retirement journal and PostGIS presence.
- `apps/web/test/cover.test.tsx`, `cover-preprocess.test.ts`: URL/default, locked control, upload/delete wire requests, bounded deadlines, eight orientations, crop coordinates, metadata and local source limit.
- `apps/web/test/profile-cover.browser.mjs`: opt-in synthetic loopback Playwright regression, 390/1440 widths, real local canvas source, no upload before confirmation, range keyboard interaction, replace/delete/default, broken image, ambiguous save reconciliation, Escape and overflow. It expects an already-built Web server and the same locally provisioned Playwright location as the existing browser scripts. It does not start services. Mock API is explicitly NOT live authentication/security evidence.

Initial submission ran no checks. Attempt 2 ran the limited author checks recorded below; no independent QA or product acceptance is claimed. Existing avatar/moderation/profile regressions must run too, because shared code changed. Added tests are reviewable source, not passed evidence.

## Next bounded action / remaining gates

PM publishes this source candidate under the existing Issue and records exact SHA/permalinks. Independent SOURCE QA must assess that SHA, including canonical visual evidence and all relevant API/contracts/Web/disposable PostGIS checks. Any defects remain within assignment's maximum three attempts; do not waive a failing gate.

Hosted full Product CI at the same SHA, authorized DEV backup/paired image release, smoke/receiver/root-owned ACCEPTED exact SHA/digests/pending=false and real authenticated synthetic mobile/desktop profile upload/replace/delete/forbidden-other-actor smoke are all NOT_TESTED. Live proxy/body-budget and private storage behavior also require DEV validation. No PROD work is authorized. SOURCE review alone cannot establish product acceptance.

## Attempt 2 — Foundation chronology and bounded repair

FACT supplied by trusted parent: attempt 1 native author exited successfully, but Foundation rejected source BEFORE candidate commit with these exact findings:

- `DELETE /me/cover: expected explicit required command body`
- `GET /me/cover: missing/duplicate operationId`
- `GET /media/covers/{key}: missing/duplicate operationId`

This was static-gate evidence, not an independent QA verdict. No prior FAIL is superseded into a claimed source acceptance.

Repair: unique `getMyCover` / `getProfileCoverMedia` operationIds. New unreleased DELETE requires `application/json` `DeleteCoverCommand` with exactly `expectedVersion`, integer 0..2147483647, agreeing with required `X-Profile-Version`. Controller validates after cookie mutation authentication and before media mutation; the validated body version drives existing CAS and idempotency hash. Missing/malformed/fractional/string/negative/overflow/extra-field/mismatched commands fail rather than silently deleting. Established avatar DELETE remains bodyless and unchanged. API client sends the JSON command; exported type, contract assertions, controller unit test, disposable DB rejection/no-state-change/replay/stale-version tests and Web wire/browser fixture assertions align.

Actual author checks (not independent QA):

- `python3 scripts/check_foundation.py`: PASS, 156 Markdown files / 159 draft API operations; static bounded contract only.
- `git diff --check`: PASS.
- `node --check apps/web/test/profile-cover.browser.mjs`: PASS syntax only.
- `pnpm run check:foundation` / `pnpm run check:contracts`: could not start; Corepack download of pnpm 10.18.0 failed DNS `EAI_AGAIN registry.npmjs.org`. Foundation subsequently ran directly as above.
- `node packages/contracts/scripts/check-openapi.mjs`: could not validate; missing `@apidevtools/swagger-parser` (`ERR_MODULE_NOT_FOUND`). No dependencies were installed.
- Typecheck/lint/unit/integration/disposable PostGIS/browser/build: NOT_TESTED, dependencies unavailable. No services, root, Docker, live DB, secrets, flags, automation or prior SQL/checksums accessed/changed. No commit/push performed.

Next bounded recipient: trusted parent verifies scope and Foundation, publishes a normal candidate commit and obtains NEW read-only independent SOURCE QA of that exact SHA before hosted CI/DEV. Final candidate SHA/permalinks remain pending parent publication. All hosted/live/UAT/receiver acceptance gates above remain NOT_TESTED.
