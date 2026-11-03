# Handoff · #394 role reputation exact regression repair (attempt 26)

Assignment: `OWNER394_EXACT_REGRESSION_REPAIR_AFTER_COMBINED_SOURCE`
Base: `8c811dcfbd2eab27c00bfde058cefe400695b3cb`
Attempt: **26** · continues preserved #394 history (same coordinated release with #372)
Parent: #372 · C5 OFF · PROD forbidden · no Git commit/push/deploy · no new architecture/deps
Author: cursor:auto · progress OD016 · prior source implementation retained

## Inputs viewed (bytes / sha256 as delivered)

| Material | Notes |
|---|---|
| admin-ui.log | decide form absent @ line 318 — source cleared by flushEffects lifecycle |
| disposable-role-reputation.disposable.log | humanApprovePending 403 — pure moderator denied evidence.read |
| disposable-admin-role-reputation.disposable.log | intake 403 @ line 948 — reviewer step_up aged by prior test |
| findings.txt | held count duplicate strong+text; web test is source-string mirror |

## Source completed this pass (allowed paths only)

1. **Consumer HTTP** `role-reputation.disposable.test.ts` — `humanApprovePending` uses existing qualified **superadmin** synthetic reviewer (evidence.assigned.read). Production permission not weakened. Pure moderator 403 remains in admin suite.
2. **Admin HTTP** `admin-role-reputation.disposable.test.ts` — QA findings test restores fresh `step_up_at` via established fixture UPDATE before intake; stale/approve/reply/readonly/basis negatives unchanged (no skip / no assertGreaterThanEqual hide).
3. **Admin UI** `role-reputation-cases.test.tsx` — decide-binding test uses explicit source-read flow (open button → await → set decision fields → submit). Asserts exact case/resource/revision command. Late-source/fresh/case expiry + pure moderator tests retained.
4. **Web panel/dialog** — held count shown once (`<strong>N</strong>` + form without repeating digit); Russian 1/2/5 cases for held games and published review count; same panels + dialog; no layout rewrite.
5. **Web test** `role-reputation.test.tsx` — replaced source-string mirror with 3 behavioral checks (render counts/roles/unavailable; card-action exact handle bind). No new deps; HTTP auth tests untouched.

## Paths touched

- `apps/api/test/integration/role-reputation.disposable.test.ts`
- `apps/api/test/integration/admin-role-reputation.disposable.test.ts`
- `apps/admin/test/role-reputation-cases.test.tsx`
- `apps/web/src/components/consumer/games/RoleReputationPanel.tsx`
- `apps/web/src/components/consumer/games/RoleReviewsDialog.tsx`
- `apps/web/test/role-reputation.test.tsx`
- `docs/handoffs/reviews394-role-reputation.md`

## Author checks (exact; no full QA/CI/DEV claim)

| Check | Result |
|---|---|
| Findings logs read | yes |
| Targeted unit/UI/HTTP in author slot | **pending** (no node_modules / disposable DB in this slot) |
| Product CI / security / DEV smoke | not claimed |
| Independent repair QA | pending (PMA) |
| Owner UAT | **NOT_TESTED** |

## Remaining gates (same coordinated PR — NOT READY / NOT DONE / NOT DEV)

1. PMA: Admin UI vitest + consumer/admin disposable HTTP + web role-reputation behavioral test
2. Independent Codex Sol Medium repair QA
3. Merge `dev` → server DEV ACCEPTED; human Admin UAT remains NOT_TESTED
4. Do **not** treat author pass as DEV / READY / PROD

## Notes

- No authority/migrations/old-tests changes; negatives kept.
- Existing Admin reviewer + consumer roundtrip paths usable after fixture repair.
- Mode B / AGY READY not claimed.
