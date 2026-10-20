# NAV1b — games shuttlecock

From: source author (Codex)
To: PM / integrator / independent source QA
Date: 2026-10-20
Status: PROPOSED — source only, not accepted
Task base: `0e75b57fac4ea1ffc995393395147d499e4ff366`.
Revision entry HEAD: `f2ef77624536be2b4ab5c2d4b0926be8505bc7ba`
on `automation/issue-138`; initial working diff empty.
Assignment: immutable NAV1b source task, successor of #136, current worktree issue-138.

## Scope and successor

The NAV1b implementation relative to the task base changes only `games` in
`apps/web/src/components/consumer/nav-icon-paths.tsx`,
`apps/web/test/nav-icons-variant-b.test.tsx`, and this handoff.
This revision changes only the test and this handoff; the glyph is already present
at entry HEAD. NAV1b has its own limit of 3. No predecessor history or attempt
counter is changed.
No commits, Git metadata writes, network operations, dependency installation, automation,
services, API/DB changes, deployment or PROD actions are authorized or performed.
Newer dev must be reconciled manually by the integrator. Rollback: reverse this diff.
Publishing the durable GitHub record and adding exact result permalinks belongs to the integrator.

## Proposed final paths (head / upper / middle / lower)

```svg
<path d="M5.4 15 L9 18.6 A2.545584412271571 2.545584412271571 0 0 1 5.4 15 Z" />
<path d="M5.32 14.92 L10.739503532 3.677165335 A1.4 1.4 0 0 1 13.277165335 4.860496468 L5.32 14.92 Z" />
<path d="M7.2 16.8 L16.820101013 5.2 A1.4 1.4 0 0 1 18.8 7.179898987 L7.2 16.8 Z" />
<path d="M9.08 18.68 L19.139503532 10.722834665 A1.4 1.4 0 0 1 20.322834665 13.260496468 L9.08 18.68 Z" />
```

Feathers have a pointed root, straight sides and a circular rounded end. Side axes
are SVG rotations of u by -20/+20 degrees. The narrow roots separate from B;
upper/lower are reflections under R(x,y)=(24-y,24-x).

## A1–A5 / A7 source delivery (execution UNVERIFIED)

- A1: production edit is restricted to games, four d-only closed absolute paths,
  prescribed D head first. Other glyphs and SVG presentation are untouched.
- A2: only /games expectedTabs shapes changed; existing SSR/CSS/badge/profile
  assertions retained. RootNav SSR now covers games and players active states,
  with independent ordered shapes/labels/hrefs and exactly one aria-current.
  Only next/link is mocked. Separate NavIcon SSR supplies geometry.
- A3: complete command parser rejects leftovers, implicit commands, missing values,
  nonfinite values and invalid arc flags. L/Z subdivision, recursive de Casteljau C
  (control-point distance to chord <=0.01), SVG endpoint-to-center A including rotation,
  radius correction and degeneracy; arc steps obey sagitta <=0.01 and edge <=0.05.
  Tests cover analytic bowed cubic and rotated ellipse in both directions, radius
  correction, L/Z, malformed paths and degenerate arcs.
- A4: conservative reflected contour distances include h/2+2 epsilon. Capsule
  exclusion splits edges analytically at endpoint circles and offset sides, removes
  only interior intervals, and requires nonempty remnants. Segment distances include
  crossings/overlaps. Gap tests use d-2 epsilon>=2.6 and stroke clearance>=0.8.
  Units cover crossing diagonals, collinear overlap, and complete capsule crossings
  with two retained parts and analytic cut points.
- A5: SSR contour vertices enforce margins, overall bbox, middle/head u-span ratio,
  head mean excluding repeated closure, far feather tips and widths along each
  specified normal. Test code uses explicit undefined narrowing, no any, Proxy,
  non-null assertions or TypeScript suppressions.
- A7: this handoff records scope, evidence, incoming history and next recipient.

These are author implementation notes, not independent source QA verdicts.
A1–A5 test assertions have NOT run in this environment; no source PASS is claimed.

## A6 — executed author commands

The commands and results below were repeated for this A3 revision on 2026-10-20.
All commands below were invoked from repository root, with no installation or
network enabling. Each pnpm command exited 1 before the requested tool ran:

