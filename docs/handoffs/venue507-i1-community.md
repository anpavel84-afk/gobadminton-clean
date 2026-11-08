# Handoff — #507 I1 Admin Cases community UI (bounded repair)

**Author:** Cursor Auto
**Admission (attempt 14):** `OWNER507_I1_QA13_EXACT_CSRF_MEMORY_AND_SPLIT_MOUNTED_IDENTITY_TESTS`
**Base SHA (frozen admission):** `f4571eb608ee6997df1d87e4802f09b598623ea2` (NOT replay of source1/source7)
**Phase:** SOURCE partial — QA13 exact CSRF in-memory identity + split mounted dimension tests
**Prior:** QA13 FAIL on CSRF fingerprint collision + combined session-dimension mount test; attempts 1–13 retained; source1/source7 UNKNOWN preserved; QA12 privacy/capability fixes retained

## This attempt scope (SOURCE)

Allowed paths only:
- `apps/admin/src/components/VenueCommunityCases.tsx`
- `apps/admin/test/venue-community-cases.test.tsx`
- `docs/handoffs/venue507-i1-community.md`

### Implemented (attempt 14 — QA13 two MEDIUM findings)

1. **Exact CSRF in memory:** removed 32-bit FNV `fingerprintToken`. Auth read/operation context holds the exact CSRF string only in memory and compares it with `===`. Non-secret `authContextKey` omits CSRF so keys never contain the token. No SHA upgrade; no render/log/cookie/localStorage of tokens or token-bearing keys. Full Case/report/status/version/assignment + principal/sessionId/version/roles/CSRF/fresh bind preserved; privacy immediate-render guard, delayed-response drop, UNKNOWN key/body/context HOLD and no-RPC under changed context retained; new commands keep full version/identity guard.
2. **Split mounted identity tests:** independent RTL/jsdom rerenders for principalId alone, sessionId alone, session version alone, CSRF alone, roles alone, Case assignment alone, Case version alone; fresh=false denial preserved. Synthetic-only FNV-collision CSRF pair (`synthetic-only-csrf-pgo5pjfw7db2i1` / `synthetic-only-csrf-ffj9vytjhh3qfg`) must clear private DOM/rationale/capability and block old UNKNOWN retry POST. Existing real RTL deps; no mock React hooks / source-string substitutes / new packages.

### Explicit NOTDONE / NOT claimed

- Whole I1 **NOT READY** / SOURCE partial only — no CI/DEV.57 acceptance; DEV remains alpha.56 until separate #521 release; no #507 release claim
- Consumer / F4 / F5 — next after this tiny repair (separate writers); I2 / I3 later
- Product CI; DEV release/smoke; Owner UAT; live authorized Admin session (**NOT_TESTED**; synthetic DOM ≠ real session)
- Mode B binding / AGY author — not claimed
- source1/source7 UNKNOWN preserved; no receipt reset; no paid call replay; no PROD; no backend/API/roles/session semantics / architecture / deps change; #521 branch/release files untouched

## Checks this author pass

- Targeted Admin mounted community tests + typecheck + lint; reuse old Cases parent coverage where unchanged
- No source publish / Git / deploy / live backend writes / real Admin session claim

## Preserve

- Attempt 1 HOLD / UNKNOWN / costs; attempts 2–13 history; QA11 PASS backend proof; QA12 accepted privacy findings; QA13 FAIL receipt + synthetic FNV collision fixture retained as input
- Accepted report intake/merge/source-read/decide contracts; Admin BFF community-reports path unchanged
- Old review/message Cases source handling unchanged
