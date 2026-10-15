# Issue #15 — creator avatar source handoff

From: source author. To: independent SOURCE QA / authorized PM. Date: 2026-10-15.
Status: WORKING_DRAFT / UNVERIFIED; source only, no acceptance or deployment claim.

## Attempt 5 — bounded CI block-fixture repair (2026-10-15)

From: source author. To: authorized Bridge publisher / independent QA5.
Status: READY_FOR_REVIEW source delta; execution UNVERIFIED. This section supersedes
earlier current-status paragraphs while preserving their historical evidence.
Exact base: `4b9f46f1d923da772bf12719e7e4e368e13dc296`, branch
`automation/issue-15`, clean at entry:
https://github.com/anpavel84-afk/gobadminton-clean/tree/4b9f46f1d923da772bf12719e7e4e368e13dc296
Authorization: supplied immutable #15 source assignment plus bounded attempt 5:
https://github.com/anpavel84-afk/gobadminton-clean/pull/40#issuecomment-6190153107

Preserved supplied evidence (not newly verified): independent QA4 PASS, no findings,
on that exact base. PM reports Product CI run 38720970649: 6/7 jobs passed;
database job 116375138357 failed at managed-games fixture inserting a block without
required `pair_id`. This diagnostic is not a replacement QA verdict or UAT.

Only `apps/api/test/integration/me.managed-games.test.ts` and this handoff change.
Read current migrations (0008 pair/block constraints, 0022 deferred revision trigger,
0032 friendship generation and immutable attempt guards), production PairFenceService,
SafetyService/controllers and existing LS01 HTTP block/unblock examples.
The fixture now imports SafetyModule and uses authenticated, CSRF/idempotency-protected
PUT and DELETE `/v1/me/blocks/:publicPlayerId`, with JSON bodies and distinct keys.
Social directory is enabled only in the constructed synthetic application's env object;
no process-wide or runtime privacy flag changes. Production pair creation/locking,
block FK identity, friendship terminal-state/version handling and commit-time revision
triggers are reused. This fixture creates no friendship generation/attempt and never
deletes or rewrites the append-only ledger or pair row. Unblock runs in a nested
`finally`; outer cleanup still clears the synthetic avatar even if unblock fails.
Receipt/status assertions guard setup and cleanup; an added HTTP read checks the
replacement avatar returns after unblock. All previous creator/manager, block, hide,
replacement/removal and discovery assertions remain.

STYLE_GUIDE_PARITY: accepted visual source and canonical mapping in
[ISSUE_15_CANONICAL_REFERENCE.md](ISSUE_15_CANONICAL_REFERENCE.md) are untouched;
no frontend or composition changes in this repair.

Actually attempted: `pnpm --filter @gobadminton/api exec vitest run --project integration
test/integration/me.managed-games.test.ts`. It failed before Vitest startup:
Corepack could not download pnpm 10.18.0, DNS `EAI_AGAIN registry.npmjs.org`.
No dependencies were installed; no DB was contacted or test executed. The attempted
command did not set RUN_DB_INTEGRATION; the independent disposable-DB run must set
`RUN_DB_INTEGRATION=1` and use its authorized disposable DATABASE_URL.
`git diff --check` completed with exit 0 before this documentation addition.
NOT_TESTED: compilation, lint, integration execution, independent QA5, new hosted CI,
browser/UAT, actual DEV SHA/paired digests/backup/root-owned acceptance. No self-QA
verdict, current test PASS, deployment or acceptance claimed.

Next single bounded action: Bridge reviews and publishes these two files as a new
candidate SHA, then routes independent read-only QA5 on that exact SHA. Full hosted
Product CI and authorized DEV paired images/backup/browser/root-owned ACCEPTED receipt
(exact SHA/digests, pending=false), plus synthetic mobile/desktop product browser smoke,
remain separate mandatory gates. Any failure requires bounded repair or BLOCKED/rollback.
No commit/push, git metadata writes, GitHub writes, service/root/PROD effects performed.
No new SHA/permalink exists in this author session. Rollback: discard/revert only this
two-file delta; no migration or runtime rollback is introduced.