```text
COREPACK_ENABLE_NETWORK=0 pnpm --filter @gobadminton/web exec tsc -p tsconfig.json --noEmit --incremental false
COREPACK_ENABLE_NETWORK=0 pnpm --filter @gobadminton/web run lint
COREPACK_ENABLE_NETWORK=0 pnpm --filter @gobadminton/web exec vitest run --no-cache test/nav-icons-variant-b.test.tsx
```

Common exact output:

```text
! Corepack is about to download https://registry.npmjs.org/pnpm/-/pnpm-10.18.0.tgz
Network access disabled by the environment; can't reach https://registry.npmjs.org/pnpm/-/pnpm-10.18.0.tgz
```

Typecheck: NOT_TESTED. Lint: NOT_TESTED. Vitest: NOT_TESTED.
Reason: pnpm 10.18.0 unavailable locally and Corepack networking disabled.
`git diff --check`: exit 0, no output (PASS for whitespace only).
No independent QA or rendered comparison was performed.

## Prior independent QA finding and bounded source revision

Incoming independent QA: FAIL, reviewed_sha
`f2ef77624536be2b4ab5c2d4b0926be8505bc7ba`. A3 finding: arc flags were parsed
as general numbers, accepting `0.0`, `1e0`, and signed `-0 +1`.
This is separate from the PM_REPORTED #136 history below.

The parser now reads the original numeric token and accepts a flag only when its
spelling is exactly `0` or `1`, before numeric conversion. Regression assertions
cover decimals, exponents, signs, leading zeroes, out-of-range and nonfinite tokens
in both positions, the reported signed pair, and all four valid flag combinations.
Production geometry, expectedTabs, thresholds, SSR and prior unit assertions remain
unchanged in this revision. A1–A5/A7 remain implementation notes requiring new
independent source QA; this document does not issue a QA verdict.

## Incoming history — PM_REPORTED / UNVERIFIED_BY_THIS_REVIEW

Original reports are unavailable in this checkout. The following six historical
FAIL entries are copied as incoming PM context, without re-evaluation or treating
historical SHAs as required inputs:

| #136 attempt | Historical report SHA | PM_REPORTED A6 reason |
|---|---|---|
| a1 | ab6fd7db | no pnpm; typecheck/Vitest NOT_TESTED; diff --check PASS |
| a2 | 273c7431 | no pnpm / Corepack disabled |
| a3 | 06d201b9 | no offline pnpm |
| a4 | 23b74f8b | TypeScript/Vitest not executed |
| a5 | 1f6ee9b8 | no node_modules/tsc/vitest fallback |
| a6 | a75a7e78 | execution unavailable; diff --check PASS |

PM reports these six FAILs as environment availability failures in A6.
This author does not certify the history. NOT_TESTED alone is not a source defect.

## STYLE_GUIDE_PARITY

Canonical family: Navigation/BottomNav. Existing shell, dimensions, stroke 1.8,
currentColor, round cap/join, fill none, decorative accessibility attributes,
active --gb-ink / --gb-lime-soft circle and inactive --gb-ink-soft are reused.
Owner authority: `docs/decisions/OWNER_DECISION_FRONTEND_STYLE_GUIDE_FIRST_V001.md`, step 5.
Published reference: https://nougat-wise-76949869.figma.site/#guide.
Incoming task evidence identifies frozen App.tsx SHA256
`04187d4d7d70c8c61e9ca2f08b6b6325a98539a3ec90c711c48ab771f675b61c`
and Navigation/BottomNav games asset `public/assets/f8ab5.svg` as a court with
one internal horizontal and one vertical line, without a suitable shuttlecock.
The external `/opt/gobadminton-clean-qa/style-guide` tree was not accessed here.
`docs/operations/FRONTEND_STYLE_GUIDE_FIRST_V001.md` is absent in this checkout;
the Owner decision was read locally.

STYLE_GUIDE_GAP=shuttlecock-glyph. Form: PROPOSED PM proposal.
Rendered parity: UNVERIFIED. OWNER_VISUAL_OVERRIDE: not claimed.
iPhone: NOT_TESTED. No new screen composition is introduced.

## Risks and next bounded action

Geometry and strict TypeScript still require actual tool execution; the glyph also
needs rendered review. Source PASS would not mean full acceptance. Next: independent
source QA on A1–A5/A7, followed by new full Product CI including source(web) on the
integrator's new exact SHA before merge. QA JSON stays verdict/findings/reviewed_sha;
no runtime or schema changes are proposed. Integrator adds exact result permalinks.
