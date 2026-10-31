# Sitewide UI · Style Guide (#394)

**OWNER_APPROVED · 29.10.2026 · published v3 (`20261029-owner-v3`)**

Authority: Owner chat 29 Oct 2026; Issue #394.
Approved visual: published gallery revision **v3** (`20261029-owner-v3`).
Original Owner screenshot inputs (private design attachments, not published here): player header; game recommend action; game chat action; home map CTA; player outgoing-request alignment.

This document records accepted **sitewide page composition** rules for the consumer product. It does **not** replace [DESKTOP_OVERLAY_STYLE_GUIDE.md](./DESKTOP_OVERLAY_STYLE_GUIDE.md) («Просторный40» overlays). Overlay contracts stay authoritative for desktop overlays from 1024 px.

Final designer brief/guide (`STYLE_GUIDE_FINAL.md` / `IMPLEMENTATION_BRIEF.md`) are technical aids only. Where they conflict with approved v3 or explicit Owner constraints, **v3 and Owner constraints win**. Do not silently apply unpublished hero/header designs.

## Product before infrastructure

Preserve Onest, existing palette, buttons, cards, ContentContainer / SectionHeader / SurfacePanel, shell, footer, Spacious40 overlays, mobile sheets/gestures/history/focus. No new tokens, frameworks, dependencies, routes, API, auth logic, copywriting, legal text, or wholesale stylesheet replacement.

## Shared left rail

On ordinary consumer pages, **Back** and the page **H1** (when present) start on the same left line as the logo and primary content. Use the existing shell gutter / `--gb-content-max`; do not introduce a second independently centered outer container.

| Rule | Contract |
|---|---|
| Shell → content | 32 desktop / 20 mobile |
| Page header → next block | 28 desktop / 24 mobile |
| Back | min-height ≥ 44; gap before title 16 desktop / 12 mobile |
| Narrow forms | Limit **inner body** only (≈760–880); outer Back/H1 stay full rail |
| Utility examples | Login methods, sessions, settings, setup, trainer edit, location, legal |

Shared presentational class: `.gb-page-local-header` (+ optional `.utility-page__body` for narrow content).

## Five Owner defect bindings

1. **Profile / Back** — separate page header before hero; predictable gap; long names wrap; empty bio does not leave an empty block.
2. **Game / recommend & share** — Back alone above hero; existing recommendation/share in one contextual group **after** `GameHero` (approved v3); participation stays in the single `GameActionBar`; recommendation keeps capability/friend gate; share is not invite/recommend.
3. **Game chat** — separate section after participation terms; spacing 24 desktop / 20 mobile; only under the existing active-chat result of `getGameChat` (confirmed alone does not grant chat).
4. **Map CTA** — floating «Все игры на карте» over the **feed** column (desktop sticky; mobile retains above-nav / visualViewport / safe-area behavior). Sidebar map preview is **one** keyboard-accessible button with the same `onMap` path and city/day/activity; no duplicate button beneath the map; no nested interactive controls inside the preview decoration. CTA must not obscure last card, pagination, focused control, or footer; reuse existing scroll/pages/popstate restoration.
5. **Contact status/actions** — one flex row (`align-items: center`, `gap: 16`, wrap); no outer `p` margin; desktop status/action min-height 48; explanation once below via `ContactNote`. Contact and friendship remain separate contracts; privacy/auth/error/UNKNOWN unchanged.

## Discovery feed — hard boundary

**Keep** existing feed DOM, typography, hierarchy, data, title link, trainer, Details, Share. Proposed alternate feed card designs are **rejected**.

Scoped media change only for discovery feed cards at desktop/tablet:

- media column fills the card row to the bottom with `object-fit: cover` (no white gap under the photo);
- **max-square** media (~280–300): width must not become a portrait column relative to height;
- when content growth / available width would force a portrait media column, the **whole card** switches to stacked media+content (not `align-self: start` on an independent square, and not stretch-only height that creates portrait);
- **stable fallback latch**: once a card stacks for the current content identity and card width, keep stacked until width or content identity changes meaningfully; do not unstack merely because stacked content became shorter than the row media budget (hysteresis alone is not sufficient);
- observe the actual media budget from card width where possible; no hidden duplicate DOM, no `overflow-x: hidden` mask, no global Observer framework;
- mobile landscape geometry **unchanged** (product ~210 px height).

Layout widths:

- **721–1199**: feed full width; sidebar below (supporting panels side-by-side when space allows);
- **≥1200**: sidebar to the right.
- **≤720**: mobile landscape media / sidebar hide unchanged.

Ordinary pages keep Back/H1 on the shell left rail; narrow forms/lists use ≈880 body; legal reading measure ≈820 with compact H1≈42, status badge, and bordered TOC panel. Footer is brand + product + service + documents/operator with compact ≈40 padding on the shared content rail.

Do not apply the feed media rule to `GameCover` hero/personal cards, venue schedule, or map inspector.

## Player browsing (#404)

Ordinary `/players` may switch **По одному / Списком**. Owner-approved deck composition, gestures, and friendship/Radar boundaries are recorded in [PLAYER_BROWSING_STYLE_GUIDE.md](./PLAYER_BROWSING_STYLE_GUIDE.md) (published v2, 30.10.2026). Do not apply feed-card media rules or gallery mock JS to that deck.

## Overlays

Accepted Spacious40 overlay foundations, mobile sheets, gestures, history, and focus remain. Local overlay titles stay inside overlay inset; do not promote them to page headers or invent extra Back actions.

## Invitation dialog + create date/time (#424)

Opt-in ProfileDialog family `.profile-dialog--invitation` (no `.fr3`/`.fr4` page wrapper required). One title «Пригласить на игру»; body hint «Приглашение не резервирует место.»; shared `.gb-invitation-card` for preferred and normal chooser with real title/time/timezone and full-width «Отправить приглашение» CTA (same `invite(g)`, no auto-send/confirm step). Desktop ≥1024: shell 560 / inset 40 / X 44@24; mobile ≤720: bottom sheet radius 28 / inset 20 / safe-area; single body scroll. Create form date/time: scoped `minmax(0,1fr)` intrinsic sizing, 16px native inputs, optional WebKit value normalization; keep native pickers/required/readOnly/timezone — no `overflow:hidden` clipping.

## Messages composition (#394 desktop repair)

Owner-ordered desktop messenger repair (UAT followup): two-pane host on the existing shell rail (`336px` inbox ≥901, `320px` at 721–900); shared 88px pane-header baseline; single-row native filter select (`all` / `unread` / `attention`) instead of wrapping pills or rubricator headers; pending request as directional first message in the scroll body with compact status/decision footer outside scroll; independent inbox-list and conversation-body scroll. Dialogs keep Spacious40; mobile focused host, Back, RootNav, and keyboard/safe-area behavior stay as today (one nav reserve). No new tokens.

## Out of scope

Backend/API/migrations, new features, feed rewrite, gallery JS/synthetic data in the app, PROD deploy, mass cleanup migration to `main`.