## Current bounded repair — base f4774a6 — 2026-10-15

From: source author. To: authorized PM / canonical reference provider, then independent SOURCE QA.
Status: BLOCKED; supplied independent SOURCE QA FAIL on
`f4774a6097a81be0dd72cce6140391fbc7e41b6d` remains unresolved.
Exact entry base: https://github.com/anpavel84-afk/gobadminton-clean/tree/f4774a6097a81be0dd72cce6140391fbc7e41b6d
Branch: `automation/issue-15`; entry worktree clean. This section supersedes earlier
repair status for the current attempt, without replacing its historical evidence.

Scope: only the supplied immutable #15 source-only assignment and its reported
Style Guide first defect. Expected/actual edit: this handoff only. No new slice,
application changes, test deletion, commit, push or git metadata writes authorized.
Rollback: remove only this section; no runtime rollback needed.

Canonical recovery actually executed: read AGENTS.md, canonical rules/decisions,
project context and existing handoff; inspect GameDetailComposition source and
repository reference locations. Reading the documented exact
`/opt/gobadminton-clean-qa/style-guide/manifest.json` returned `No such file or directory`.
The linked frontend operations guide is absent as well. Read-only HTTP HEAD to
`https://nougat-wise-76949869.figma.site/` failed with curl exit 6,
`Could not resolve host`; no published content was obtained. No PLAN, unrelated
project, private credential or protected automation-state access attempted.

STYLE_GUIDE_PARITY: UNRESOLVED for the existing organizer insertion in GameTerms
(detail/manager) and added host row in PersonalGameCard (Created/My Games).
No corresponding frozen screen or kit specimen was available to inspect and map.
Neither a genuine STYLE_GUIDE_GAP nor OWNER_VISUAL_OVERRIDE is established.
Missing access is not evidence of a missing canonical pattern. The binding rule
requires inspecting the relevant canonical family before introducing composition;
local CSS/component reuse cannot resolve that requirement. Application code is
retained pending the missing authority, rather than claiming this documentation
edit repairs the QA defect.

NOT_TESTED in this attempt: all tests, builds, lint, contract generation/verification,
browser, self-QA, independent QA, hosted CI and DEV/product acceptance. No prior
test result is adopted as current PASS. Current DEV SHA and train ordering were
not observed; no DEV/UAT claim is made.

Next single bounded action: authorized PM/reference provider makes the Owner-pinned
frozen Make source readable for the exact Created/My Games/detail/manager screens
and Avatar/GameCard specimens, or supplies an applicable explicit Owner visual
override. Source author can then map and repair only #15; independent QA must
review the publisher's exact new SHA. Publication is not performed here because
commit/push are expressly forbidden; this uncommitted handoff has no new permalink.

## Bounded repair after independent QA — 2026-10-15

Status: BLOCKED on canonical visual source; prior independent SOURCE QA FAIL remains open.
Repair base: `dc78aae34cd0aceb7459aff993dbf5ec7d375c74`, branch `automation/issue-15`, clean at entry.
Exact reviewed source: https://github.com/anpavel84-afk/gobadminton-clean/tree/dc78aae34cd0aceb7459aff993dbf5ec7d375c74

The supplied independent QA finding rejects the added organizer row in
`apps/web/src/components/consumer/games/GameDetailComposition.tsx` and changed detail
composition because neither is mapped to the corresponding frozen Make screen.
The older STYLE_GUIDE_PARITY paragraph below is an implementation description only;
its claim of reused personal-card/detail compositions is not canonical evidence.
It does not resolve this finding. No parity PASS, applicable STYLE_GUIDE_GAP, or
OWNER_VISUAL_OVERRIDE is established.

