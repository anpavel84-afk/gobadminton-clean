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

Superseded by the **Mobile fullscreen contract** appendix below for cards mode. Do not apply desktop v5 composition globally.

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

## Loading geometry & media window (#404 Owner UAT)

- **Stable page header from first visible frame:** server-parsed `view` (`initialBrowseView`) + viewport CSS (≥1024 → fixed 116px desktop hero with subtitle; mobile cards → compact without waiting for JS `data-directory-desktop`). Do not open mobile fullscreen portal until the desktop MQ is known (no desktop flash). Preserve route/history/back/X/focus and list defaults.
- **Tinder four-ahead prepare:** `browseMediaNeighborhood` = previous + current + next 4 (max 6), deduped; prep priority current → ahead → previous. Exact retained decoded pixels; existing cache keys, identity/CSRF/session/generation fences, 5s deadline, eviction. Radar pin `RADAR_PIN_MEDIA_CAP=4` / admission / selected-retain stays independent — do not change.
- Gesture parameters and design tokens above remain authoritative; no new policy bundle. Friendship POS copy stays honest until a separate Owner match-contract task.

## Sitewide link

See also [SITEWIDE_UI_STYLE_GUIDE.md](./SITEWIDE_UI_STYLE_GUIDE.md) for shared shell/rail rules. Player-browsing deck visuals are governed here (#404 desktop v5), not by rejected feed-card proposals.

---

## Appendix · Mobile fullscreen contract (Owner UAT repair, #404)

**Implemented behaviour (author pass · NOT a QA PASS claim).** Desktop ≥1024 v5 / 406 prepared media / F1–F5 remain unchanged.
Source-backed mechanics reference: Astra High deep gesture study (Owner); numbers below are **OUR** measured tuning labels in `player-browse.ts`, not Tinder private constants.

### Shell
- Cards mode on viewport `<1024` opens a **native `<dialog>` portal** with `showModal()` (focus containment + top layer), covering app header / nav / footer, with safe-area insets and exact fullscreen CSS reset (`margin/border/padding/max-width` cleared).
- Chrome: small counter + place, help `?`, close **X** ≥44px top-right. Same chrome wraps early catalog states (loading / unavailable / error / empty) so **X** works with no API / zero items; native parent `<dialog>` unchanged.
- Underlying directory is `inert` + `body` scroll locked; focus returns to the opener and list scroll restores on close.
- Close paths: **X**, **Escape** (`cancel` → same close), **browser Back**. `pushState` only when entering from list; close uses `history.back()` or `replaceState` for direct `?view=cards` — no history growth loop. Unmount / resize-to-desktop closes the dialog **without** calling the history close path again.
- Nested auth `ProfileDialog` (`<dialog>.showModal`) remains a separate top layer; safe with the browse shell.
- Resize/rotation to ≥1024 tears down the portal and shows desktop v5 inline; no Fullscreen API; no global shell / C5 / runtime changes.

### Card
- Full-viewport cover + avatar + **compact** identity. No fixed huge bio excerpt on the cover; details are a separate page covering the photo.
- **Single retained avatar host**: mount `PreparedBrowseAvatar` on cover **or** details, never both — a second host steals the same `HTMLImageElement`. Friendship controls stay in the stable bottom slot (not remounted / not cloned).
- Avatar render (portal-safe): `.pb-avatar` / `.pb-details-avatar` hosts clip to a circle (`overflow: clip`, `border-radius: 50%`); **descendant** `img` (not only direct-child) uses `width/height: 100%`, `object-fit: cover`, `border-radius: inherit`. Do not rely on `.fr3 .avatar > img` — the mobile `<dialog>` portal drops `.fr3`, and `RetainedBrowseImage` wraps with `display: contents`.
- Swipe **up** opens details; **down** on details text/background returns to cover / previous **mobile info page**. `data-browse-no-drag` only on actual buttons/links/pager — **not** on the whole `.pb-mobile-details` surface. Closed details stay mounted with `inert` + `aria-hidden`; while details are open, cover/identity controls are inert (not tabbable). One retained avatar host and stable friendship slot unchanged.
- **Fixed mobile information pages** (not one packed scroll of facts+bio+games): (1) facts/overview, (2) about-bio page(s) height-fit via existing `chunkBrowseBio` / measure helpers, (3) games notice + public profile link. Up advances page; down previous; down from the first page returns to cover. Accessible «К обложке» / «Назад» / «Ещё сведения» stay **outside** the clipped body so they are never below the fold. Desktop `detailsPage` bio pager is separate — do not change desktop v5 details paging.
- Bio chunks must fit the available about-page height at 375×667 and 390×844 (including font zoom): **no** full-text cutoff, **no** ordinary nested scroll, **no** `-webkit-line-clamp` clipping of lossless bio. Recompute on viewport/text-size changes. Do not invent a generic pagination framework.
- Minimal persistent **Пропустить** / **В друзья** buttons remain accessible alternatives. Whole card height stays fixed; X/actions always available at 390×844 and 375×667 without horizontal overflow.
- Last card left must settle to a visible honest end / «Загрузить ещё» terminal (`pb-deck-end--fs`), not leave only a flown-off card forever.
- One-time gesture hint (`gb-player-gallery-tutorial-v2`); help reopens. Existing real metadata only; games copy stays honest unavailable.

### Gestures · OUR tuning (`player-browse.ts`)
- Register only after the pending card is **media-ready**. Single active pointer; stable **pointer capture**; handlers use refs so the controller is not recreated mid-drag. Second contact cancels **before** primary/interactive exclusions (document capture while drag active, including outside the gesture surface); never adopts the secondary pointer; close/help still receive the event; cancel / late primary release → zero POST/skip.
- `touch-action: pinch-zoom` on the gesture surface (app owns pans; browser keeps pinch). Interactive targets (`button,a,…`, `[data-browse-no-drag]`) excluded. `pointercancel` / non-primary / multitouch / blur / unmount / auth / scope / breakpoint → **no mutation**, cancel timers, spring-back. Flight completion and skip/advance are fenced with captured `flyGen` **and** `viewerGen` (auth expiry/session bumps both synchronously).
- Horizontal drag is **1:1** via RAF + CSS transform from release pose — **no damping**. Grab-pivot `transform-origin` at pointerdown; rotation bounded `±12°` (`browseDragRotationDeg`), not unbounded `dx/28`. Full-surface **red (left / skip)** and **green (right / request)** saturating intent layers (smoothstep). Green while touching is **intent**, not server PASS.
- Axis lock after **8px** with **1.3×** dominance.
- Recent velocity: last **80ms** window including the release sample; **0** after ~100ms pause; capped ±2.5 px/ms (`sampleBrowseVelocity`).
- Release (`releaseCommitted`): **reverse veto first** (≈10px reverse travel + opposite velocity ≥0.2 px/ms) even past distance — then **slow-distance** `D=clamp(72,.24W,112)` **or** short-fast projected flick `F=clamp(18,.06W,28)`, `|vx|≥0.65`, `p=travel+|vx|·180ms ≥ D`. Gesture duration is not a cutoff. Residual axis ratio ≥1.2 on release.
- Left commit: fly off from **rendered release pose** with geometry-safe offscreen target (rotated AABB + 24px margin — width+48 alone can leave corners visible); duration `clamp(140, L/max(|v|,1.6), 300)` ms; carry velocity direction; **no recenter before exit**. Then advance to next ready peer. Generation/peer fence ignores obsolete completions.
- Right commit: existing explicit friendship `request` only (not a fake Match). Bind to the peer at gesture start; cancel if peer changes; single-flight consumed ref covers gesture **and** buttons. **Only confirmed receipt** may auto-advance and play the successful right fly-out; failed / UNKNOWN restores the readable card with honest status and **no automatic replay**. No new match API/schema.
- Cancel / spring-return is interruptible (pin computed transform, then cancel transition) for re-grab without jump when practical.
- **Spring re-grab**: on pointerdown during return, parse the pinned computed matrix (`parseBrowseCssTransformPose`) into drag `originX/originY`; subsequent moves apply **fresh dx/dy relative to that base** (visual = origin + delta). Classifier axis / intent / reversal / velocity stay on the fresh grab samples — do not replace the first move with absolute finger delta alone (that jumps opposite the finger).
- No extra motion/gesture dependencies or generic recognizer packages.
