# #506 MOD-V2-C2 — exact selected-message reports + Cases source (SOURCE 49)

Base: frozen `4735d4f3614847e4eb77ed0c66655a1a20c23cac`. Application notes: **0.1.0-alpha.55** (UAT `NOT_TESTED`, candidate not published). Trusted accepted seed latest **alpha.54** `cce49ce72daed8c81f89ddc845deabbb8ac5d7aa`. API contract **0.38.0**. Cursor Auto sole source writer. Attempt **49** (parent attempt **48** FAIL preserved). C2 app behavior not independently accepted. Product source unchanged this pass — test harness/contract + handoff only. No paid architecture; private external egress remains **OFF**. Not DONE / not DEV ACCEPTED. Pending QA/CI/DEV.

## Retention selection (explicit)

Reference-only `message_report_bindings` (HMAC fingerprint + consent + identity). Exact-source body read only while original `messages.purge_eligible_at` is **finite and future**. **NULL expiry → unavailable** (Owner legacy question unanswered; mandatory strict fallback). No new 14-day retention, no TTL mutation, no body copy into `case_evidence_items`.

## Attempt 49 repair (allowed paths only)

- API integration: same Idempotency-Key replay assertion corrected to **201** (sealed create receipt); reportId/rowcounts/security expectations preserved; distinct-key binding reuse remains **200**.
- Web `private-message-reports.test.tsx`: typed expand/walk harness (safety-test pattern); exercises ProfileDialog composition via real report→message-mode→select→consent→submit; typecheck-safe props; payload obligations unchanged.
- Admin: moved Cases message-source clearing test to `apps/admin/test/message-report-cases.test.tsx` (vitest `test/**/*.test.{ts,tsx}`); deleted orphan `apps/admin/src/components/Cases.test.tsx`; relative imports corrected.
- Releases server history fixture: seed count **63** with accepted **alpha.1–alpha.54** (+ `2026-11-08T05:18:57Z`); current descriptor remains **alpha.55** unpublished; release history source untouched.

## Checks (author)

- Parent attempt 48 FAIL retained as input evidence (web typecheck/focused, admin path miss, API idempotency 201).
- Local `node_modules` **not** visible in this worktree → parent-ready package typechecks and focused web/admin vitest **NOT_RUN**.
- No push/merge/deploy; no slots/env writes; no provider calls; no private body logs; no Git/runtime/DB.

## Pending gates

Independent Codex Sol Medium QA → Product CI → trusted merge/DEV → smoke → Owner UAT (`NOT_TESTED`). Do not announce DONE / PASS outside author-addressed harness fixes. Candidate pending QA/CI/DEV.
