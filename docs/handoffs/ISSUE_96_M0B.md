# Issue #96 — M0b source handoff

From: source author. To: independent QA / PM. Date: 2026-10-19.
Status: WORKING_DRAFT, UNVERIFIED; source-only, no device evidence or deployment.
Base: `0c61960868b85cf40b761d953c7ea1b7565ecda9`.
Exact base: https://github.com/anpavel84-afk/gobadminton-clean/commit/0c61960868b85cf40b761d953c7ea1b7565ecda9
Assignment: supplied immutable GOBADMINTON_AUTONOMY_V1 M0b, target DEV, issue 96.
Only allowed web source, tests and this handoff edited. No commit/push permitted;
therefore candidate permalink awaits authorized publication by the delivery system.

## Changes and proposed coverage

- C1: delayed WebGL fatal (4000 ms), restore cancellation and repaint, visible-tab repaint.
  Lifecycle tests cover restoration and expiry; existing warning/fatal and eight-second
  zero-tile tests remain. Nonfatal errors log kind/status/sanitized path and counters.
- C2: minute-changing clock, equal-content counts identity reuse, marker presentation
  cache, separation independent of counts, frame-coalesced size-change-only layout.
  Lifecycle tests cover equal counts and zero/unchanged/restored positive size;
  refresh test covers identity through 60 seconds. Viewport skips unchanged style writes.
- C3: same-city revalidation retains confirmed data; failed reload invalidates counts.
  Refresh tests cover focus, retained counts and failed reload; existing day/session
  pagination tests remain. No Map effect depends on polling or counts.
- C4: first venue failure retains an empty snapshot and renders the map plus error.
  Refresh regression covers this path. Discovery retains last resolved location during
  transient nulls. Same-city snapshot is never reset to null.
- Opt-in local ring buffer (200), live panel (last 60), clipboard with textarea fallback.
  Debug tests cover shape, limit, opt-in persistence, disabled output, sensitive detail
  rejection and panel visibility. No data is transmitted.

Coverage limits: no claim that all A2 transitions are independently exercised by a
single combined mounted Map/View harness; device visibility and clipboard behavior
also require browser QA. These are source tests, not executed evidence.

## Presentation authority

STYLE_GUIDE_GAP: temporary opt-in diagnostic overlay, requested explicitly by task;
fixed monospace scrollable panel above safe area, maximum 40vh. Referenced
`docs/operations/FRONTEND_STYLE_GUIDE_FIRST_V001.md` and
`docs/decisions/OWNER_DECISION_FRONTEND_STYLE_GUIDE_FIRST_V001.md` are absent in this
checkout. No consumer map composition redesign intended.

## Validation

- Tests: NOT_TESTED — source-author assignment explicitly prohibits self-QA.
- Lint: NOT_TESTED — same prohibition.
- Typecheck: NOT_TESTED — same prohibition.
- Build: NOT_TESTED — same prohibition.
- iPhone Safari: NOT_TESTED — no device evidence available in this source assignment.

MapLibre stays 6.13.0, with pmtiles and the existing Moscow bundle. Per task-provided
release note, 6.14.0 lists fixes for blank/unresponsive Safari maps and load/idle not
firing when the last tile fails. Upgrade is outside this slice. This change does not
claim a confirmed Safari fix.

## Device procedure and next bounded action

Independent QA: open https://dev.gobadminton.ru/games?view=map&mapdebug=1 after the
candidate is published through the authorized pipeline. Wait 30 seconds, pan/zoom,
background the tab for 10 seconds and return, press «Скопировать», send the log.
Success: one venue-map-mount, no venue-map-unmount, no fatal; tile-error/webgl-lost
entries should explain any blank basemap. Keep error card/retry, camera restore,
Radar shared instance, Moscow guard and M1e back capsule in regression scope.
Debug remains enabled for the tab via sessionStorage; «Закрыть» hides the panel.

Rollback: discard only this candidate's source changes through the authorized
review/publication process; no runtime or git metadata changes were made here.
Next action: independent QA executes web tests, lint, typecheck and build, then device
procedure, recording exact candidate SHA and evidence before any acceptance claim.
