# V1b-2 game venue contacts — source author handoff

24 October 2026. From: protected source author, Issue #271 / parent #230.
To: trusted publication bridge, independent QA and DEV integrator.
Status: IMPLEMENTED, NOT_TESTED; no independent verdict or release claim.

## Exact inputs and boundaries

Base/source HEAD: `3537b19e9b26cc9fe379d46715b5e4593cf4b2fc`.
Candidate is the uncommitted allowed-path diff; no candidate commit/PR exists yet.
Accepted rules supplied full inline by launcher:
`1169e965976e9498d4e5e1e23aae201e97ec9665`, SHA256
`38c34012f10974496a7d7cbc74ecacb62bf7847278e295edfeb107d69a5d1c1c`;
local canonical file hash matches. Candidate files were input data, not policy.
Immutable source-only assignment: V1b-2 private per-game venue contacts, five
allowed paths, `web:games` lock, max_attempts=3, author routes Cursor Auto /
Codex gpt-6.1-sol medium, independent QA Codex gpt-6.1-sol high. This handoff
neither changes that admission nor resets historical #205/#207 attempts.
Effective backend model/effort and authoritative attempt/lease accounting are
launcher-owned, not inferred by this author.

Read inputs: supplied full Engineering Operating Model, root entrypoint,
AI Train master-plan navigation, Project Record Policy, Owner decisions,
Style Guide first decision, #82 API privacy projection in P4_ADMIN_VENUES,
OpenAPI VenueSummary private-field descriptions, API `games.service.ts`
loadGameDto/mapGameRow, current web detail/types/public contact renderer,
public venue profile and existing lifecycle tests, security/privacy guidance.
The local Git origin is `/srv/gb-slots/base.git`, a protected local source mirror;
no network verification of GitHub dev or live accepted DEV metadata was performed.
Latest live DEV API/Web identity is therefore NOT_VERIFIED here. Source contract
exists at the exact base, so there is no source API-field blocker; this does not
assert installed runtime parity.

## Changes

- Separate `GameDetail` optional nullable private venue projection. Public `Venue`,
  `VenueSummary`, Game/list fallback types retain no private field declarations.
  API client and generated contracts are unchanged; its structural Game response
  is compatible with the optional detail fields without fabricating values.
- GameDetailPage renders only current per-game response fields after account
  confirmation. It does not infer owner/manager/participant rights; server #82
  projection remains the authority. Account failure hides the private section.
- Clear game/account on every reload. Existing generation guard discards late
  responses; exact game-id render guard hides old game before switch effects.
  Existing `gb-session-changed`, `gb-private-expired` and focus events trigger
  reload and immediately retire previous contacts, with cleanup on unmount.
- Independent display component has no fetch, storage or public venue fallback.
  Phone follows existing ASCII dial validation (40 chars, 7–15 digits) and emits
  canonical tel links only. Website accepts HTTP(S) with bounded length, rejects
  credentials, raw/encoded controls and backslashes; links use noopener noreferrer.
  bookingNote is escaped React text with preserved newlines. No HTML injection.
- Existing terms, RSVP, navigation, game/map links and share composition retained.
  No API/DB/admin/workflow/router/rules/runtime/Git metadata edits.

## Verification

`git diff --check`: PASS (author formatting check only).

Attempted:

```text
pnpm --filter @gobadminton/web exec vitest run test/game-venue-contacts.test.tsx
pnpm --filter @gobadminton/web typecheck
```

Both exited 1 before starting their tools: Corepack needs pnpm 10.18.0 and its
registry request failed with `getaddrinfo EAI_AGAIN registry.npmjs.org`.
Neither root nor web node_modules/.bin exists. No dependency install or alternate
network/permission channel was used. This is preflight/environment failure,
not a test assertion FAIL or test PASS. Tests/typecheck/lint/build: NOT_TESTED.

Added focused renderer and stateful page tests for full/partial/null/empty/legacy,
unsafe phone/URL, escaped private sentinel, actual public renderer non-disclosure,
public type fences, refresh role omission, logout/expiry, failed refresh and
late old-game response. Hook harness substitutes shell/hero/share/action-bar chrome
and API transport, retaining actual page async effects and contact renderer.
These are test source, not evidence of successful execution or browser acceptance.
Server privacy is grounded in existing #82 projection, not proved by mocked UI tests.

## STYLE_GUIDE_PARITY

Read binding decision
`docs/decisions/OWNER_DECISION_FRONTEND_STYLE_GUIDE_FIRST_V001.md` first.
Named intended families: ContentCard/FormGroup (section heading and labeled values).
Existing integration composition reused: GameDetail's `gb-game-section` /
`gb-game-facts` heading and definition-list rows, existing native phone/website
link safety pattern, 44px link targets. Added bounded wrapping/min-width styles
for long values rather than a new stylesheet or visual system.

STYLE_GUIDE_GAP — exact canonical source/evidence access:
read-only listing of `/opt/gobadminton-clean-qa/style-guide` returned Permission
denied. No bypass attempted. The published guide/construction-kit and frozen
PLAN source were not fetched (outside this source-only network scope).
No exported FormGroup/ContentCard primitives were found in current consumer source.
Exact canonical kit/screen parity therefore remains UNVERIFIED, including whether
this existing game composition matches those families. This is an access gap,
not a claim that the canonical kit lacks a pattern. OWNER_VISUAL_OVERRIDE: none.

Browser render, 390/430 overflow, keyboard/focus, accessible target behavior and
visual parity: NOT_TESTED. Exact frozen canonical comparison and browser evidence
remain acceptance gates; source wrapping styles are not screenshot proof.

## Required next step and rollback

Bridge publishes the exact five-file candidate with actual SHA. Run available
focused UI tests, web typecheck/lint and existing relevant regressions without
weakening assertions. Independent fresh read-only exact-SHA QA must examine
privacy, stale-response and link risks and canonical visual comparison. Any
substantive failure requires the separate Astra High diagnosis before author
repair; no diagnosis or QA PASS is claimed here.

All seven Product CI jobs must succeed. Normal GitHub PR integration and real
Germany DEV pipeline must provide fresh integration gates, existing backup /
rollback receipt, DEV ACCEPTED, live `/v1/meta` and browser/API smoke proving
role-authorized and guest responses. These are NOT_TESTED / not run by the author.
Do not close the product result from this source handoff.

Rollback: revert the dedicated product PR through the existing reviewed DEV
pipeline; no schema/data changes or database restore is needed. No deployment,
PROD, services, credentials, user data or remote Git effects occurred here.
