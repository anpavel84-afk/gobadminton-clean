# Issue #445 points 2 + 6 — Friends / recommendations own-prerequisite guidance (group B)

From: Cursor Auto (`VISUAL445_B_SOCIAL_PREREQUISITE_GUIDANCE`, attempt 2, base `215bc0f66b32cb9e2dec3723fb53a570b50b2b22`).
To: independent Codex Sol Medium QA → mandatory Product CI → trusted DEV → Go Bad browser retest.
Status: SOURCE CANDIDATE only. **UAT = NOT_TESTED**. Do **not** close #445 (`Refs #445`, no Closes). Points 1/3/4/5 out of scope for this writer. PROD forbidden. No fake READY/PASS. Actual Owner profile ID unknown (asked in issue) — root cause for the specific Go Bad account is **not** claimed proven.

## Pass-2 scope (harness only)

Addressed pass-1 FAIL 6/20 from `web-addressed.log` (SHA256 `20fe566f1b780a6cfc0c23801133c248c54f4859a0c74204f483dd0c3e3cde31`). **No production behavior changes** this pass — fail log already showed correct resolved body copy for prerequisite / unavailable / empty / guidance link; titles and retry lived on unevaluated `ProfileState` / `Link` props.

### Exact harness cause (pass1)

- `labelOf` walks only `element.props.children`. `ProfileState` `title` is a prop, so titles never appeared in the joined label string.
- Mock `ProfileState` stamps `data-profile-state` / synthetic retry button only after React executes the component; `elements(tree)` does not execute it.
- `next/link` remains a component node until render; asserting `el.type === "a"` was false even when `props.href` / link children were present.
- Async settle + second render was already reaching resolved states (capabilities / `getMySocialProfile` / denied-list skip) — not masked.

### Repair (allowed paths only)

1. `friends-page-prerequisite.test.tsx` — assert `props.title` on `ProfileState` (same pattern as existing empty-cursor recommendation case); assert `/profile` via Link `props.href` + «Открыть профиль» children; error case checks `title` + `typeof retry === "function"`; confirm capabilities / own-profile calls and `listFriends` never on denied path; empty admitted list via `title`.
2. `my-games-recommendations.test.tsx` — same title / Link prop assertions for the two gated-off cases; confirm capabilities + `getMySocialProfile` called and recommendation list GET skipped. All 14 prior recommendation tests kept; no skips / no weakening / no source-text regex.
3. Production `FriendsPage` / `GameRecommendationsSection` untouched this pass.

## Read ack / design provenance

| Material | Delivered path | SHA256 | Read |
| --- | --- | --- | --- |
| Pass-1 addressed log | `/tmp/gb-cursor-211-owner-quota-colzeata/data/design-inputs/web-addressed.log` | `20fe566f1b780a6cfc0c23801133c248c54f4859a0c74204f483dd0c3e3cde31` | Yes — 4 friends + 2 recommendation failures; body copy already correct |
| Admission / v5 / sitewide | prior pass-1 handoff | (unchanged) | Pass-1 provenance retained; not re-opened this harness pass |

## Defects addressed (product — from pass 1; unchanged this pass)

2. **/friends (#436)**: fresh logged-in user saw «Друзья сейчас недоступны…» — false technical outage when own social profile is still virtual/hidden.
6. **/my-games**: «Рекомендации сейчас недоступны» under the same own-prerequisite condition.

Backend/policy unchanged: no fake `friends:true`, no schema change.

## Author checks (not independent QA)

- Model environment may lack installed deps — trusted operator:
  `pnpm --filter @gobadminton/web exec vitest run test/friends-page-prerequisite.test.tsx test/my-games-recommendations.test.tsx`
  Expect 20/20; web `typecheck` only if CI requires for test-only touch.

## Remaining real browser checks (Go Bad / trusted DEV)

- Fresh email user (hidden / unsaved social profile): `/friends` and `/my-games` recommendations show profile setup guidance + `/profile` link — **not** «сейчас недоступны».
- After save + directory visibility (eligible): friends/recs behave per server capability.
- Guest / session expiry / foreground invalidation still clear private content; denied path still does not fetch private lists.

## Non-goals / unchanged

- No backend capability, auth, PROD, AGENTS, C5, version metadata, or blanket permission changes.
- No production source edits this pass; no Git/runtime/PROD by author.
- No new classifier/service/framework.

## Changed paths (attempt 2)

- `apps/web/test/friends-page-prerequisite.test.tsx`
- `apps/web/test/my-games-recommendations.test.tsx`
- `docs/handoffs/visual-qa445-social-guidance.md`
