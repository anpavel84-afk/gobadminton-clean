# Handoff · #394 role reputation exact final QA repair (attempt 27)

Assignment: `OWNER394_EXACT_FINAL_QA_REPAIR`
Base: `a7aff5c3d87a4d65a2904249f8ecc50080eb39d4`
Attempt: **27** · continues preserved #394 history (same coordinated release with #372)
Parent: #372 · C5 OFF · PROD forbidden · no Git commit/push/deploy · no new architecture/deps
Author: cursor:auto · progress OD016 · prior Admin/consumer PASS surface preserved

## Inputs viewed (bytes / sha256 as delivered)

| Material | Notes |
|---|---|
| final.txt (QA FAIL2) | P1 reply unbound to approved review revision; P2 discovery proof-only filter; web FAIL is harness |
| web-ui.log | card-action test expected `data-handle` undefined — nodes walk without mounting mock child |

## Source completed this pass (allowed paths only)

1. **P1** `role-reputation.service.ts` `projectItems` — public reply requires `rr.bound_review_revision_id = s.approved_revision_id`; pending join same; `subjectOwnReply` only when tip bound to current approved review (no pretend old published reply; history not deleted).
2. **P1 HTTP** `role-reputation.disposable.test.ts` — lifecycle: approved reply on v1 visible → author v2 pending keeps v1+reply → human v2 approve hides old reply → stale expectedReviewRevision negative → fresh reply pending then publish after approve. `humanApprovePending` handles `reply_submit`.
3. **P2** `games-discovery.query.ts` — trainerRoleHandle: proof first, else read-only `trainer_led` + `trainer_profile` owner matching training role handle (same as public card); no writes/eligibility.
4. **P2 unit** `role-reputation-discovery.test.ts` — asserts fallback SQL + single bound parameter.
5. **Web harness** `role-reputation.test.tsx` — asserts real `RoleReviewsDialog` props (`roleHandle`/`role`/`gameId`) + invoke mock/`onClose`; count/unavailable cases retained.

## Paths touched

- `apps/api/src/games/role-reputation.service.ts`
- `apps/api/src/games/games-discovery.query.ts`
- `apps/api/test/integration/role-reputation.disposable.test.ts`
- `apps/api/test/unit/role-reputation-discovery.test.ts`
- `apps/web/test/role-reputation.test.tsx`
- `docs/handoffs/reviews394-role-reputation.md`

Admin disposable / Admin UI / release20 authority: **not modified** this pass (prior PASS reused).

## Author checks (exact; no full QA/CI/DEV claim)

| Check | Result |
|---|---|
| QA FAIL2 + web-ui.log read | yes |
| Targeted unit (discovery) + web behavioral | run in author slot when tooling present |
| Consumer disposable HTTP lifecycle | source added; needs disposable DB (PMA) |
| Product CI / security / DEV smoke | not claimed |
| Independent DELTA QA | pending (PMA) |
| Owner UAT | **NOT_TESTED** |

## Remaining gates (same coordinated PR — NOT READY / NOT DONE / NOT DEV)

1. PMA: discovery unit + web role-reputation behavioral + consumer disposable HTTP (new lifecycle) + reuse prior Admin PASS
2. Independent Codex Sol Medium DELTA QA on these 2 defects + harness
3. Merge `dev` → server DEV ACCEPTED; human Admin UAT remains NOT_TESTED
4. Do **not** treat author pass as DEV / READY / PROD

## Notes

- No authority/migrations/framework/deps/Git/live/credentials changes.
- Mode B / AGY READY not claimed.
