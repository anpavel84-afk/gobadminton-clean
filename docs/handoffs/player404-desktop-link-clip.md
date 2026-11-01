# Handoff — #404 desktop two-line bio clips «Подробнее об игроке»

**Assignment:** OWNER_UAT_DESKTOP_TWO_LINE_BIO_DETAILS_LINK_CLIPPING
**Author:** cursor:auto · attempt 1 · base `ac163220782c719e0b872ada81ee11094c7b7646`
**App candidate:** `0.1.0-alpha.9` (no version bump) · API wire unchanged · UAT=NOT_TESTED
**Refs:** #404 · Owner UAT screenshot Andrew Titov desktop card · Style Guide `PLAYER_BROWSING_STYLE_GUIDE.md` (local copy)

## Cause

Desktop `.pb-card--desktop` keeps fixed `clamp` height; `.pb-copy` is a column with `.pb-identity { flex:1; overflow:hidden }` holding header/name/facts **and** `.pb-excerpt` (bio + «Подробнее об игроке»). With a two-line bio the detail link sat at the bottom of the clipped identity band and was cut off above the action footer.

## Fix (source only)

- Moved `.pb-excerpt` (bio preview + detail toggle) out of `.pb-identity` to a **flex-none** sibling above `.pb-profile-bottom`, so identity overflow can no longer clip the link.
- Desktop CSS: bio preview clamp **2** lines; reserved excerpt band; slightly tighter copy/identity/facts spacing (and short-height ≤800px tweaks); long names clamp to 2 lines inside identity. Card height, expand-details geometry, footer CTAs, media aspect, mobile unchanged. No business/request/prefetch/gesture changes.

## Paths changed

- `apps/web/src/components/consumer/players/PlayerBrowseDeck.tsx`
- `apps/web/src/styles/player-browse.css`
- `apps/web/src/lib/releases.ts` — one Russian fix bullet on CURRENT_NAMED_RELEASE alpha.9
- `docs/handoffs/player404-desktop-link-clip.md` (this file)

## Materials read

- Screenshot `1-Photo-1.jpg` (sha256 `0f91d4b3dee468eb9c338c59afb0ec7f21ef15e2ffcc019fda95a75faf4b7b9b`) — clipped green «Подробнее об игроке» under two-line bio on Andrey Titov card
- `PLAYER_BROWSING_STYLE_GUIDE.md` (sha256 `6ea61db3b90912a84afda6672f2545e3d1dd3e4ac3f60668949c6a6972583d61`) — desktop v5 fixed banner, short bio preview, actions stay visible

## Checks

- Native author sandbox: **no** `node_modules` / deps — typecheck/lint/unit **not run** (not fake PASS).
- Trusted PMA: existing browser fixture screenshots/bounds at 1440×900, 1366×768, 1024 desktop (two-line bio → full link above footer); mobile 390 unchanged; details still same fixed card.
- Remaining gates: independent QA → Product CI → DEV release/smoke → Owner UAT=NOT_TESTED. Source edit ≠ DEV ACCEPTED.

## Explicit non-claims

- No #450 name-code changes. No PROD/runtime/network/architecture. No new tests/matrix. Candidate unpublished; combines compatible #450 public-name fix already on branch + this UAT repair.
