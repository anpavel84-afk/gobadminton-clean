# Desktop overlays · Style Guide extension v1.0

**OWNER_APPROVED · 28.10.2026 · Astra High design; Owner selected «Просторный40»**

Accepted Owner decision: «Утверждаю “Просторный40”».  
Authority: https://github.com/anpavel84-afk/gobadminton-clean/issues/365#issuecomment-6481017808  
Provenance (immutable proposal copy): https://files.anpavel.ru/projects/gobadminton/design/style-guide/desktop-overlays/20261028-astra-v1/index.html · https://files.anpavel.ru/projects/gobadminton/design/style-guide/desktop-overlays/20261028-astra-v1/DESKTOP_OVERLAY_STYLE_GUIDE_PROPOSED.md

Primary accepted system: **«Просторный 40»** — единая левая линия содержимого 40 px, отдельная читаемая шапка, X в 24 px от верхнего и правого края shell. Alternate **normal 32 px** was not chosen. Documented functional **small / popover** exceptions stay. Frozen Style Guide source and Figma.site are unchanged by this document.

## Основание и пределы

- Extension applies to desktop **from 1024 CSS px**. Mobile, gestures, mobile X, ordinary page `PublicPlayerProfile`, rights/data/API and UNKNOWN rules stay as before.
- Accepted #370 compact game / real cover / ordinary+trainer composition is retained.
- This is a versioned product Style Guide extension for desktop overlay families. Not a new modal engine, framework, or global process rule.

## Ограниченный реестр фактических семейств

| Семейство | Source | Применение |
|---|---|---|
| Карта: venue info, schedule, game, create | `games/{DesktopMapInspector,VenuePopup,VenueSheet,DesktopInspectorGame}.tsx`, `pages/CreateGamePage.tsx` | 450 view / 640 create; 400/520 at 1024–1279 |
| Radar player | `radar/UnifiedPlayerPreview.tsx`, `players/PublicPlayerProfile.tsx` | Same inspector chrome; reuse PublicPlayerProfile body |
| Radar list | `radar/{GeographicRadarMap,RadarPage}.tsx` | List surface width 360; shared X/header without forcing 450 |
| ProfileDialog (auth/share/report/messages) | `players/ProfileComposition.tsx` + callers | Normal 560; small 400 where already used; inherit skin |
| Venue picker | `games/VenuePickerDialog.tsx` | 680; header+search outside list scroll |
| Map filters | `games/MapLayerFilters.tsx` | 480; header/footer + one body scroll |
| Context Radar popover | `radar/RadarSessionProvider.tsx` | 280; padding 18; not turned into a window |

## Канонические параметры «Просторный40»

| Параметр | Contract |
|---|---|
| Content inset | **40 px** header/body/footer for normal/view/wide; **32 px** for 400 small; **18 px** for 280 popover |
| X | Existing 44×44 CloseButton, glyph 24; **top/right 24 px from shell** (not nested content) |
| Header | White; top 24, bottom 16. First row min 44: Back/kicker + independent X. Gap 8; title below. Title 22/26, 700 (small 20/26) |
| Body | Top 16, section gap 16, bottom 16; `min-height:0`; **one** vertical scroll owner |
| Footer | White, 1 px line; top 12, bottom 16; inset matches body; actions min 44/48 |
| Surface | Radius 28, inner cards 18, fields 12, elevated shadow |
| Widths | View 450 / create 640 (≥1280); 400/520 (1024–1279); normal 560; small 400; filters 480; picker 680; Radar list 360; popover 280 |
| Height | Inspector top/bottom/right 20 vs map viewport; modal `max-height: calc(100dvh - 48px)` |

### Шапка, Back и X

1. Control row occupies the top chrome; X aligns to shell top/right 24, never to title/avatar/media.
2. Back is an independent row (≥44 high); reserve X + 12 gap on the right for Back text.
3. Title starts below the control row and may use full body width.
4. Header/footer are shell rows; body is the only scroll. No nested `overflow:auto` inside PublicPlayerProfile or game body.
5. Picker search stays in the upper chrome; the list remains the sole scroll owner.

### Ритм контента

- Venue: one 40 px content line for title, cover, address, contacts, empty/schedule. Real cover preferred; 16:9, max 200 high.
- Game: keep **88×88** GameCover and date badge; organizer, trainer + «Самостоятельно указано», seats, address, settlement, rental note, description. Facts labels **96 px** when needed for the 40 px gutter budget.
- Player: reuse PublicPlayerProfile; remove only duplicated **outer** desktop host padding; keep hero/card semantic padding.
- Regular and actual trainer **72-char** description must fit 1440×900 / 1920×900 with both actions and without vertical scroll; 1366 / long text / font-scale → one body scroll with reachable actions.
- No hidden mandatory fields, tiny fonts, or double-scroll.

### Состояния

Loading/empty/error/denied/busy/UNKNOWN preserve existing caller contracts. Visual unification does not change Escape/backdrop/history/focus/form-association/busy guards. Context popovers and native OS menus are not new windows.

## Implementation note

Shared presentational chrome: `DesktopOverlayHeader` + `desktop-overlays.css`, applied through existing `ProfileDialog` / `CloseButton` / inspector / picker / filter families. No new modal engine, provider, or controller.