Canonical-source recovery attempted in this repair: repository file discovery and
reading the binding Owner decision and
`docs/handoffs/CLEAN_PM_V002_VERIFICATION_ADMISSION_20261013_V001.md`.
The latter names `/opt/gobadminton-clean-qa/style-guide/manifest.json`; reading that
exact path and listing its parent both returned `No such file or directory`.
The referenced `docs/operations/FRONTEND_STYLE_GUIDE_FIRST_V001.md` is also absent.
No corresponding frozen Make screen source was found in the checkout. The published
Figma page was not inspected; no callable browser is available in this source session.
Source unavailability does not establish that the Style Guide lacks a pattern and
therefore is not a STYLE_GUIDE_GAP. Local frontend code is not presentation authority.

Only this handoff is changed in the repair. Application code and existing tests are
retained pending canonical mapping; inventing a replacement layout or removing the
required creator photo from Created/My Games would not resolve the assignment.
Actually executed: read-only repository state, rules, architecture, source and source-location
inspection; this documentation edit. No tests, builds, browser runs or self-QA executed.
No commit, push, git metadata, network deployment, service or runtime changes made.
Current remote DEV revision and train ordering remain unobserved.

Next bounded action for authorized PM/source author: supply a readable frozen Make
snapshot matching the Owner-pinned source identities (or an explicit applicable Owner
visual override), inspect the exact My Games/Created/detail/manager compositions and
GameCard/Avatar kit specimens, then record file/line mapping and any genuine bounded
gap before changing the layout. Independent QA must subsequently evaluate the exact
new published SHA, followed by the separate CI/DEV/product acceptance gates.
Rollback of this repair is limited to reverting this handoff edit; no runtime rollback
is needed. Publication remains with the authorized publisher; no new SHA/permalink
exists because this assignment forbids commit/push.

The following sections record the earlier implementation, not acceptance of this repair.

Exact base: `ca6eca0bdb5f70a9b1f61106fe0f6708db1a295d`, branch `automation/issue-15`, initially clean worktree.
Base: https://github.com/anpavel84-afk/gobadminton-clean/tree/ca6eca0bdb5f70a9b1f61106fe0f6708db1a295d
Assignment: https://github.com/anpavel84-afk/gobadminton-clean/issues/15#issuecomment-6144204953
Owner train: https://github.com/anpavel84-afk/gobadminton-clean/issues/5#issuecomment-6182091853
The supplied immutable GOBADMINTON_AUTONOMY_V1 assignment authorizes only source/tests/contracts and this handoff, forbids commits, pushes, self-QA, services, automation and PROD. No next slice is authorized. Current remote DEV SHA / train ordering was not independently fetched; local base is the only observed source revision. Prior independent QA supplied: `{}`.

## Source changes (not verified behavior)

- Games list, managed list and detail enrich organizer with the current safe creator avatar. Projection joins `games.created_by_user_id`, never legacy organizer, trainer, session actor or manager identity.
- Public directory eligibility, active account, existing restriction policy and bidirectional viewer blocks gate avatar projection. Anonymous discovery has no viewer block identity. No privacy flags are modified.
- Existing avatar presentation remains the source for upload/provider precedence. Uploaded paths now require the canonical opaque PNG key format. Frontend Avatar validates media/provider URLs and keeps its existing broken-image fallback and referrer suppression.
- Discovery host is explicitly creator/organizer even for trainer-led activities. PersonalGameCard (Created, managed, participating), GameTerms (detail/manager) and GameCard use the same Avatar. Trainer section stays separate.
- Game list/detail responses receive no-store headers. Existing API client fetch and media endpoint already use no-store; replacement uses distinct media keys. Fresh reads recalculate the avatar rather than storing it in a game snapshot.
- Optional organizer.avatar is backward compatible; OpenAPI and game generated types updated together.
- Added real rendered-component regressions, projection unit cases, HTTP/DB fixture cases in the managed-games integration suite, and a synthetic loopback Playwright script covering real routes at 390/1440 widths, replacement/removal/private/broken images. No prior tests removed.

