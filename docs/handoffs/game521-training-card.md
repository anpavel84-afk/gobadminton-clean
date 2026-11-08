# Handoff — #521 unified trainer/ordinary discovery game card

**Assignment:** `OWNER521_UNIFIED_TRAINER_GAME_LIST_CARD_NEAREST_DEV_RELEASE`
**Author:** cursor:auto · attempt 1 · base `524088767e2b7e77d569c2f0a47689db854ab7b0`
**App candidate:** `0.1.0-alpha.57` · API wire unchanged `0.39.0` · `source_sha` null · Owner UAT **NOT_TESTED**
**Refs:** #521 · Owner screenshot (training card full-width banner vs ordinary compact row)
**Scope:** source only · single writer · do not touch #507 WT/branch

## Cause

Desktop `useFeedCardLayout` latched `data-layout="stacked"` when `content.scrollHeight > mediaBudget + 8`. Extra trainer/organizer/reputation blocks made training cards flip to a full-width landscape media banner. Ordinary cards stayed in the compact photo-left row.

## Fix (source only)

1. Removed the height observer / latch. Feed cards no longer switch layout from content height.
2. Desktop CSS: one shared grid `minmax(210px, min(300px, 36%)) + 1fr` for ordinary and trainer cards; media stays a left column with cover crop. Cards may grow in height; content is not clipped to force a square.
3. Mobile ≤720 keeps existing full-width image composition.
4. Trainer + organizer use stable ids (`data-trainer-profile`, `data-organizer-id`); names are never merged. Same known person only when those ids are equal → one compact dual-role row. Missing trainer profile → truthful «Профиль недоступен». Reputation/share/details/seats/terms kept; no new GETs/roles/API.

## Release notes

- `CURRENT_APPLICATION_VERSION` → `0.1.0-alpha.57`
- `API_CONTRACT_VERSION_NOTE` stays `0.39.0` (web-only layout)
- CURRENT delta describes only this #521 layout/roles fix
- Historical seed / older acceptances / first alpha preserved byte-for-byte; no invented SHA/date/receipt
- #507 unpublished numbering left for post-accept renumber; #507 branch not edited

## Paths touched (allowed only)

- `apps/web/src/components/consumer/discovery/DiscoveryGameCard.tsx`
- `apps/web/src/styles/discovery.css`
- `apps/web/test/discovery-training-card.test.tsx`
- `apps/web/test/discovery-training-card.browser.mjs`
- `apps/web/test/fr01-discovery.test.ts`
- `apps/web/test/owner-a-discovery.test.ts`
- `apps/web/src/lib/releases.ts`
- `docs/handoffs/game521-training-card.md`

## Materials

- Owner screenshot `codex-clipboard-64fd0b67-a320-4bf0-af61-69790fed12e9.png` (sha256 `60cd4f0f0e0e51fba80865a207ef676c0047aa19ced67e0f57f6d96c830b5fe6`)

## Checks

- Author sandbox unit: `discovery-training-card` + `fr01-discovery` + `owner-a-discovery` — **PASS** (30).
- Author sandbox browser helper: Playwright/`.tools` **unavailable** here → geometry run **NOT_TESTED** (helper ready; parent executes). Not a self PASS/DEV claim.
- Parent: browser helper + Product CI 7/7 → protected DEV release/smoke.
- Integration: `releases.test.tsx` / `releases-server.test.ts` still pin alpha.56 in this tree — recheck/bump with CURRENT 57 (outside author allowed paths).
- Remaining: independent Sol Medium QA → CI → merge `dev` → server DEV ACCEPTED. UAT=NOT_TESTED.

## Explicit non-claims

- No #507 community/API.40/schema68 notes, no PROD/C5/new OPS/service/architecture/API/roles.
- No Mode B / AGY READY, no self DEV ACCEPTED, no invented acceptance seed.
- No private image publication; media approval pipeline unchanged.
