# Issue #445 points 2 + 6 — Friends / recommendations own-prerequisite guidance (group B)

From: Cursor Auto (`VISUAL445_B_SOCIAL_PREREQUISITE_GUIDANCE`, attempt 1, base `67316f89a18ac7c95309c0e45a6ab9067d18b8a2`).
To: independent Codex Sol Medium QA → mandatory Product CI → trusted DEV → Go Bad browser retest.
Status: SOURCE CANDIDATE only. **UAT = NOT_TESTED**. Do **not** close #445 (`Refs #445`, no Closes). Points 1/3/4/5 out of scope for this writer. PROD forbidden. No fake READY/PASS. Actual Owner profile ID unknown (asked in issue) — root cause for the specific Go Bad account is **not** claimed proven.

## Read ack / design provenance

| Material | Delivered path | SHA256 | Read |
| --- | --- | --- | --- |
| Admission (`admission.json`) | `/tmp/gb-cursor-211-owner-quota-zaficdrn/data/design-inputs/admission.json` | `93317942e8e480a2e42bcc39ba7f27b6caf847cda1f0e4ccfd1515b7822691a0` | Yes — group B = points 2+6; source_pr 436 for friends; recommendations reuse accepted #182 path (report does not name a recommendations PR) |
| Players desktop-v5 HTML | `/tmp/gb-cursor-211-owner-quota-zaficdrn/data/design-inputs/approved-v5.html` | `cd083f8eee62fd6032021b176a62634af631b68e384ad820ad200493c627473c` | Yes — this pass. Neutral finder empty/catalog language; friendship CTA after confirm; no first-message gate restore |
| Players desktop-v5 PNG | `/tmp/gb-cursor-211-owner-quota-zaficdrn/data/design-inputs/approved-v5-desktop.png` | `888506282f09e04af5c8172767786b959e04efe342802f9b79394f5c25d87822` | Yes — image opened as image this pass (card / «По одному» / Radar off / «Добавить в друзья»). Confirms standard `/profile` route guidance is compatible; no outage chrome invented |
| Sitewide owner-v3 | `/tmp/gb-cursor-211-owner-quota-zaficdrn/data/design-inputs/index.html` | `cd1675a742304b585526d09337c568ce6ac807ff3f4bcf002a93447c0ba538ac` | Selective — `statebox` / ProfileState family, friends + my-games recommendation panels, own-profile visibility. Old gallery DM-first copy superseded by current Owner/styleguide — **not** restored |

Prior group C handoff accurately recorded missing v5 inputs on that earlier pass. This group B pass is the first local read of original approved-v5 HTML+PNG; see also updated C handoff note (no retroactive pass-1 read claim).

## Defects addressed

2. **/friends (#436)**: fresh logged-in user saw «Друзья сейчас недоступны…» — false technical outage when own social profile is still virtual/hidden (email signup does not create public social profile; default hidden; accepted privacy policy).
6. **/my-games**: «Рекомендации сейчас недоступны» under the same own-prerequisite condition (`gameRecommendations` = friends + schema; DEV flags ON).

Backend/policy unchanged: `FriendshipsService.capabilities` friends = runtime gate + tables + own profile eligible (`active`, `directory_visible`, `social_eligible`, not restricted). No auto public opt-in, no fake `friends:true`, no schema change.

## Repair (allowed paths only)

1. `FriendsPage.tsx` — when valid capabilities return `friends:false`, fetch existing `getMySocialProfile` only. If version &lt; 1 or hidden / not `socialEligible` → compact `ProfileState` prerequisite + `/profile` link (no outage wording). If own profile already eligible → keep genuine unavailable. Failed own read → error/retry (401 → guest). Never call `listFriends` while denied.
2. `GameRecommendationsSection.tsx` — same own-prerequisite branch when `recommendationsUiEnabled` is false; never list recommendations while denied; real empty inbox unchanged when capability true.
3. Tests: `friends-page-prerequisite.test.tsx` (new); `my-games-recommendations.test.tsx` (two behavior cases). Existing hook harness; no source-text regex matrix.

## Author checks (not independent QA)

- Model environment: **no installed deps** — vitest / typecheck **not** run here.
- Trusted operator after import:
  `pnpm --filter @gobadminton/web exec vitest run test/friends-page-prerequisite.test.tsx test/my-games-recommendations.test.tsx`
  and web `typecheck` for touched files.

## Remaining real browser checks (Go Bad / trusted DEV)

- Fresh email user (hidden / unsaved social profile): `/friends` and `/my-games` recommendations show profile setup guidance + `/profile` link — **not** «сейчас недоступны».
- After save + directory visibility (eligible): friends/recs behave per server capability (empty list OK when admitted; real feature-off stays unavailable).
- Guest / session expiry / foreground invalidation still clear private content; denied path still does not fetch private lists.
- Do not claim a specific Owner account root cause without their public profile evidence.

## Non-goals / unchanged

- No backend capability, auth, PROD, AGENTS, C5, version metadata, or blanket permission changes.
- Points 1/4 remain separate; group C already committed — not undone.
- No new classifier/service/framework; existing `ProfileState` + `getMySocialProfile` only.

## Changed paths

- `apps/web/src/components/consumer/pages/FriendsPage.tsx`
- `apps/web/src/components/consumer/games/GameRecommendationsSection.tsx`
- `apps/web/test/friends-page-prerequisite.test.tsx`
- `apps/web/test/my-games-recommendations.test.tsx`
- `docs/handoffs/visual-qa445-social-guidance.md`
- `docs/handoffs/visual-qa445-navigation.md` (C handoff: later-pass v5 read ack only)
