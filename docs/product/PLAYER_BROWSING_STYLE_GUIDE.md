# Игроки по одному · Style Guide (#404)

**OWNER_APPROVED · 30.10.2026 · published v2**

Authority: Owner chat 30 Oct 2026 («Запускай в разработку»); Issue #404.
Approved visual / brief: published gallery revision **v2**
`https://files.anpavel.ru/projects/gobadminton/design/style-guide/player-browsing/20261030-owner-v2/index.html`

Provenance of the approved package (design pass → Owner): HTML mock, brief, guide, desktop PNG, mobile PNG. This document records product contracts for the integrated consumer surface. Do **not** copy full mock personas, gallery JS, scenario selectors, or demo banners into the app.

Supersedes any PROPOSED markers in those design-pass texts for implementation scope.

## Composition (v2)

- One large continuous profile card in the `/players` workspace (not v1 small-left-tile + right inspector).
- Desktop ~1440×900 / 1920×1080: scene follows the window; side chevron zones; cover grows with viewport height. No Fullscreen API.
- Cover + avatar-in-white-circle + dark identity/bio/actions on one surface. Details expand **inside** the same card.
- Cards mode only: compact page header; existing Radar / filters / chips sit in an accessible `<details>` collapsed by default so the closed deck and main actions fit ~1440×900 and remain large on ~1920×1080. List mode keeps the expanded Radar band, filters, chips, list, and unified privacy TTL unchanged.
- Cards mode must not place the private Radar tile grid above the ordinary deck; a short readonly note may link to the existing list or map.
- Height budget is scoped CSS only (no ResizeObserver / `scrollIntoView` composition masks). Mobile ≤720: compact cover/avatar; primary skip/request actions stay reachable; one document scroll (no nested competing scroll).
- Reuse existing `ProfileCover` / `Avatar` / presentation helpers with **scoped** `.gb-player-browse` CSS only — do not change global hero styles.

## Catalog & Radar boundary

- Deck reads the **ordinary public catalog** (`listPlayers`) only. No private Radar rows / `resultRef` in the deck.
- Existing Radar band, unified rendering, TTL, and privacy fences stay as on `/players`. Cards-mode collapse must not auto-toggle or stop Radar.
- Filters, dedup by `publicPlayerId`, cursor pagination, and explicit «Загрузить ещё» / «Показать ещё» when the loaded page + cursor are exhausted — no eager multi-page scanning for the next candidate.
- Filter/scope change invalidates selection and local skips immediately so previous-scope rows/actions cannot flash.
- Self is excluded when the viewer’s own `publicPlayerId` is known. `canRequest=false` never sends.
- Guests may browse; friendship requires auth prompt. No auto-send after login.

## Interaction

- Side arrows and Left/Right on a deliberately focused deck: **browse only** (never friendship mutation).
- Left swipe / «Пропустить»: local skip (no block/decline/unfriend). Right swipe or «Предложить дружбу»: request via the same handlers.
- Threshold / direction / cancel / vertical pan / pinch; interactive and details targets exclude drag. No request on partial drag, cancel, navigation, load, or pagination.
- After **confirmed** receipt: short toast + auto-next eligible candidate. Busy / UNKNOWN must not fake success.
- Previous restores preserved relationship; no repeated request. Position within the loaded public scope uses browser history state (no new storage engine). Filter change resets selection/skip.
- No mutations on mouseenter or keyboard browse navigation.

## Onboarding

- First open: short overlay on the card (gestures). Dismiss via «Понятно» / X / Escape. No auto-timer.
- Per-version boolean `gb-player-gallery-tutorial-v2=1` in `sessionStorage` (memory fallback). Discreet «?» reopens. No persistent instruction banner.
- Background card inert while tutorial; focus return; controls ≥44px; honor reduced motion / safe area.

## Friendships

- Reuse `friendCommand`, server capabilities/states, `useSocialMutation`, and pending scope `${me.id}:friends:${peerId}` (same as `FriendActions`). Do not clear that pending key on skip/filter/unmount/reload.
- Key per-peer action UI by current auth user + peer. Refresh caps/state on foreground/session change; retire private UI on `gb-private-expired` / `gb-session-changed`.
- Confirm `receipt.outcome` (`pending` is not `friends` unless accepted). Stale 409 → reload state. 429 → honor Retry-After with one stable deadline timer that clears at expiry; no invented visible countdown or auto POST retry; parent rate-limit callback must stay identity-stable.
- UNKNOWN: «Проверить статус» is **GET** `getFriendState` only — never `mutation.retry()` / default MutationNotice POST replay on the deck. Ignore retired readonly/status results after generation, peer, or auth scope change.
- Incoming decisions only via explicit `canAccept` / `canDecline`. No silent right-swipe accept. Do not disclose blocked reason.

## Data honesty

Public list/detail DTO: name, city, area, self-declared level, bio, cover/avatar when present. **Do not invent** star ratings, reviews, exact distance, or upcoming games. Ordinary public API does not provide games — show concise unavailable copy + link to the public profile. Cover may be omitted on list DTO: `getPlayer` on demand for the current id; ignore stale/unmounted/scope/auth-generation responses.

## Sitewide link

See also [SITEWIDE_UI_STYLE_GUIDE.md](./SITEWIDE_UI_STYLE_GUIDE.md) for shared shell/rail rules. Player-browsing deck visuals are governed here (#404 v2), not by rejected feed-card proposals.
