# DEV Players / Radar source handoff

WORKING DRAFT — NOT APPROVED — NOT CANONICAL

From: agentagency-dev producer. To: Owner / independent QA. Date: 2026-10-14.
Base: d27284a9cafc05df10e8382be0421585095ce90e.
Branch: feat/dev-players-radar-map-mobile-20261014. Status: UNCOMMITTED SOURCE CANDIDATE.

Owner direct assignment: DEV only; modify source and tests in this worktree; no commit, push, deployment, dependencies, server configuration, database, secrets, production, VPN, PLAN or root files. This instruction supersedes routine publication: no GitHub result permalink exists until separately authorized publication.

Implemented: existing header Radar status immediately before profile; four original bottom tabs and safe area retained. Explicit env parsing and fail-closed typed Moscow dev_preview registration. Immutable Germany style-dev browser hash verification and map resource fence, existing authorized map paging, bounded clickable venue markers from existing public API with textContent popup and actual rendered count. Active Radar automatically queries UnifiedPlayersService with current activation and supported Moscow fallback; ordinary catalog remains available without a private snapshot. Manual unified-mode controls and Подробнее removed. Both projections reuse PlayerCard; directory retains profile link and Radar-only uses safe preview. Map route recovers private context using active activation without persisting a raw fix; initial requests retain 30s cooldown and 429 backoff. Existing backend ranking, consent, region, session and paging unchanged.

## STYLE_GUIDE_PARITY

Reused canonical families identified by binding Owner Style Guide decision: header/profile/status, original four-tab bottom navigation, PlayerCard, Button, notice/loading/error, existing map camera and preview bottom sheet. PlayerCard contents/layout shared for both projections with one distance text. Owner direct assignment authorizes header placement and simplified list composition. Venue markers are a bounded extension of the existing geographic marker family, visually distinguished with existing purple/surface tokens (STYLE_GUIDE_GAP: venue marker has no accessible frozen screen-specific specimen in this checkout). No other new pattern or OWNER_VISUAL_OVERRIDE. Frozen Make source and listed operations style guide are absent from this Clean checkout; visual parity needs independent browser review against #guide/#construction-kit.

## Evidence and limits

Executed: git diff --check; node --check browser scripts and pure type generator; node packages/contracts/scripts/generate-unified-types.mjs --write and verification; python3 scripts/check_foundation.py PASS. No dependency installation.

Added/adapted Vitest tests: API explicit preview flags and fail-closed matrix; web origin/registration gate; safe card parity/projection props; expired context recovery and cooldown/privacy. Browser script asserts header placement, absence from bottom and four tabs at mobile widths. These tests were NOT executed. TypeScript/build/Vitest/Playwright are NOT_TESTED. Browser legacy-fixture.mjs is absent; session-race requires the restored legacy fixture; its server status mock now confirms an active unified session. Map style/range runtime facts are Owner-provided, not independently measured by this producer. Full authenticated Radar acceptance: NOT_TESTED. REQUIRE_RADAR=1 remains strict; smoke script unchanged.

Risks: browser map renderer/tiles and PWA 320/390/430 layout need actual DEV authenticated canary; venue failure remains separate from participant/map failure. No source result is independent QA, release or acceptance.

Rollback: revert only this source diff against the exact base; no runtime effects to undo. Next bounded action: independent QA/build on authorized CI/canary, including enabled/disabled DEV and PROD fencing, live route recovery, consent/session invalidation, mobile tooltip and map tile errors. Do not deploy PROD.

## Changed files

- `apps/api/src/config/env.ts`
- `apps/api/src/radar/dev-map-preview.ts`
- `apps/api/src/radar/geographic.service.ts`
- `apps/api/src/radar/unified.service.ts`
- `apps/api/test/unit/radar-dev-map-preview.test.ts`
- `apps/web/src/components/consumer/RootNav.tsx`
- `apps/web/src/components/consumer/pages/PlayersDirectoryPage.tsx`
- `apps/web/src/components/consumer/players/ProfileComposition.tsx`
- `apps/web/src/components/consumer/radar/GeographicRadarMap.tsx`
- `apps/web/src/components/consumer/radar/RadarPage.tsx`
- `apps/web/src/components/consumer/radar/UnifiedPlayerCard.tsx`
- `apps/web/src/lib/radar-map-assets.ts`
- `apps/web/src/lib/unified-directory.ts`
- `apps/web/src/styles/foundation.css`
- `apps/web/src/styles/players.css`
- `apps/web/src/styles/radar-geographic.css`
- `apps/web/test/players-unified-controls.test.tsx`
- `apps/web/test/product-consumer.browser.mjs`
- `apps/web/test/session-race.browser.mjs`
- `apps/web/test/unified-directory.test.ts`
- `apps/web/test/unified-player-card.test.tsx`
- `docs/api/UNIFIED_PLAYERS_RADAR_V001.md`
- `docs/handoffs/2026-10-14_dev-players-radar-map-mobile-source.md`
- `packages/contracts/openapi.json`
- `packages/contracts/src/unified.generated.ts`
