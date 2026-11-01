# Issue #445 followup — release metadata alpha.7 (points 2/3/5/6)

From: Cursor Auto (`VISUAL445_FOLLOWUP_RELEASE_METADATA`, attempt 1, base `5f598d31021803e63c3e4e5c57e5f80bd932dfdf`).
To: independent Codex Sol Medium QA → mandatory Product CI → trusted DEV → Owner UAT.
Status: SOURCE CANDIDATE for `0.1.0-alpha.7` release descriptor only. **UAT = NOT_TESTED**.
Do **not** close #445 (`Refs #445`, no Closes). Production UI **not** changed in this pass.
PROD forbidden. No fake READY/PASS / installed claim for alpha.7.

## Scope this writer

Final application/release metadata for combined bounded followup points **2 / 3 / 5 / 6** only.
Source UI already written by Cursor in prior commits. This pass sets
`CURRENT_APPLICATION_VERSION = 0.1.0-alpha.7` (API contract remains `0.22.0`), records
confirmed alpha.6 historical seed from delivered DEV receipt, and marks alpha.6 changelog
as factual DEV ACCEPTED. First named alpha.1 baseline kept literal.

## Point 1 already delivered (do not re-author UI)

| Fact | Value |
| --- | --- |
| Issue | #445 point 1 |
| Source PR (report) | #433 (canonical #432) |
| Delivery PR | #446 |
| Merge / accepted source | `4fdf232ac576b7c830c77405267795634b9ae43b` |
| Product CI | `41328299309` 7/7 |
| DEV receipt | `r41329378049-a1` accepted `2026-11-01T17:07:45Z` |
| Digests | api `sha256:753b6ba…762c0c0`, web `sha256:7a8c300…16163e40` |
| Application version | `0.1.0-alpha.6` (historical seed + changelog ACCEPTED) |

Working tree already ordinary-merged accepted `dev`. Preserve first-alpha baseline literal.

## Prior UI source PRs (reused; not reinvented)

| Point | Topic | Source PR / note |
| --- | --- | --- |
| 1 | Level range common track | PR #433 → delivered via PR #446 / alpha.6 |
| 2 | Friends own-profile guidance | PR #436 |
| 3 | Legacy `/games/map` + `/venues` → canonical map | Map source PR **not provided** in report — not invented |
| 5 | Neutral finder prerequisite (desktop/mobile) | PR #429 / #439 |
| 6 | Recommendations own-profile guidance | same social-guidance work as point 2 |
| 4 | Out of this metadata delta | Needs reporter game URL/role; postgame fixture waits reporter ID |

## Unchanged UI — acceptance checks reused (author evidence, not independent QA)

Do **not** re-run full matrix. Prior targeted checks remain the acceptance evidence for
unchanged production UI:

- Route/player: **26** tests PASS (`map-route-aliases` + player-browse discovery/friendship family).
- Friends/recommendations: **20** tests PASS; typecheck PASS.
- Earlier fixture FAIL preserved and fixed in prior social-guidance pass.
- Level-range / create-game addressed checks from alpha.6 delivery remain for point 1.

This metadata pass touches only release catalogue / changelog / handoff — no production UI.

### Author checks this pass

- Model environment: **no installed deps** — `vitest` for `releases.test.tsx` /
  `releases-server.test.ts` **not** run here.
- Deterministic source/changelog/seed sanity (26/26) against delivered alpha.6 JSON +
  receipt: alpha.7 current, alpha.6 historical ACCEPTED facts, unbound alpha.7 SHA,
  first-alpha baseline literal.
- Trusted operator should run:
  `pnpm --filter @gobadminton/web exec vitest run test/releases.test.tsx test/releases-server.test.ts`

## CURRENT_NAMED_RELEASE delta (alpha.7 candidate)

- Legacy `/games/map` + `/venues` enter existing canonical map.
- Invalid non-game UUID terminates before API.
- Neutral finder prerequisite fits desktop/mobile.
- Friends/recommendations show own-profile save/visibility guidance with `/profile` link
  instead of false outage when own profile unsaved/hidden.
- No auto opt-in / no backend permission changes.
- `source_sha`: **null** until trusted ACCEPTED (unbound).

### Known limitations (honest)

- Point 4 needs reporter game URL/role; postgame fixture waits reporter ID.
- Go Bad / Owner UAT = NOT_TESTED.
- PG-3/PG-4 still not installed; PROD unchanged.
- Do **not** promise all fresh users eligible, private profiles enabled, or all of #445 done.

## Design read-acks (preserved; no redesign)

Mandatory design read-acks remain in existing handoffs — copy references here, do not redesign:

| Material | Where recorded | Notes |
| --- | --- | --- |
| Sitewide owner-v3 | `docs/handoffs/visual-qa445-navigation.md` | shell/`statebox`, venue «Назад к карте»→map; no redesign |
| Players desktop-v5 | `docs/handoffs/visual-qa445-navigation.md` + `visual-qa445-social-guidance.md` | v5 HTML/PNG SHA recorded on social-guidance pass; confirms neutral catalogue-visibility wording + `/profile` |
| Admission / HTTP before | `visual-qa445-navigation.md` | `/games/map`, `/venues`, finder copy scope |

This followup metadata writer does **not** re-open or rewrite those design proofs.

## Input materials read (this pass)

| Material | Delivered path | SHA256 | Read |
| --- | --- | --- | --- |
| alpha6 history seed | `…/design-inputs/alpha6-history-seed-for-alpha7.json` | `efe8db4c91e9c59be2a00c4cdf633c871689728a09f6a480ae432e8568655521` | Yes — exact alpha.6 HistoricalReleaseSeed |
| accepted deploy receipt | `…/design-inputs/accepted.json` | `d1d2234097f93f830dd285b29e9c30f1ead17f9b72d976f5ef8530b387afd06f` | Yes — `r41329378049-a1` / SHA `4fdf232…` / digests |

## Changed paths (exact allowed only)

- `apps/web/src/lib/releases.ts`
- `apps/web/test/releases.test.tsx`
- `apps/web/test/releases-server.test.ts`
- `docs/releases/CHANGELOG.md`
- `docs/handoffs/visual-qa445-followup.md`

## Non-goals

- No production UI edits; no Git/runtime/root/PROD/C5/secrets/AGENTS.
- No new framework, scheduler, or full test matrix.
- No rewrite of older historical seeds beyond factual alpha.6 ACCEPTED status already delivered.
- Issue #445 stays open until Go Bad full PASS.