## STYLE_GUIDE_PARITY

Authority: `docs/decisions/OWNER_DECISION_FRONTEND_STYLE_GUIDE_FIRST_V001.md`, frozen `https://nougat-wise-76949869.figma.site/#guide` / `#construction-kit`, tree digest `5a04ac69a259245c72da3ed5618326e8398396b4dd2c861b6eef4aecd726b1d6`.
Reused families: GameCard, canonical Avatar initials/photo primitive, existing discovery host slot, existing game detail and personal-card compositions. Existing dimensions, tokens and responsive rules reused; only image crop/overflow rules added to the existing avatar slot. No new visual family, STYLE_GUIDE_GAP or OWNER_VISUAL_OVERRIDE proposed.
The linked `docs/operations/FRONTEND_STYLE_GUIDE_FIRST_V001.md` is absent from this checkout. Frozen external screen source and visual parity were NOT_TESTED; reuse of local canonical components is an implementation fact, not independent proof of parity. QA must check personal-card added author row and detail avatar against frozen composition on mobile/desktop.

## Evidence and limits

Actually executed: repository/rules/source reads; source file writes; `node packages/contracts/scripts/generate-game-types.mjs --write` (source generation only).
NOT_TESTED: compilation, lint, contract verification, unit/integration tests, browser script, independent SOURCE QA, hosted full Product CI, live DEV, paired images/digests, backup, root-owned server acceptance, product browser smoke/UAT. No PASS claimed. No DB, account, secret, service, deployment or git metadata writes performed.

Important review points: directory-hidden/social-ineligible creators intentionally produce initials even for their own managed games. Existing media serving semantics are reused, not redesigned: directory visibility is a game projection gate, not revocation of existing opaque media URLs across other authorized surfaces. Restrictions obey the existing internal flag; this slice does not enable flags. Provider caching/revocation remains the existing provider/media contract. No push/live synchronization is introduced for already mounted game pages; fresh fetch/navigation reads current projection. Idempotent mutation receipts retain existing snapshot semantics. Projection currently adds bounded per-item queries; assess list cost. Browser fixture private mode proves UI handling of a redacted DTO; HTTP/DB tests exercise actual visibility/block gates. Browser script requires the existing local Playwright installation and an independently prepared loopback Web server.

## Publication / rollback / next bounded action

User explicitly prohibits commit/push: changes are uncommitted, no new source SHA or published artifact permalink exists. Do not cite base as new implementation evidence. Authorized publisher must record exact new SHA and artifact permalink after independent review, preserving this NOT_TESTED status until evidence exists.
Rollback: authorized integrator discards/reverts only this slice's files; no schema migration or runtime rollback is required by these source edits. Never discard unrelated work.
Next bounded action: independent SOURCE QA on the publisher's exact new SHA, including tests and privacy/URL/broken-image checks. Repair within #15 if findings occur; separate hosted CI and authorized DEV acceptance gates remain mandatory. This source handoff does not authorize executing those runtime effects.

## Attempt 4 — canonical input recovery / source supersession (2026-10-15)

Base remains `98753ee2e4fd9e71dde58a41bb47307702c221af`. Prior FAIL/BLOCKED and NOT_TESTED records are preserved. The earlier no-gap statement is superseded by the inspected published reference and bounded gaps documented in [ISSUE_15_CANONICAL_REFERENCE.md](ISSUE_15_CANONICAL_REFERENCE.md). Source composition was actually repaired, not merely relabeled. Separate trainer identity and valid synthetic opt-in fixture restored; browser globals declared. No tests/self-QA or publication executed; independent QA4 and all CI/DEV/UAT acceptance remain pending. No new candidate SHA is claimed.
