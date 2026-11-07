# #406 / #506 pass 13 — legacy venue access + map fixture repair

- From: source author (Cursor Auto), ExactEA57ae95 ProductCI42391764765
- To: parent host — rerun exactly the 2 affected unit files + types/lint;
  independent delta QA of changed facts; full CI again after current run finishes
- Date: 2026-11-07
- Status: WORKING_DRAFT / READY_FOR_PARENT_RERUN. Not ACCEPTED, not
  independent QA PASS, not CI, not DEV release, not Owner UAT.
- Assignment: `OWNER406_PRODUCT_CI_LEGACY_VENUE_ACCESS_MAP_FIXTURES`,
  attempt 13, base `ea57ae95e33765f2b6361abf9efe89a5d4bdf1f7`
- Git writes / live runtime / DB / provider / credentials / deploy / installs
  beyond local deps for checks: not performed (forbidden in this source slice)
- Allowed paths only: 2 test files + optional 3 media/map files + this handoff.
  Production media/map sources left unchanged (fixture-only repair).

## Independent inputs actually read

- `ci-42391764765-web-clean.log` (sha256
  `1c1b159fcc3dbf18677e653774beb8571447fef5999ec63daf3b6cd170b98545`):
  157 files / 155 PASS / 2 FAIL; 1566 tests / 1558 PASS / 8 FAIL.
  Failures only in `venue-public-access.test.tsx` (5) and
  `venue-sheet-integration.test.tsx` (3).

## Precise code vs fixture finding

### 1) `venue-public-access` — **fixture stale** (source correct)

- CI received pending gallery text `Загружаем фотографию…` with uploaded img
  present; credit (`Автор фото` / `Фото: Клуб`) appears only after
  `settleAfterGalleryImgLoad` (matches `VenueGallery` `imageReady` gate).
- Five assertions still required old «Иллюстрация» before load — that label is
  no longer shown for pending/ready attributed covers (and is not invented for
  pending/failed media).
- Venue `b` (null cover): source renders neutral
  `Фотографии площадки пока нет`; stale `data-cover="default"` assert removed.
- Repair: assert pending caption + no ready credit / no «Иллюстрация» before
  load; no-photo empty copy for venue b; keep post-load credit text; retain all
  guest/member read-only effect checks and strict safe/unsafe/overlong credit
  URL link assertions.
- No production file change.

### 2) `venue-sheet-integration` — **fixture stale** (source correct)

- After `sheetClick("Вечерняя игра")`, `renderToStaticMarkup(sheetTree)` was
  `''` because SSR of schedule/game rows ran real `GameCover`→`VenueCover`
  (and `Avatar`) hooks against the **shared parent hook-array**, overwriting
  selection/expanded slots; visit then cleared the sheet (`sheetTree = null`).
- Same class of isolation already documented for `VenueGallery` /
  `RoleReputationPanel` in this harness. Media pending/retry hooks made the
  pollution fatal; not a Moscow-map / idle-poll / privacy production regression.
- Causal proof: failures only at game-row SSR path; map instance persistence /
  no idle poll / refresh assertions never reached; `GamesMapView` /
  `SelectedVenueCover` / `VenueGallery` production sources unchanged.
- Repair: stub `GameCover` + `Avatar` like existing gallery isolation mocks.
  All existing map/instance/idle/games/venues/reject/privacy assertions kept.
  No `GamesMapView` whole-stub, no deleted asserts, no gate reset.

## Exact edits (this pass)

1. `apps/web/test/venue-public-access.test.tsx` — pending vs ready credit
   presentation; URL cases unchanged after simulated load.
2. `apps/web/test/venue-sheet-integration.test.tsx` — GameCover + Avatar
   harness isolation mocks.
3. This handoff — truthful pass-13 status only.

Production allowed paths **not** modified:
`GamesMapView.tsx`, `SelectedVenueCover.tsx`, `VenueGallery.tsx`.

## Checks

| Check | Result |
| --- | --- |
| CI log 42391764765 read | DONE |
| Stale «Иллюстрация» → pending/ready assertions | DONE (source) |
| Sheet empty-string = hook pollution (not prod map bug) | DONE (source) |
| Targeted unit tests (2 files) | PASS — author: 20/20 |
| types / lint (web) | PASS — author `tsc --noEmit` + `eslint .` |
| Independent delta QA / full Product CI / DEV | NOT_TESTED — pending parent |
| Owner UAT | NOT_TESTED — do not claim PASS/DONE |

## NOT_TESTED / limits

- Parent reruns the 2 files + types/lint, then independent delta QA and full CI
  after the in-flight Product CI finishes; do not interrupt receiver/database.
- DEV release / Owner UAT / PROD: NOT_TESTED — not claimed.
- Other #506 API/metadata / #507: untouched.
- Prior attempts/FAIL/UNKNOWN and costs retained; no paid whole-suite replay.
- Mode B binding / AGY READY: not claimed.
