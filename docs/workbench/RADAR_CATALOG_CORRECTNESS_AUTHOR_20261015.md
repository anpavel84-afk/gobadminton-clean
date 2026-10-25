# Radar catalog correctness — producer handoff

WORKING DRAFT — NOT APPROVED — NOT CANONICAL

From: AUTHOR implementation, agentagency-dev. To: PM / independent frontend QA.
Date: 2026-10-15. Status: READY_FOR_REVIEW, local uncommitted candidate.
Exact base DEV: `3d6731243ec8e2a737fa1ea7353aee06b3219af0`.
Base permalink: https://github.com/anpavel84-afk/gobadminton-clean/commit/3d6731243ec8e2a737fa1ea7353aee06b3219af0

## Assignment and effects

OWNER DIRECT: fix `/players` catalog composition in the dedicated
`dev-radar-all-players-20261014` worktree. Radar OFF must preserve the ordinary
catalog. Radar ON overlays server-ordered live Radar participants before the
ordinary catalog under the user's original filters, including All cities.
Dedupe by publicPlayerId across ordinary pages; preserve pagination, 30-second
private budget, scope/activation fences and fallback availability. Only existing
Show on map action; canonical PlayerCard. Handle more than 50 Radar peers with
existing More pagination before ordinary remainder. No static real-user fixtures.

Authorized writes: PlayersDirectoryPage.tsx, unified-directory.ts, related frontend
tests and docs only. No commits, pushes, deployment, migration, dependency install,
PROD/PLAN/VPN, or edits in the separate Friends/API/UI author's worktree. Those
constraints override publication requirements for this author pass. This record
is prepared for a later authorized GitHub publication; no candidate permalink
exists yet. No issue/GB number was supplied; none was invented.

## Implementation facts

- Ordinary listPlayers requests always use the selected ordinary city and run
  independently of unified data. All cities remains selectable and selected.
- Radar queryCity uses selected city or advertised Moscow fallback. Ordinary
  cursors depend only on ordinary filters, so OFF/ON keeps loaded pages intact.
- mergeRadarCatalog accepts only current, matching controller context and live
  Radar rows. It ignores unified ordinary rows and preserves both server Radar
  ordering and independent catalog ordering, deduping publicPlayerId.
- Existing More loads outstanding Radar ranks before revealing ordinary remainder.
  On private busy/failed/stale/expired/unavailable state the ordinary catalog is
  available immediately. Busy pagination temporarily shows the ordinary fallback;
  the completed authorized Radar list restores server ordering.
- Filter/activation matching fences render-time stale overlays before effects run.
  Controller epoch, abort, account, visibility, queryRef and cooldown logic remains.
  Preview is also gated by the matching current context.
- No API contract or architecture change. Rollback: remove this candidate's diff
  in the listed files against the exact base, preserving any subsequent edits.

## STYLE_GUIDE_PARITY

Reused PlayerCard, UnifiedPlayerCard delegation, existing Button/More, city select,
filters, hero and ProfileState. One seamless catalog container as explicitly
requested by Owner. No new presentation primitive, sorting control or CSS.
No STYLE_GUIDE_GAP or additional OWNER_VISUAL_OVERRIDE claimed. The decision
`docs/decisions/OWNER_DECISION_FRONTEND_STYLE_GUIDE_FIRST_V001.md` was read;
referenced `docs/operations/FRONTEND_STYLE_GUIDE_FIRST_V001.md` is absent at base.
Browser/Figma visual parity was not independently checked.

## Evidence and limits

Executed on Node 24.21.0, without installs:
`node apps/web/test/unified-catalog.node-check.mjs` — 6 checks PASS. Runs actual
TypeScript merge/controller code using Node's transform; covers six Radar peers
plus multiple catalog cities, city remainder, ordinary page2 duplicates, OFF/ON,
busy/auth/stale/expiry fallback, >50 Radar pagination and cross-page dedupe,
private A-B-A / late responses / 30s budget, and source wiring assertions.
The source wiring assertions are not a browser integration test.

`python3 -B scripts/check_foundation.py` — PASS.
`git diff --check` — PASS.
Existing Vitest pagination expectations updated to ordinary-filter scope.
Vitest, full typecheck, browser interaction and independent QA not run: no local
node_modules; dependency installation prohibited. Author checks are not independent QA.

Next bounded action: independent QA reviews this uncommitted candidate and tests
browser filters, ordinary late-response cancellation, toggles, More and canonical
card parity. Publication/release require their separately authorized actors.
