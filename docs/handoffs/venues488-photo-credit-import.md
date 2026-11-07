# #488 / #509 · alpha.49 release metadata + actual48 coverage finalization

From: Cursor Auto (sole source writer). To: independent QA / CI / DEV / PM.
Date: 2026-11-07. Status: SOURCE_CANDIDATE — pending independent QA / Product CI / guarded DEV.49.
Assignment: `OWNER488_ALPHA49_RELEASE_AND_ACTUAL48_COVERAGE_FINALIZATION` attempt 2.
Base: `f07de3a70fe692e38e5912109607508589db4e91`. DEV only. No PROD / C5.

## Scope (allowed paths only)

Metadata / coverage / handoff only. No application-logic rewrite, no 0063 edits, no live DB/GitHub/provider/deploy.

| Path | Change |
| --- | --- |
| `apps/web/src/lib/releases.ts` | Current → `0.1.0-alpha.49` (SHA/date null, UAT NOT_TESTED); append exact accepted alpha.48 seed; API contract stays `0.37.0` |
| `apps/web/src/lib/releases.test.ts` | Co-located literals track alpha.49 (ignored by default Vitest include) |
| `apps/web/test/releases.test.tsx` | Catalogue integrity for alpha.49 + historical 48 |
| `apps/web/test/releases-server.test.ts` | Seed deployment count 57; accepted_at list includes 48 |
| `docs/decisions/CONTENT_MODERATION_V2_COVERAGE_V001.md` | B1b role review/reply → actual DEV.48 ACCEPTED facts only |
| `docs/handoffs/venues488-photo-credit-import.md` | This handoff |

## Trusted facts used (exact)

Accepted DEV.48 seed (must-copy; older 47/46/… untouched):

- `application_version` / `version_label`: `0.1.0-alpha.48`
- `title` / `additions` / `fixes` / `known_limitations` / `owner_uat`: from trusted seed
- `source_sha`: `608f44e9af26da7ea24881fe31c2c7e49ed8aeb3`
- `release_id`: `r42412760323-a1`
- `accepted_at`: `2026-11-07T20:59:58Z`
- digests: api `sha256:0145f018db57417491b262c83e88dd5cf779860faca64762f3e92bfc34c86295`, web `sha256:cd91420354aaee9b2a78bd8502d31804296e5ed474410b909604f32224f491df`
- PR #512 / CI `42411921909` (FINAL_RECEIPT); authorized role Admin UI / GoBad / Owner UAT remain NOT_TESTED

Current alpha.49 public delta (simple wording; not yet ACCEPTED):

- Stable venue-gallery photo-credit place while flipping photos
- Authorized maintenance of an already-accepted venue gallery without external new uploads
- Factual new content: **9 photos on 4 venues**
- Does **not** claim all 138/140 selected photos published, does **not** claim new UI already released on DEV, does **not** invent independent hall verification

Coverage honesty: B1c / B2 / C / D and #507 I remain unfinished. Baseline 59 image approvals were before the packet of 9; 68 expected after first-five + second-packet M1 accepted (originals/moderation retained, WebP derived) — no invented live DB count; text-moderation coverage rows unchanged. Private external egress OFF.

## Parent source checks (already recorded; not re-run as Product CI)

From parent `parent-checks.json` on candidate `f07de3a…` (not Product CI):

| Check | Result |
| --- | --- |
| API typecheck | PASS |
| Web typecheck | PASS |
| API lint | PASS |
| API unit | 13 |
| Web targeted | 48 |
| Own PostGIS maintenance integration | 2 |

This metadata pass does not change source functionality. No new paid provider calls / DB / GitHub / live changes.

## Author checks this pass

- Deterministic catalogue/coverage invariants against trusted alpha.48 seed + FINAL_RECEIPT: PASS (CURRENT=49, SHA/date null, seed 52/57, exact 48 fields, B1b ACCEPTED facts, no 138/140/WebP/#507 claims).
- Workspace had no `node_modules`; `pnpm install` network denied in this environment — Vitest `apps/web/test/releases*.test.*` **not executed here**. Co-located `src/lib/releases.test.ts` updated for consistency; ignored by default Vitest include — do **not** claim it executed.
- Do **not** treat author checks as independent QA / Product CI / DEV ACCEPTED.

## Honest status for next gates

- Independent QA: **pending** (author tests are not independent QA)
- Product CI: **pending** (run release test files there)
- DEV.49 release / smoke / bind SHA+date: **pending** future actual acceptance
- Owner UAT: **NOT_TESTED**
- PROD / C5: not authorized
