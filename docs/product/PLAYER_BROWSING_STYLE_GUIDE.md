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

Superseded by the **Mobile fullscreen contract (Owner UAT repair)** appendix below for cards mode. Do not apply desktop v5 composition globally.

## Catalog & Radar boundary

- Deck reads the **ordinary public catalog** (`listPlayers`) only. No private Radar rows / `resultRef` in the deck.
- Existing Radar semantics, TTL, and privacy fences stay as on `/players`. Desktop compact strip must not auto-toggle or stop Radar.
- Filters, dedup by `publicPlayerId`, cursor pagination, and explicit «Загрузить ещё» / «Показать ещё» when the loaded page + cursor are exhausted — no eager multi-page scanning for the next candidate.
- Filter/scope change invalidates selection and local skips immediately so previous-scope rows/actions cannot flash.
- Self is excluded when the viewer’s own `publicPlayerId` is known. `canRequest=false` never sends.
- Guests may browse; friendship requires auth prompt. No auto-send after login.

## Interaction (shared)

- Side arrows and Left/Right on a deliberately focused deck: **browse only** (never friendship mutation). Desktop ≥1024: buttons only (no pointer swipe).
- Mobile only: Left swipe / «Пропустить»: local skip (no block/decline/unfriend). Right swipe or friendship CTA: existing friendship request handlers — see mobile appendix for 1:1 drag, fly-off, and confirmed-only right advance.
- Axis lock / distance-or-flick release / cancel / vertical details; interactive targets exclude drag. No request on partial drag, cancel, navigation, load, or pagination.
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

---

## Appendix · Mobile fullscreen contract (Owner UAT repair, #404)

**Implemented behaviour (author pass · NOT a QA PASS claim).** Desktop ≥1024 v5 / 406 prepared media / F1–F5 remain unchanged.

### Shell
- Cards mode on viewport `<1024` opens a **fixed fullscreen** portal (`role="dialog"`, `aria-modal`) covering app header / nav / footer, with safe-area insets.
- Chrome: small counter + place, help `?`, close **X** ≥44px top-right.
- Underlying directory is `inert` + `body` scroll locked; focus returns to the opener and list scroll restores on close.
- Close paths: **X**, **Escape**, **browser Back**. `pushState` only when entering from list; close uses `history.back()` or `replaceState` for direct `?view=cards` — no history growth loop.
- Resize/rotation to ≥1024 tears down the portal and shows desktop v5 inline; no Fullscreen API; no global shell / C5 / runtime changes.

### Card
- Full-viewport cover + avatar + **compact** identity. No fixed huge bio excerpt on the cover; details are a separate page covering the photo.
- Swipe **up** opens details; **down** returns to cover. Long bio/details page via up/down and accessible pager buttons — **no ordinary vertical scroll** inside the card.
- Friendship / pending UNKNOWN UI stays in a stable bottom slot across details open/close (not remounted).
- Minimal persistent **Пропустить** / **В друзья** buttons remain accessible alternatives. Actions must remain usable at 390×844 and 375×667 without horizontal overflow.
- One-time gesture hint (`gb-player-gallery-tutorial-v2`); help reopens. Existing real metadata only; games copy stays honest unavailable.

### Gestures
- Register only after the pending card is **media-ready**. Single active pointer; stable **pointer capture**; handlers use refs so the controller is not recreated mid-drag.
- `touch-action: none` on the fullscreen gesture surface only (not a global pinch hijack). Interactive targets (`button,a,…`, `[data-browse-no-drag]`) excluded. `pointercancel` / non-primary / multitouch / blur → **no mutation**, spring-back.
- Horizontal drag is **1:1** via RAF + CSS vars (`--pb-drag-x` / `--pb-drag-rot`) — **no 0.32 damping**. Slight rotation. Full-surface **red (left / skip)** and **green (right / request)** intent layers with label + icon (not colour alone). Green while touching is **intent**, not server PASS.
- Axis lock after 10px with 1.5× dominance. Release commits on distance threshold **or** same-direction flick above velocity with **minimum travel**; reverse / cancel / short travel springs back.
- Left commit: card flies off beyond card width, **then** advances to the next ready peer (no late snap-back of the old card).
- Right commit: existing explicit friendship `request` only (not a fake Match). Bind to the peer at gesture start; cancel if peer changes; no duplicate send on release+click. **Only confirmed receipt** may auto-advance and play the successful right fly-out; failed / UNKNOWN restores the card with honest status and **no automatic replay**. No new match API/schema.
