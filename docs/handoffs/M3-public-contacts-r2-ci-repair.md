# M3-CONTACTS-R2 #142 — CI repair handoff

From: source author. To: integrator / independent QA. Date: 2026-10-21.
Status: READY_FOR_REVIEW; execution NOT_TESTED, no independent QA/live/UAT PASS.

Exact repair base: `928ec4970849c33907c44ff8f577f4e1c594acb1`, branch
`automation/issue-142`, initial tracked diff empty. Original task base remains
`f50eb6f0f1703efabe86ef1de5b8f42948fc4497`. Scope: only failures reported for
CI run 39508594673 attempt 1; keep the existing candidate. Assignment supplied
prior independent QA PASS for 928ec497; that verdict does not cover this repair.
CI failure details below are PM_REPORTED, not independently fetched offline.
No commit, push, git metadata, automation, install, network, SQL/DB execution,
services, secrets or deployment changes were made. Publication and exact future
candidate permalink belong to the integrator.

## Repair

- API TS2352: full typed AdminActor fixture includes principal and session;
  removed the incomplete actor assertion, no unknown/any workaround.
- API/web no-control-regex: independent character-code predicates reject the
  same pre-trim U+0000–001F, U+007F–009F and backslash. WHATWG normalization,
  ASCII/punycode serialization, post-serialization limits, SQL NULL binding and
  all prior #134 protections remain unchanged.
- Web test line 26: the real apiFetch resolves API_BASE_URL before invoking the
  mocked fetch. Set a synthetic loopback API_BASE_URL using vi.stubEnv and restore
  it after each test. Keep the success, object-preservation, order and link-prop
  assertions; add exact rendered anchor labels and tel rel assertion.
- DB upgrade fixture: explicitly supplies lifecycle_state='unverified', matching
  the existing NOT NULL lifecycle schema. No lifecycle migration/schema changes.
- N-1 schema0037: direct public_contacts references fail at SQL parse time before
  mapping. Catalog, detail/alias, fuzzy and proposal RETURNING now extract only
  `to_jsonb(row)->'public_contacts' AS public_contacts`. An absent key yields SQL
  NULL on 0037; 0038 returns its stored public object. Only that key is projected,
  never private contacts. Existing tolerant read normalization still applies.
  The old cover-credit test and migration0037 were not changed or skipped.

Other candidate changes are retained. D1–D3 migration/DB assertions remain gated;
D4 retains the real Sheet/client test; D5 hooks/handlers/CTA/layout/CSS and both
existing Sheet test files are unchanged. No test, lint rule or layout assertion
was disabled or weakened. Admin public edits still require 0038; N-1 compatibility
here is for public reads/proposal projection, not pre-migration admin writes.

## D6 author command attempts

These are author command attempts, not self-QA or independent acceptance.
Commands ran separately from repository root, without installation/network.

| Command | Exit | Evidence |
|---|---:|---|
| `COREPACK_ENABLE_NETWORK=0 pnpm --filter @gobadminton/web exec tsc -p tsconfig.json --noEmit --incremental false` | 1 | NOT_TESTED: Corepack cannot obtain offline pnpm-10.18.0.tgz; compiler never starts |
| `COREPACK_ENABLE_NETWORK=0 pnpm --filter @gobadminton/api exec tsc -p tsconfig.json --noEmit` | 1 | Same offline dependency failure |
| `COREPACK_ENABLE_NETWORK=0 pnpm --filter @gobadminton/web exec vitest run --no-cache test/venue-public-contacts.test.tsx` | 1 | Same; Vitest never starts |
| `RUN_DB_INTEGRATION=0 COREPACK_ENABLE_NETWORK=0 pnpm --filter @gobadminton/api exec vitest run --project integration --no-cache test/integration/venue-contacts.test.ts test/integration/migration.smoke.test.ts` | 1 | Same; Vitest never starts, no DB execution |
| `node packages/contracts/scripts/check-openapi.mjs` | 1 | NOT_TESTED: ERR_MODULE_NOT_FOUND, @apidevtools/swagger-parser |
| `git diff --check` | 0 | No whitespace errors |

Exact Corepack message: `Network access disabled by the environment; can't reach
https://registry.npmjs.org/pnpm/-/pnpm-10.18.0.tgz`.
Lint and DB execution NOT_TESTED; no CI rerun or network request initiated.

## STYLE_GUIDE_PARITY / continuity / rollback

Read Owner Style Guide first decision and textual map popup decision. This repair
changes only pure validation helpers in VenueSheet, no composition or styling.
BottomSheet/ListRow parity remains UNVERIFIED: requested
`/opt/gobadminton-clean-qa/style-guide/src/App.tsx` unavailable (ENOENT), operations
Style Guide document also absent. This is not STYLE_GUIDE_GAP or Owner override.
Browser UNVERIFIED. Original handoff and previous historical notes remain intact.

Application rollback retains 0038 column/data; this repair adds no migration.
Next bounded action: integrator publishes a new exact candidate, then independent
QA and full CI review that exact SHA, including DB and unchanged cover-credit
regression. Do not rerun unchanged 928ec497 as evidence for repaired source.
Integrator adds durable GitHub artifact permalinks after authorized publication.
