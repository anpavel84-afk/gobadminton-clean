# Игроки по одному · Style Guide (#404)

**OWNER_APPROVED · 30.10.2026 · desktop v5**

Authority: Owner chat 30 Oct 2026 («так и оставляем» v5 + visible directional slide); Issue #404.
Approved visual / brief: Owner-approved **desktop v5** package (HTML/CSS/JS mock, proposal, desktop PNG, details PNG).

This document records product contracts for the integrated consumer surface. Do **not** copy full mock personas, gallery JS, scenario selectors, demo banners, placeholder preferences, or fake games into the app.

**Supersedes desktop v2 rules only.** Mobile contracts, friendship/Radar/privacy fences, and ordinary-catalog data honesty from prior accepted #404 work remain in force unless explicitly replaced below.

## Desktop ≥1024 (v5)

- Same main `h1` typography/position and one persistent control strip on **both** list and cards: city, search by name, Filters, compact Radar. No second filter row, no giant Radar band, no tools `<details>` accordion.
- Extra filters (area / looking / trainer) live in a Filters popover: labelled title, close, Escape, `aria-expanded`, focus return. No unsupported API-level filter. Mode switch must not reset controls or remount duplicate Radar handlers.
- Remove the duplicate Moscow / All-players line above the card. Counter may stay inside the banner. A short honest Radar privacy/state line is allowed; no large empty status box. Do **not** show the DEV synthetic-location label on this desktop directory (`RadarStatusControls` `presentation="directory-compact"`); keep permission/error/recovery/consent. Do not change backend gates/location behavior or hide diagnostic labels on other views.
- Deck: photograph **LEFT ~44%**, identity/actions **RIGHT**, circular avatar inside cover. One stable outer banner rectangle for normal and details; fixed geometry from the viewport (`clamp` height). Details replaces the photo with full-width identity + actual info; return via «К карточке» / Escape. No height/width/page jump; no internal vertical scrolling in the banner.
- Base card shows a short bio preview. Expanded state must not silently drop the full actual bio: if content cannot fit (long bio / zoom), use same-size details pages with an accessible «Ещё» control — do not clip away info or grow the container. Minimal paging only; no generic pagination framework.
- Actions stay visible. Reuse actual profile fields and the honest unavailable-games note + public profile link. No mock preference / rating / nearby facts.
- Desktop: **no** pointer swipe/drag mutations and **no** swipe tutorial. Explicit «Добавить в друзья» and «Следующий» plus side arrows. Arrows / Next are **browse-only**.
- Directional horizontal slide **200–280ms** on next/prev: stationary outer frame/header/toolbar; animate content inside a clipped stationary frame; direction follows navigation. No automatic browsing timers. No duplicate mounted friendship controls or concurrent actions. `prefers-reduced-motion` → instant. Rapid clicks, scope/filter/auth change, or unmount cancel obsolete animation. Initial load and details toggle must **not** trigger the player-change slide. Never delay/update wrong-peer mutation callbacks; preserve pending/UNKNOWN and existing capabilities.

## Mobile <1024

- Keep existing swipe / tutorial / fixed action bar and existing card layout. Do not apply desktop v5 composition globally.

## Catalog & Radar boundary

- Deck reads the **ordinary public catalog** (`listPlayers`) only. No private Radar rows / `resultRef` in the deck.
- Existing Radar semantics, TTL, and privacy fences stay as on `/players`. Desktop compact strip must not auto-toggle or stop Radar.
- Filters, dedup by `publicPlayerId`, cursor pagination, and explicit «Загрузить ещё» / «Показать ещё» when the loaded page + cursor are exhausted — no eager multi-page scanning for the next candidate.
- Filter/scope change invalidates selection and local skips immediately so previous-scope rows/actions cannot flash.
- Self is excluded when the viewer’s own `publicPlayerId` is known. `canRequest=false` never sends.
- Guests may browse; friendship requires auth prompt. No auto-send after login.

## Interaction (shared)

- Side arrows and Left/Right on a deliberately focused deck: **browse only** (never friendship mutation).
- Mobile only: Left swipe / «Пропустить»: local skip (no block/decline/unfriend). Right swipe or friendship CTA: request via the same handlers.
- Threshold / direction / cancel / vertical pan / pinch; interactive and details targets exclude drag. No request on partial drag, cancel, navigation, load, or pagination.
- After **confirmed** receipt: short toast + auto-next eligible candidate (instant index — not the desktop browse slide). Busy / UNKNOWN must not fake success.
- Previous restores preserved relationship; no repeated request. Position within the loaded public scope uses browser history state (no new storage engine). Filter change resets selection/skip.
- No mutations on mouseenter or keyboard browse navigation.

## Onboarding (mobile)

- First open: short overlay on the card (gestures). Dismiss via «Понятно» / X / Escape. No auto-timer.
- Per-version boolean `gb-player-gallery-tutorial-v2=1` in `sessionStorage` (memory fallback). Discreet «?» reopens. No persistent instruction banner.
- Background card inert while tutorial; focus return; controls ≥44px; honor reduced motion / safe area.
- Desktop does not show this swipe tutorial.

## Friendships

- Reuse `friendCommand`, server capabilities/states, `useSocialMutation`, and pending scope `${me.id}:friends:${peerId}` (same as `FriendActions`). Do not clear that pending key on skip/filter/unmount/reload. Do not change shared `useSocialMutation` or unified-directory sources for this follow-up.
- Key per-peer action UI by current auth user + peer. Refresh caps/state on foreground/session change; retire private UI on `gb-private-expired` / `gb-session-changed`.
- Confirm `receipt.outcome` (`pending` is not `friends` unless accepted). Stale 409 → reload state. 429 → honor Retry-After with one stable deadline timer that clears at expiry; no invented visible countdown or auto POST retry; parent rate-limit callback must stay identity-stable.
- UNKNOWN: «Проверить статус» is **GET** `getFriendState` only — never `mutation.retry()` / default MutationNotice POST replay on the deck. Ignore retired readonly/status results after generation, peer, or auth scope change.
- Incoming decisions only via explicit `canAccept` / `canDecline`. No silent right-swipe accept. Do not disclose blocked reason.

## Data honesty

Public list/detail DTO: name, city, area, self-declared level, bio, cover/avatar when present. **Do not invent** star ratings, reviews, exact distance, or upcoming games. Ordinary public API does not provide games — show concise unavailable copy + link to the public profile. Cover may be omitted on list DTO: `getPlayer` on demand for the current id; ignore stale/unmounted/scope/auth-generation responses.

## Sitewide link

See also [SITEWIDE_UI_STYLE_GUIDE.md](./SITEWIDE_UI_STYLE_GUIDE.md) for shared shell/rail rules. Player-browsing deck visuals are governed here (#404 desktop v5), not by rejected feed-card proposals.
