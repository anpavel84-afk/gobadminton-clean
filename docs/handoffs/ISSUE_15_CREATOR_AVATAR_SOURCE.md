# Issue #15 — creator avatar source handoff

From: source author. To: independent SOURCE QA / authorized PM. Date: 2026-10-15.
Status: WORKING_DRAFT / UNVERIFIED; source only, no acceptance or deployment claim.

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
