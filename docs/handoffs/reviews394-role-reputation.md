# Handoff · #394 role reputation Admin UI + QA repairs + alpha.20 (attempt 25)

Assignment: `OWNER394_ROLE_REPUTATION_ADMIN_UI_RELEASE_AND_EXACT_QA_REPAIR`
Base: `9a5f8d204e792098754696f6d1907b5c0ee6f553`
Attempt: **25** · continues preserved #394 history (same coordinated PR with #372)
Parent: #372 · C5 OFF · PROD forbidden · no Git commit/push/deploy / no dependency install in this author pass

## Inputs viewed (bytes / sha256 verified)

| Material | delivered_path | Notes |
|---|---|---|
| human-review-desktop.png | design-inputs | Concept tab 08 «Разбор»; criticism remains opinion; report does not auto-hide |
| human-review-mobile.png | design-inputs | Same concept, mobile |
| final.txt (Sol Medium Admin QA) | design-inputs | FAIL @ `2bb9…`; 4 findings immutable |
| alpha20-role-reviews-brief.md | design-inputs | Prospective alpha.20 wording; UAT NOT_TESTED |
| alpha19-history-seed-for-alpha20.json | design-inputs | Exact alpha.19 seed prepended to history |
| addressed-checks.json / disposable-db.json | design-inputs | Pass5 consumer+HTTP both PASS at base |

## Source completed this pass

### 1. Exact Sol Medium Admin QA repairs (`role-reputation.service` admin)
1. **approve REVIEW** targets **current `pending_revision_id` only** — reports about approved text use **retain** (does not clear newer pending).
2. **approve REPLY** requires exact current `role_review_replies.pending_revision_id`.
3. **readSource** requires `evidence.assigned.read` even for `case.manage` holders (removed manages bypass). Approve/restore/basis also require read qualification (no ID guessing). UI affordance: support/superadmin; moderator triage assigns via ordinary Cases assign.
4. **`role_basis_resolve`** only when intake `kind === basis_dispute` + exact bound proof target; text/report Cases denied (`BASIS_KIND_DENIED`).

Targeted HTTP negatives added in `admin-role-reputation.disposable.test.ts` (stale approve / moderator source 403 / wrong-kind basis). Positive fixture uses **superadmin** reviewer.

### 2. Admin Cases UI — `RoleReputationCases` child
- Pending queue + human intake + case metadata + explicit source read + decide (approve/retain/correction/remove/restore).
- Session/fresh/run/stepup + original idempotency key + UNKNOWN retry; clears protected payload on session/fresh/case/version/assignment change and unmount (incl. late success).
- Scoped CSS; UI tests for late-async privacy + decide binding + moderator affordance.
- Optional `roleReputation` metadata on Case detail (OpenAPI optional; table-absence guarded).

### 3. Consumer companions (small)
- **A** READ IDENTITY ONLY fallback for future games without tip: `organizer_id IS NULL` → `created_by`; `trainer_led` + trainer profile owner. Same gates; no write/proof grant.
- **B** Batch `viewerBlocked` + `heldGamesCount` set-oriented for all bounded subjects (no N+1).
- **C** Map honesty copy when personal trainer filter active — map shows all city games; filter applies to list; preserved on return.

### 4. Release alpha.20
- `CURRENT_APPLICATION_VERSION` = `0.1.0-alpha.20`, `API_CONTRACT_VERSION_NOTE` = `0.28.0` (matches OpenAPI `info.version`).
- Prepended exact alpha.19 historical seed; preserved alpha.18 and all prior / alpha.1 baseline.
- Russian delta: public role reviews before join + human Cases review; no fake 15/20; UAT **NOT_TESTED**; PROD not promoted.

## Paths touched (allowed)

Admin: `RoleReputationCases.tsx`, `Cases.tsx`, `admin-client.ts`, `admin.css`, `role-reputation-cases.test.tsx`, `cases.test.tsx`
API admin: `role-reputation.service.ts`, `cases.service.ts`, `admin-role-reputation.disposable.test.ts`
API consumer: `games/role-reputation.service.ts`
Web: `releases.ts`, release tests, `GamesDiscoveryPage.tsx`, `role-reputation.test.tsx`
Contracts: `openapi.json` (optional Case metadata only)
Docs: this handoff

## Author checks

| Check | Result |
|---|---|
| Design images / QA JSON / release seed | viewed |
| Targeted unit/UI/HTTP | **notrun** in author slot (no node_modules / no DB / network forbidden) |
| Product CI / security / DEV smoke | not claimed |
| Independent repair QA | pending (PMA) |
| Owner UAT | **NOT_TESTED** |

## Remaining gates (same coordinated PR — NOT READY / NOT DONE / NOT DEV)

1. Trusted PMA: targeted typecheck/contracts + Admin/consumer disposable HTTP + Admin UI test + Product CI
2. Independent Codex Sol Medium repair/UI/history QA
3. Merge `dev` → server DEV ACCEPTED; human Admin UAT remains NOT_TESTED until authorized session
4. Do **not** claim source finished = DEV / READY / PROD

## Notes

- No new Astra/architecture/C5; one writer; AdminRoleService RBAC grants unchanged.
- Private peer Cases regression mock preserved; RoleReputationCases mocked in peer source race test.
- Mode B / AGY READY not claimed.
