# Native UI behavior contract · H-01 / V-01 / V-02 / V-03

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
| Gestures | Compact UP expands with live height growth toward measured/available expanded (web VenuePopup); compact DOWN dismisses; expanded HANDLE DOWN collapses via translateY; expanded BODY keeps ScrollView. Axis lock 8dp; compact origin is touch-down even after delayed grant; dy≤−56 / dy≥64 with terminal release sample; handle half measured/available travel or ≥0.5 dp/ms (same native event clock; stale >100ms ignored). Handle panHandlers live on a host `View` (not `Pressable` — RN Pressability overrides responder callbacks); ordinary tap/a11y activate remain on the Pressable child. Follow-on tap suppress is gesture-local; control origins retire on press-out/cancel; gallery second finger irrevocably retires until new grant; retired generation ignores late release |
| Close hierarchy | Filter Back → expanded collapse → compact deselect → map exit; X expanded collapses, compact closes |
| Layout | One expanded body scroll; sticky Create only expanded verified venue; compact has no Create; safe bottom reserved once; compact overflow ScrollView without a new gallery strip below the settled row |
| Accessibility | Named expand/collapse/close; expanded state exposed; local Modal + obscured-background isolation when expanded; escape/Back; focus to handle on expand, compact control on collapse, and host `returnFocusRef` opener/fallback on final dismiss via `createReturnFocusLifecycle` (intentional dismiss restore survives sheet unmount; obsolete nav/scope cancels) |
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

## V-03 · Venue ratings and comments (expanded only)

| Field | Content |
| --- | --- |
| Authority | Accepted web StyleGuide + existing native primitives; API venue-community public targets; Owner #522 / OD-017 carryforward |
| Entry | Expanded verified venue only — after contacts and schedule; compact preview has **no** UGC and keeps the current compact shape |
| Surfaces | Inline community rating summary/own vote + public comments/replies; report subject/reason/detail freeze; anonymous guest read; native bearer closed to venue-community public targets before lookup (never global private player/game enable) |
| Writes | Exact explicit review → commit; UNKNOWN retain frozen human context across venue switch/back and pagination omission; retry exact packet only; no GET-inferred success; refresh never sends or settles a write |
| Authority retirement | Explicit logout or actor/session/generation change removes private frozen text/report/context from root history; late ACK/error must not reinsert retired operations or repaint/reload for a new actor; same-id reentry does not resurrect retired context; no auto replay |
| Edits | Compatible collapse/schedule/cancel/reopen retains edit drafts; authoritative revision/deletion/private/permission or actor retirement clears incompatible edits; successful masked edit clears only its matching draft (photos preserved via existing photoIds) |
| Non-scope | Photos authoring and verified postgame reviews remain separate unfinished scope; no generic ShareExperience CTA; cookie/guest/CSRF/server moderation rights unchanged |
| Evidence | Scenarios V8–V10; mobile unit `venue-community` / auth community ports |
| Status | **VERIFIED_SOURCE** coordinator + expanded host seam + native venue principal opt-in; **UNVERIFIED_DEVICE** Owner UI / Xiaomi; code12 is TARGET SOURCE ONLY until genuine gates/build/delivery |

## P-01 · Own profile level / район-метро / О себе

| Field | Content |
| --- | --- |
| Authority | Accepted web `ProfilePage.tsx` editor fields + `LevelGuide` / `lib/level-guide.ts` identities; native `profile.ts` / `ProfileEditor` / existing Label·chip·sheet·keyboard patterns |
| Entry | Authenticated `/profile` existing «Игровой профиль» editor (name/city already present) |
| Trigger | Explicit level choice (Keep / Не знаю / pilot / ntrp half-step), район/метро ≤64, О себе ≤500; one Save / Cancel |
| Expected | Unknown scale/version preserved until explicit change; wire omits unchanged level/area/bio; explicit null clears; saving these fields does not mutate visibility/contact/consent/trainer/looking; frozen packet + exact retry; actor/session retirement unchanged |
| Accessibility | Labelled controls; multiline bio; level sheet uses existing DiscoverySheet focus return |
| Evidence | Scenario P1; mobile unit `profile.test.ts` |
| Status | **SOURCE_ONLY** implementation/source for this slice pending actual owning review, independent QA, and device gates; parse/selftest is not independent QA or device PASS; **UNVERIFIED_DEVICE** no current device/emulator PASS; photos/privacy/contactPolicy/linked identity remain unfinished |

## Explicit non-claims

- Candidate APK URL/SHA remain NULL until Root binds a future build — unit/export success is not UI PASS.
- Emulator success is not Xiaomi success; Owner Xiaomi FAIL stays separate.
- This scope does not close full native parity for the rest of #522.
- code12 publication receipt satisfied the conditional counter; code13 is planned source value only — not built/installed/device/public release; no full #522 / OTA / iOS PASS claim.
