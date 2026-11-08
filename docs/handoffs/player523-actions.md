# Handoff — #523 desktop action alignment + alpha.56 history carry

**Assignment:** `OWNER523_DESKTOP_ACTION_ALIGNMENT_AND_ALPHA56_HISTORY_CARRY`
**Author:** cursor:auto · attempt 1 · base `ed7835941ecf3f49e9374eff35f38fe6fde88c53`
**App candidate:** `0.1.0-alpha.57` · API wire unchanged `0.39.0` · `source_sha` null · Owner UAT **NOT_TESTED**
**Refs:** #523 · #521 (combined UI release 57) · Owner screenshot `owner523-reference.png`
**Scope:** source only · single writer · #507 WT preserved separate · no Git/push/deploy/PROD

## Problem (Owner screenshot)

On `/players?view=cards` desktop, «Следующий» was taller than lime «Давай сыграем» because `.pb-profile-actions` used `align-items: stretch` while the primary slot contained `StableActionFooter` (reserved status line + button). Next stretched to status+button height.

## Fix

- Desktop `.pb-profile-actions` → CSS grid: status `row1/col1`, primary + Next share `row2` equal top/bottom/height (Style Guide **48** desktop).
- `display: contents` on `.pb-friend-slot` / `.pb-action-slot--desktop` so status does not enlarge Next alone.
- Caption stays outside the button row.
- Shared presentational `DesktopBrowseActionsShell` + `DesktopBrowseActionsFixture` (no handler/API changes). Deck uses the shell; mobile 390 fullscreen/gesture path untouched (52px mobile actions preserved).
- No Card CSS / identity / state-machine / send/skip/UNKNOWN/busy logic changes.

## Version history

- Appended trusted alpha.56 seed exactly (`source_sha` `52408876…`, API `0.39.0`, DEV ACCEPTED receipt `r42465159954-a1` / `2026-11-08T09:11:48Z`, Owner UAT NOT_TESTED) → seed length **60**, deployments **65**.
- CURRENT 57 notes: #521 trainer card + #523 action alignment only. No #507 / API.40 / fake 57 acceptance.

## Checks

- Unit: `player-browse-actions-layout.test.tsx` + unchanged play-interest + releases tests.
- Browser helper: `player-browse-actions-layout.browser.mjs` (521 CDP pattern, own profile/PID/cleanup, no Playwright/deps). Viewports 1280/1920 + natural 390. Chromium path may be absent in author sandbox → honest **NOT_TESTED**; parent executes. Signed-in send **NOT_TESTED**.
- Remaining: parent real browser → independent Sol Medium QA of #521+#523 → CI → guarded DEV. No self DEV claim.

## Paths (allowed)

- `apps/web/src/styles/player-browse.css`
- `apps/web/src/components/consumer/players/PlayerBrowseDeck.tsx`
- `apps/web/src/components/consumer/players/PlayerBrowsePlayInterest.tsx`
- `apps/web/test/player-browse-actions-layout.test.tsx`
- `apps/web/test/player-browse-actions-layout.browser.mjs`
- `apps/web/test/player-browse-play-interest.test.tsx` (unchanged contract)
- `apps/web/src/lib/releases.ts`
- `apps/web/test/releases.test.tsx`
- `apps/web/test/releases-server.test.ts`
- `docs/handoffs/game521-training-card.md` (pointer)
- `docs/handoffs/player523-actions.md`

## Explicit non-claims

- No DEV/PROD ACCEPTED, no #507 published claims, no C5, no Mode B binding proof, no invented costs/UNKNOWN wipe.
