# Handoff — #521 unified trainer/ordinary discovery game card

**Assignment:** `OWNER521_QA1_IDENTITIES_LONG_NAMES_RELEASE_TESTS_BROWSER_REPAIR`
**Author:** cursor:auto · attempt 2 · base `f398ca3770c7143aed325138a4a3ee9bcb2cdc1d`
**App candidate:** `0.1.0-alpha.57` · API wire unchanged `0.39.0` · `source_sha` null · Owner UAT **NOT_TESTED**
**Refs:** #521 · #523 (combined UI release 57; see `player523-actions.md`) · QA1 three findings FAIL · parent lint/release FAIL · Owner screenshot
**Scope:** source only · single writer · do not touch #507 WT/branch · DEV56 only → target DEV57 card fix · no Git/push/deploy/PROD

## QA1 findings addressed

1. **HIGH — identity namespaces:** Removed `sameKnownPerson` / id-equality merge. `trainer.profileId` and `organizer.id` are different namespaces; no confirmed common person key in the allowed contract. Trainer and organizer rows are **always** shown separately, even when UUID/name strings coincide. No private user id / new API for UI dedupe; names are not identity. Stable `data-trainer-profile` / `data-organizer-id` attributes retained; compact layout / reputation / CTA preserved.
2. **MEDIUM — long names:** Host `strong` uses `overflow-wrap: anywhere` + `white-space: normal` (no nowrap/ellipsis). Full names wrap at 390/820/1280 without clipping CTA.
3. **MEDIUM — release pins:** `releases.test.tsx` + `releases-server.test.ts` updated to CURRENT `0.1.0-alpha.57` / #521 card delta; API stays `0.39.0`; historical seeds/dates/hashes/first-alpha invariants preserved. Delta is #521 only (not #507).

## Parent lint / browser repair

- ESLint `URL`/`Event` undef: file globals comment scoped for Node24 CDP helper (not lint disable).
- Browser helper rewritten to qualified Chromium CDP at `/opt/gobadminton-qa/chromium-headless-1243/chrome-headless-shell` (no Playwright dep / no sandbox-disable flags / no shared Chrome kill). Exact SSR markup from Vitest fixture + real tokens/consumer/discovery/role-reputation CSS; host viewport/padding only. Abort network GETs; screenshots/metrics/receipt under provided `outputdir` argv (not repo). Viewports 390/820/1280; long names; same-string-ids / distinct / missing trainer; reputation append + resize. If Chromium unavailable → honest **NOT_TESTED** (parent executes). Geometry proof only — not DEV/Owner UAT.

## Release notes

- `CURRENT_APPLICATION_VERSION` → `0.1.0-alpha.57`
- `API_CONTRACT_VERSION_NOTE` stays `0.39.0` (web-only card)
- CURRENT delta describes only this #521 layout/roles/wrap fix
- Historical seed / older acceptances / first alpha preserved; no invented SHA/date/receipt
- #507 unpublished numbering left for post-accept renumber; #507 branch not edited

## Paths touched (allowed only · 10)

- `apps/web/src/components/consumer/discovery/DiscoveryGameCard.tsx`
- `apps/web/src/styles/discovery.css`
- `apps/web/test/discovery-training-card.test.tsx`
- `apps/web/test/discovery-training-card.browser.mjs`
- `apps/web/test/fr01-discovery.test.ts` (unchanged contract; retained)
- `apps/web/test/owner-a-discovery.test.ts` (unchanged contract; retained)
- `apps/web/src/lib/releases.ts`
- `docs/handoffs/game521-training-card.md`
- `apps/web/test/releases.test.tsx`
- `apps/web/test/releases-server.test.ts`

## Materials

- Owner screenshot `owner521-reference.png` (sha256 `60cd4f0f0e0e51fba80865a207ef676c0047aa19ced67e0f57f6d96c830b5fe6`) — **verified local image available for independent QA this pass**
- QA1 findings JSON + parent lint/release FAIL logs + existing CDP pattern

## Checks

- Targeted web types/lint/card+release tests expected after parent install.
- Browser helper: Chromium path may be absent in author sandbox → **NOT_TESTED** here; helper ready for parent with real Chromium. Not a self PASS/DEV claim.
- Remaining: independent Sol Medium QA → CI 7/7 → guarded DEV57. UAT=NOT_TESTED.
- Preserve original 1/7 UNKNOWN/costs and #507 pending work.

## Explicit non-claims

- No #507 community/API.40/schema68 notes, no PROD/C5/new OPS/service/architecture/API/roles/deps/media pipeline.
- No Mode B / AGY READY, no self DEV ACCEPTED, no invented acceptance seed.
- No private image publication; media approval pipeline unchanged.
- No height-observer / stacked latch return; source regular-grid static accepted by QA1 retained.
