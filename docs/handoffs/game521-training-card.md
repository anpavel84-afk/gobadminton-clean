# Handoff — #521 D2 square crop + compact discovery roles

**Assignment:** `OWNER521_UAT_SQUARE_CROP_COMPACT_ROLES_ASTRA_D2`
**Author:** cursor:auto · attempt 3 · base `06d6a05099f11c79c71407f7728c6b7bb19467ed`
**App candidate:** `0.1.0-alpha.58` · API wire unchanged `0.40.0` · `source_sha` null · Owner UAT **NOT_TESTED**
**Refs:** #521 continue after Owner UAT FAIL on DEV57 · Astra senior D2 · Owner square-crop image · #507 I1 already on source base (independent consumer QA PASS; not deployed)
**Scope:** source only · single writer · no OPS/train · no venue community/hooks/API/schema · no Git/push/deploy/PROD

## Owner UAT FAIL → D2

DEV57 (`895e97fd`) left a tall stretched photo when content grew. D1 (photo 1:1 alone) still left ~430px trainer cards. Approved Astra D2 keeps desktop square crop (`aspect-ratio: 1/1`, `align-self: start`, cover 50% 50%) and compact two adjacent roles + one history/actions footer. Mobile stays the ordinary **210px** image family for both card types — no unasked 356px square mobile change.

## Source delta (allowed paths)

1. **`DiscoveryGameCard.tsx`** — trainer cards always render via `RoleReputationCardActions` `renderCompact`: people grid (trainer + organizer always distinct namespaces), gated whole-role review buttons (Avatar + name + «Отзывы» cue, no nested controls), footer with organization held history only when `count != null` plus Details/share. Ordinary cards keep host + optional ordinary reputation footer branch.
2. **`RoleReputationPanel.tsx`** — presentation-only `renderCompact(view)` before ordinary null return; single open/dialog state; ordinary `gb-role-rep-footer` branch unchanged for non-compact callers.
3. **`discovery.css`** — desktop square image + people/role-review/footer overrides; skeleton desktop square; mobile 210px/`aspect-ratio: auto` preserved.
4. **Tests** — SSR fixture + Chromium CDP helper (390/820/1280/1920, square ≤1px, typical DEMO compact height, long names / same-string ids / missing trainer); new mounted RTL `discovery-training-card-interactions.test.tsx` for dialog open/close/focus and unavailable gate.
5. **`releases.ts`** — add accurate #521 square/compact fix into **existing** I1 current 58 notes; API 0.40.0 unchanged; no 59 bump; no invented 58 receipt/SHA; community additions + I2/I3-style limitations kept truthful; historical 61 rows + accepted 57 seed untouched.

## Materials viewed

- Owner `Owner521-square-crop.png`
- Astra D2 handoff + Chromium 1280 PNG + browser geometry JSON + DOM/CSS reference
- Venue507 consumer20 PASS (source base includes #507 I1)
- Exact accepted 57 history seed

## Checks expected next

- Targeted web types/lint + Card/role/release tests (author)
- Independent QA → CI 7/7 → guarded combined DEV58/API40 (not claimed here)
- Parent Chromium geometry helper when `/opt/gobadminton-qa/chromium-headless-1243/chrome-headless-shell` present; screenshots out of repo
- Owner UAT = **NOT_TESTED**; installed DEV remains 57 until trusted release

## Explicit non-claims

- No #507 code/privacy/rating-frozen guards changed; no OPS routing advertised active
- No Mode B / AGY READY, no self DEV ACCEPTED, no invented acceptance seed/SHA/date
- No PROD/C5/gates/API/schema/venue-community modifications
- No height-observer / line-clamp / fixed max-height / content scroll to hide facts
