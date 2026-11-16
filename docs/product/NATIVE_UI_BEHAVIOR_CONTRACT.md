# Native UI behavior contract · H-01 / V-01 / V-02

Bounded #522 record. Authority order: Owner decision → `SITEWIDE_UI_STYLE_GUIDE.md` → `VENUE_GALLERY.md` → accepted web `VenuePopup` / `VenueGallery` / `RootNav` → native adapters. Route inventory is source-presence evidence, not finished-screen acceptance.

Status labels: **VERIFIED_SOURCE** (inspected code/docs), **GAP** (confirmed missing/different native behavior before this repair), **UNVERIFIED_DEVICE** (no emulator/device proof in this source step).

## H-01 · Shared header actions

| Field | Content |
| --- | --- |
| Authority | Web `RootNav.tsx` topbar actions + `foundation.css` mobile `gap: 8`; native `ui.tsx` Header + `theme.ts` `interaction` 48×48 |
| Entry | Ordinary screens with brand left; Radar then profile in one trailing group |
| Trigger | Layout only; Radar/profile keep independent press targets and existing callbacks |
| Expected | Fixed 8 logical-unit gap inside the trailing group; remaining width between brand and group; profile omitted on `/profile`; light/story custom `action` still works; Radar open does not auto-enable/publish |
| Accessibility | Named individual controls; no group-level accessible wrapper that hides children |
| Evidence | Scenario H1; screenshot `01-header` |
| Status | **VERIFIED_SOURCE** web grouped actions; native Header now groups Radar→profile (**was GAP** space-between across separate children); **UNVERIFIED_DEVICE** painted-circle spacing / large-font clip |

## V-01 · Venue sheet state and ownership

| Field | Content |
| --- | --- |
| Authority | Owner map-popup decision; web `VenuePopup.tsx` compact/handle thresholds; native `maps.ts` Back/close hierarchy |
| Entry | Games/Players map venue selection (no venue-route navigation merely to expand) |
| States | none → compact → expanded; expanded info/schedule; selected media owned above branches |
| Gestures | Compact UP expands with live height growth toward measured/available expanded (web VenuePopup); compact DOWN dismisses; expanded HANDLE DOWN collapses via translateY; expanded BODY keeps ScrollView. Axis lock 8dp; compact origin is touch-down even after delayed grant; dy≤−56 / dy≥64 with terminal release sample; handle half measured/available travel or ≥0.5 dp/ms (same native event clock; stale >100ms ignored). Follow-on tap suppress is gesture-local; control origins retire on press-out/cancel; gallery second finger irrevocably retires until new grant; retired generation ignores late release |
| Close hierarchy | Filter Back → expanded collapse → compact deselect → map exit; X expanded collapses, compact closes |
| Layout | One expanded body scroll; sticky Create only expanded verified venue; compact has no Create; safe bottom reserved once; compact overflow ScrollView without a new gallery strip below the settled row |
| Accessibility | Named expand/collapse/close; expanded state exposed; local Modal + obscured-background isolation when expanded; escape/Back; focus to handle on expand, compact control on collapse, and host `returnFocusRef` opener/fallback on final dismiss (unmount-safe rAF) |
| Evidence | Scenarios V1–V6 |
| Status | **VERIFIED_SOURCE** close/measurement owners; native responders + local Modal lifecycle (**was GAP** tap-only / entry-only focus); **UNVERIFIED_DEVICE** real touch/scroll/safe-area/TalkBack/keyboard |

## V-02 · Venue gallery axis and continuity

| Field | Content |
| --- | --- |
| Authority | `VENUE_GALLERY.md`; web `VenueGallery.tsx` axis lock 10 / commit 48 |
| Trigger | Horizontal swipe on gallery/compact image; expanded explicit previous/next ≥44dp + counter; compact accessible paging on the established image region (no extra strip below settled compact row) |
| Expected | Left→next / right→previous modulo wrap; zero/one image no pretend paging; horizontal never expands sheet or opens credits; vertical compact image yields sheet; expanded image vertical keeps body scroll; load/error/retry scoped to selected media identity |
| Continuity | Selected media survives compact↔expanded and info↔schedule; refresh keeps surviving URL/id; removed falls back to main/first; new venue/city does not inherit |
| Evidence | Scenario V7 |
| Status | **VERIFIED_SOURCE** web gallery; native controlled selection + swipe + media-identity errors (**was GAP** button-only local index); **UNVERIFIED_DEVICE** axis arbitration on device |

## Explicit non-claims

- Candidate APK URL/SHA remain NULL until Root binds a future build — unit/export success is not UI PASS.
- Emulator success is not Xiaomi success; Owner Xiaomi FAIL stays separate.
- This scope does not close full native parity for the rest of #522.
