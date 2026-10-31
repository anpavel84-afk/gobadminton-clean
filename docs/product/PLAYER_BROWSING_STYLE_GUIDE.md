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
- Desktop: **no** pointer swipe/drag mutations and **no** swipe tutorial. Explicit «Давай сыграем» and «Следующий» plus side arrows. Arrows / Next are **browse-only**.
- Directional horizontal slide **200–280ms** on next/prev: stationary outer frame/header/toolbar; animate content inside a clipped stationary frame; direction follows navigation. No automatic browsing timers. No duplicate mounted play-interest controls or concurrent actions. `prefers-reduced-motion` → instant. Rapid clicks, scope/filter/auth change, or unmount cancel obsolete animation. Initial load and details toggle must **not** trigger the player-change slide. Never delay/update wrong-peer mutation callbacks; preserve pending/UNKNOWN and existing capabilities.

## Mobile <1024

Superseded by the **Mobile fullscreen contract** appendix below for cards mode. Do not apply desktop v5 composition globally.

**Delivered (#404 fluid finder slice):** list mode has no segmented «Списком / По одному» control — CSS `@media (max-width: 1023px)` hides `.pb-view-switch` unconditionally (independent of JS `mqReady` / `hidden` / `aria-hidden`; those attrs still keep mobile tab order). Entry is the floating CTA **«Найти напарника»** (full label, dark pill) sharing one overlay zone with optional compact **«На карте»** when Radar is active. Desktop ≥1024 segmented switch and layout stay unchanged.

**Delivered (#404 compact mobile Radar):** mobile list replaces the giant «Игроки рядом с вами» band (heading, subtitle, redundant status helper) with one ≤220px control reusing `RadarSwitchControl` `presentation="directory-desktop"` and `RadarStatusControls` `presentation="directory-compact"` (header owns notices). Single inline row: glyph + dynamic title («Включить Radar» / «Radar включён») + switch; title stays one line (`white-space: nowrap`); helper `small` stays in DOM for `aria-describedby` but is visually hidden — no subtitle under the switch. No outer card, no on/off paragraph banners that shift filters; min-height 44px stable ON/OFF. Desktop toolbar / global header Radar unchanged.

## Catalog & Radar boundary

- Deck / finder eligibility reads the **ordinary public catalog** (`listPlayers` / page `players`) only — independent of `mergeRadarCatalog` presentation dedupe. Radar ON must not remove public peers from finder input. Never inject Radar-only private projection into the PublicPlayer finder. Ordinary **list** still uses `mergeRadarCatalog` (radar rows + ordinary remainder, deduped) for display. No private Radar rows / `resultRef` in the deck.
- Existing Radar semantics, TTL, and privacy fences stay as on `/players`. Desktop compact strip must not auto-toggle or stop Radar.
- Filters, dedup by `publicPlayerId`, cursor pagination, and explicit «Загрузить ещё» / «Показать ещё» when the loaded page + cursor are exhausted — no eager multi-page scanning for the next candidate.
- Filter/scope change invalidates selection and local skips immediately so previous-scope rows/actions cannot flash.
- Self is excluded when the viewer’s own `publicPlayerId` is known. `canSend=false` never sends.
- Guests may browse; play interest requires auth prompt. No auto-send after login.

## Interaction (shared)

- Side arrows and Left/Right on a deliberately focused deck: **browse only** (never play-interest mutation). Desktop ≥1024: buttons only (no pointer swipe).
- Mobile only: Left swipe / «Пропустить»: local skip (no block/withdraw). Right swipe or green «Давай сыграем»: play-interest send — see mobile appendix for 1:1 drag, immediate right fly-off after admission, and peer-bound settlement independent of motion.
- Axis lock / distance-or-flick release / cancel / vertical details; interactive targets exclude drag. No send on partial drag, cancel, navigation, load, or pagination.
- **Desktop:** after **confirmed** receipt: short toast + auto-next eligible candidate (instant index — not the browse slide). **Mobile fluid:** admission starts POST + right fly-off immediately; next prepared peer appears after flight; receipt updates peer-bound status only (no second advance); success is aria-announce only (no visual toast / routine outgoing panel — `quietRoutine`). Busy / UNKNOWN must not fake success. Unilateral outcome copy is «Предложение отправлено» — never «match»/friends. Mutual only after server confirms both current intents: «Вы оба хотите сыграть». Withdraw control: «Отменить предложение».
- Previous restores preserved interest state; no repeated send. Position within the loaded public scope uses browser history state (no new storage engine). Filter change resets selection/skip.
- No mutations on mouseenter or keyboard browse navigation.

## Onboarding (mobile)

- First open (after resolved identity): lightweight **in-context** two-tap coachmark over the visible player card — card/cover/geometry stay readable and same size. **No** blurred backdrop, white modal, huge paragraph blocks, or third «swipe up» step.
- Step 1 (left / red cue): «Свайп влево — пропустить» + one-time «Игрок не получит уведомления» + «Коснитесь, чтобы продолжить». Tap → step 2. Step 2 (right / green cue): «Свайп вправо — давай сыграем» + concise mutual-only note; next tap finishes. Coachmark consumes pointer/click without send/skip/scroll; underlying actions inert until finish or abort. No per-skip toast on mobile.
- Abort via coachmark X / Escape leaves unfinished (no durable mark); reopening may restart. Fullscreen finder CloseButton X stays available. Mobile FS has no «?» replay control (Owner close-only); non-FS mobile context may still expose «?». No automatic repeat after real finish across reopen/reload/new session in the **same** browser.
- Durable completion: `localStorage` key `gb-player-gallery-tutorial-v3:${me.id}` (guests: `…:guest`), written only on step-2 finish. In-memory fallback if storage blocked. Wait for resolved auth before auto-open/mark; reset memory/step on account change. Legacy `sessionStorage` `gb-player-gallery-tutorial-v2` is **not** sufficient and must not be wiped. No backend prefs / cross-device guarantee.
- Focusable hit target with step `aria-label` + polite live; keyboard activation; reduced motion; safe area; fits 375×667 / 390. Desktop does not show this swipe tutorial.

## Play interest (browse deck)

- Browse deck uses `PlayerBrowsePlayInterest` / `playInterestCommand`, server play-interest states, `useSocialMutation`, and pending scope `${me.id}:play-interest:${peerId}`. **Never** reuse or clear friendship pending `${me.id}:friends:${peerId}`. Do not call `/friend-requests` from browse gestures.
- Profile/Friends panel friendship (`FriendActions` / `ProfileFriendship` / `FriendshipsPanel`) stays intact and independent.
- Confirm `receipt.outcome` (`outgoing` ≠ mutual; never invent friends). Stale 409 → reload state. 429 → honor Retry-After with one stable deadline timer that clears at expiry; no invented visible countdown or auto POST retry; parent rate-limit callback must stay identity-stable.
- UNKNOWN: «Проверить статус» is **GET** `getPlayInterestState` only — never `mutation.retry()` / default MutationNotice POST replay on the deck. Ignore retired readonly/status results after generation, peer, or auth scope change.
- Unilateral inbound interest is never disclosed (indistinguishable from none). No automatic friendship, contact, chat, invitation, booking, or notification.
- **Owner #404 friendly match copy (accepted):** primary CTA «Давай сыграем»; outgoing «Предложение отправлено»; mutual «Вы оба хотите сыграть»; withdraw «Отменить предложение». Separate mutual **game match** only — not friendship, not a concrete-game invitation. Remove user-facing technical «интерес к игре» / «интерес недоступен» / «подтверждён сервером» panels from player browsing. Domain DB/API names (`play-interest*`) stay unchanged.
- **Stable action footer:** through loading / send / outgoing / mutual keep one reserved short status line (`.pb-action-status`) and the same action baseline — do not insert a status block above that pushes controls or card size. No new UI framework. Desktop never swipe; mobile native gestures unchanged.
- **Mobile modal offer status overlay (#404):** `.pb-offer-status--modal` is out-of-flow (absolute, bounded `max-height`) in the photo/safe band **below CloseButton/X and above Undo/primary actions** (`top` under X — not `bottom:~112`, which overlaps controls). Mobile finder/list use `quietRoutine` so sending/outgoing/mutual routine panels stay hidden; failed/UNKNOWN/check-status remain. Must not change `.pb-surface`, `.pb-cover`, or controls Y. Explicit ink-on-panel contrast for every tone; check buttons ≥44px. Multiple UNKNOWN use a bounded `<details>` affordance — no main-card scroll, no idle-card shrink to reserve banner space. List `.pb-offer-status--list` may stay in-flow (desktop default presentation).
- Definitive peer `relationship: "unavailable"`: no technical unavailability panel and no disabled send CTA; rely on existing deck eligibility / Next / Skip. Do **not** infer explicit opt-out from network / 503 / auth errors. No separate browse opt-out setting exists in the contract today — privacy/capability boundary is `relationship` + `canSend` / `canWithdraw` only.

## Data honesty

Public list/detail DTO: name, city, area, self-declared level, bio, cover/avatar when present. **Do not invent** star ratings, reviews, exact distance, or upcoming games. Ordinary public API does not provide games — show concise unavailable copy + link to the public profile. Cover may be omitted on list DTO: `getPlayer` on demand for the current id; ignore stale/unmounted/scope/auth-generation responses.

## Loading geometry & media window (#404 Owner UAT)

- **Stable page header from first visible frame:** server-parsed `view` (`initialBrowseView`) + viewport CSS (≥1024 → fixed 116px desktop hero with subtitle; mobile cards → compact without waiting for JS `data-directory-desktop`). Do not open mobile fullscreen portal until the desktop MQ is known (no desktop flash). Preserve route/history/back/X/focus and list defaults.
- **Tinder four-ahead prepare:** `browseMediaNeighborhood` = previous + current + next 4 (max 6), deduped; prep priority current → ahead → previous. Exact retained decoded pixels; existing cache keys, identity/CSRF/session/generation fences, 5s deadline, eviction. Radar pin `RADAR_PIN_MEDIA_CAP=4` / admission / selected-retain stays independent — do not change.
- Gesture parameters and design tokens above remain authoritative; no new policy bundle. Play-interest POS copy: unilateral = «Предложение отправлено»; mutual-only = «Вы оба хотите сыграть»; never auto-friend.

## Sitewide link

See also [SITEWIDE_UI_STYLE_GUIDE.md](./SITEWIDE_UI_STYLE_GUIDE.md) for shared shell/rail rules. Player-browsing deck visuals are governed here (#404 desktop v5), not by rejected feed-card proposals.

---

## Appendix · Mobile fullscreen contract (Owner UAT repair, #404)

**Implemented behaviour (author pass · NOT a QA PASS claim).** Desktop ≥1024 v5 / 406 prepared media / F1–F5 remain unchanged.
Source-backed mechanics reference: Astra High deep gesture study (Owner); numbers below are **OUR** measured tuning labels in `player-browse.ts`, not Tinder private constants.

### Shell
- Cards mode on viewport `<1024` opens a **native `<dialog>` portal** with `showModal()` (focus containment + top layer), covering app header / nav / footer, with exact fullscreen CSS reset (`margin/border/padding/max-width` cleared). Stage is **fullbleed 100dvh** (no in-flow header strip).
- Close only: app-canonical `CloseButton` SVG overlaid top-right with safe-area (≥44px). No counter / place / help `?` strip. Same close wraps early catalog states (loading / unavailable / error / empty / gates) so **X** works with no API / zero items; native parent `<dialog>` unchanged. Explicit `?` replay is removed from mobile FS (automatic one-time 2-step coachmarks remain).
- Underlying directory is `inert` + `body` scroll locked; focus returns to the opener and list scroll restores on close.
- Close paths: **X**, **Escape** (`cancel` → same close), **browser Back**. `pushState` only when entering from list; close uses `history.back()` or `replaceState` for direct `?view=cards` — no history growth loop. Unmount / resize-to-desktop closes the dialog **without** calling the history close path again.
- Nested auth `ProfileDialog` (`<dialog>.showModal`) remains a separate top layer; safe with the browse shell.
- Resize/rotation to ≥1024 tears down the portal and shows desktop v5 inline; no Fullscreen API; no global shell / C5 / runtime changes.
- Mobile routine notices: no per-skip toast and no visual sending/outgoing/mutual success panels in finder/list overlay (`PlayerBrowseOfferStatus` `presentation="quietRoutine"`). Skip no-notification copy appears **once** in the first left onboarding cue. Keep aria-live announce and failed/UNKNOWN/check-status panels. Desktop toast + default offer status unchanged.

### Card
- Full-viewport cover + avatar + **compact** identity. No fixed huge bio excerpt on the cover; details are a separate page covering the photo.
- **Single retained avatar host**: mount `PreparedBrowseAvatar` on cover **or** details, never both — a second host steals the same `HTMLImageElement`. Play-interest controls stay in the stable bottom slot (not remounted / not cloned).
- Avatar render (portal-safe): `.pb-avatar` / `.pb-details-avatar` hosts clip to a circle (`overflow: clip`, `border-radius: 50%`); **descendant** `img` (not only direct-child) uses `width/height: 100%`, `object-fit: cover`, `border-radius: inherit`. Do not rely on `.fr3 .avatar > img` — the mobile `<dialog>` portal drops `.fr3`, and `RetainedBrowseImage` wraps with `display: contents`.
- Swipe **up** opens details; **down** on details text/background returns to cover / previous **mobile info page**. `data-browse-no-drag` only on actual buttons/links/pager — **not** on the whole `.pb-mobile-details` surface. Closed details stay mounted with `inert` + `aria-hidden`; while details are open, cover/identity controls are inert (not tabbable). One retained avatar host and stable play-interest slot unchanged.
- **Fixed mobile information pages** (not one packed scroll of facts+bio+games): (1) facts/overview, (2) about-bio page(s) height-fit via existing `chunkBrowseBio` / measure helpers, (3) games notice + public profile link. Up advances page; down previous; down from the first page returns to cover. Accessible «К обложке» / «Назад» / «Ещё сведения» stay **outside** the clipped body so they are never below the fold. Desktop `detailsPage` bio pager is separate — do not change desktop v5 details paging.
- Bio chunks must fit the available about-page height at 375×667 and 390×844 (including font zoom): **no** full-text cutoff, **no** ordinary nested scroll, **no** `-webkit-line-clamp` clipping of lossless bio. Recompute on viewport/text-size changes. Do not invent a generic pagination framework.
- Minimal persistent **Пропустить** / **Давай сыграем** buttons remain accessible alternatives (stable footer + one status line; no nested scroll; fixed outer card size). Whole card height stays fixed; X/actions always available at 390×844 and 375×667 without horizontal overflow.
- Last card left must settle to a visible honest end / «Загрузить ещё» terminal, not leave only a flown-off card forever. On mobile FS the last **visible** card keeps full stage height (idle geometry): plain end / `hasMore` use out-of-flow `.pb-deck-end--fs` / `.pb-fs-end` / `.pb-deck-end--fs-more` (no header strip, no in-flow footer that shrinks the card). Eligibility empty/continue stays in `PlayerBrowseFinderGate`. Desktop `.pb-deck-end` stays in-flow.
- One-time in-context two-tap guide (`gb-player-gallery-tutorial-v3:${actor}`); first left cue includes the no-notification hint once. Mobile FS has no `?` replay control (Owner: close-only). Legacy v2 session marker retained, not authoritative. Existing real metadata only; games copy stays honest unavailable.

### Gestures · OUR tuning (`player-browse.ts`)
- Register only after the pending card is **media-ready**. Single active pointer; stable **pointer capture**; handlers use refs so the controller is not recreated mid-drag. Second contact cancels **before** primary/interactive exclusions (document capture while drag active, including outside the gesture surface); never adopts the secondary pointer; close/help still receive the event; cancel / late primary release → zero POST/skip.
- `touch-action: pinch-zoom` on the gesture surface (app owns pans; browser keeps pinch). Interactive targets (`button,a,…`, `[data-browse-no-drag]`) excluded. `pointercancel` / non-primary / multitouch / blur / unmount / auth / scope / breakpoint → **no mutation**, cancel timers, spring-back. Flight completion and skip/advance are fenced with captured `flyGen` **and** `viewerGen` (auth expiry/session bumps both synchronously).
- Horizontal drag is **1:1** via RAF + CSS transform from release pose — **no damping**. Grab-pivot `transform-origin` at pointerdown; rotation bounded `±12°` (`browseDragRotationDeg`), not unbounded `dx/28`. Full-surface **red (left / skip)** and **green (right / request)** saturating intent layers (smoothstep). Green while touching is **intent**, not server PASS.
- Axis lock after **8px** with **1.3×** dominance.
- Recent velocity: last **80ms** window including the release sample; **0** after ~100ms pause; capped ±2.5 px/ms (`sampleBrowseVelocity`).
- Release (`releaseCommitted`): **reverse veto first** (≈10px reverse travel + opposite velocity ≥0.2 px/ms) even past distance — then **slow-distance** `D=clamp(72,.24W,112)` **or** short-fast projected flick `F=clamp(18,.06W,28)`, `|vx|≥0.65`, `p=travel+|vx|·180ms ≥ D`. Gesture duration is not a cutoff. Residual axis ratio ≥1.2 on release.
- Left commit: fly off from **rendered release pose** with geometry-safe offscreen target (rotated AABB + 24px margin — width+48 alone can leave corners visible); duration `clamp(140, L/max(|v|,1.6), 300)` ms; carry velocity direction; **no recenter before exit**. Then advance to next ready peer. Generation/peer fence ignores obsolete completions.
- Right commit: explicit play-interest `send` only (unilateral is never Match; mutual only after server receipt). Bind to the peer at gesture start; cancel if peer changes; single-flight consumed ref covers gesture **and** buttons. **Fluid mobile (delivered):** synchronous page-level admission (captured actor/peer/operation) starts POST and right fly-off from release pose immediately; next eligible peer after flight completion; receipt must not advance again or move a newer card. One active POST; browsing/left skip/X allowed while unsettled; next right may show «Завершаем предыдущее предложение». UNKNOWN blocks only the original peer (no automatic POST/retry). Status lives in a stable modal slot and remains on the list after X. Do not POST `/friend-requests` from browse.
- Cancel / spring-return is interruptible (pin computed transform, then cancel transition) for re-grab without jump when practical.
- **Spring re-grab**: on pointerdown during return, parse the pinned computed matrix (`parseBrowseCssTransformPose`) into drag `originX/originY`; subsequent moves apply **fresh dx/dy relative to that base** (visual = origin + delta). Classifier axis / intent / reversal / velocity stay on the fresh grab samples — do not replace the first move with absolute finger delta alone (that jumps opposite the finger).
- No extra motion/gesture dependencies or generic recognizer packages.

### Mobile entry + eligibility (delivered · #404 first fluid slice)
- Floating **«Найти напарника»** opens existing fullscreen cards; CTA stays outside the dialog. Radar **«На карте»** shares the same overlay zone; list reserves safe-area/nav padding for the max zone height so heading/toolbar do not jump when Radar toggles.
- On authenticated cards entry/reopen/new session (**mobile and desktop**): batch `GET /v1/me/play-interest-states` for the current catalog page (1..50 UUID query params; ordered IDs ↔ positional response; actor/generation/filter bound) before showing candidates. Show only `none && canSend`; exclude outgoing/mutual/unavailable and own unresolved markers. Transient read failure → explicit retry, never empty-or-allowed fallback. Empty filtered page with cursor → «Продолжить поиск» (one page + one batch). True end only when cursor exhausted. Left skip is local; no automatic cycle at end. Ordinary list remains complete (does not filter friends/mutual). Desktop guest public preview / auth prompt preserved (no private states API; no pretend-none). Desktop controls/headers/media/pointer and receipt-wait send path unchanged; mobile fluid fly-off stays mobile-only. Eligibility does not splice in-session active card/animation; Previous/history may still show an already-sent peer within the same visit. No whole-catalog download.

### PROPOSED · smart ranking (next bounded slice — NOT implemented)
Recommendation only; must not be claimed as shipped behaviour and must not fake a globally ranked partial page:
1. Hard filters stay absolute (city/area/name/looking/trainer).
2. Prefer same city → level compatibility on the pilot scale (exact `(scaleId, scaleVersion, levelId)` until neighbourhood is Owner-approved) → same area → stable name+id tie-break.
3. Distance only from authorized Radar rows with consent/TTL; never invent coordinates. Do not auto-enable Radar on finder open.
4. Prefer a future opt-in finder order on `GET /players` over client-wide catalog download. Until then, any local reorder of an already-checked buffer must be labelled honestly (e.g. «Среди загруженных»), not as global city ranking.
