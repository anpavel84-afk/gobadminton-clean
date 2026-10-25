# M3-CONTACTS-R2 #142 — upgrade fixture correction

From: source author. To: integrator / independent QA. Date: 2026-10-21.
Status: READY_FOR_REVIEW; runtime NOT_TESTED; no independent QA/live/UAT PASS.

Actual starting HEAD: `3436fca920599bcbef92806f517c7221ec48ebe4`
(`automation/issue-142`), initial tracked diff empty. Assignment's original base
is `f50eb6f0f1703efabe86ef1de5b8f42948fc4497`; this follow-up preserves the
implementation already present at actual HEAD. No Git metadata/source publication,
network, install, SQL/DB, service, automation or deployment actions performed.
Integrator supplies future candidate exactSHA and durable GitHub permalink.

## Scope and evidence

Independent QA supplied FAIL at starting HEAD: the D1/D3 upgrade fixture omitted
normalized_name/normalized_address, required NOT NULL by migration 0018 without
default. Source inspection confirms that prerequisite. The 0037→0038 fixture now
supplies both using existing venue_normalize_v1 with its name/address literals.
Private fixture values and every assertion remain unchanged. No production source,
SQL migration, contract, frontend or existing handoff was edited.

D1/D3: source prerequisite corrected; upgrade/CHECK/ledger assertions remain gated
and unexecuted. D2/D4: existing tests retained; execution unavailable below.
D5: VenueSheet and both existing interaction test files unchanged in this follow-up.
D6 author commands below are execution attempts, not independent QA.
D7: this additive handoff preserves the original M3-public-contacts-r2.md record.

## Commands from repository root

| Command | Exit | Output / status |
|---|---:|---|
| `COREPACK_ENABLE_NETWORK=0 pnpm --filter @gobadminton/web exec tsc -p tsconfig.json --noEmit --incremental false` | 1 | NOT_TESTED: Corepack requires pnpm-10.18.0.tgz; network disabled |
| `COREPACK_ENABLE_NETWORK=0 pnpm --filter @gobadminton/api exec tsc -p tsconfig.json --noEmit` | 1 | NOT_TESTED: same Corepack failure; compiler never started |
| `COREPACK_ENABLE_NETWORK=0 pnpm --filter @gobadminton/web exec vitest run --no-cache test/venue-public-contacts.test.tsx` | 1 | NOT_TESTED: same Corepack failure; Vitest never started |
| `RUN_DB_INTEGRATION=0 COREPACK_ENABLE_NETWORK=0 pnpm --filter @gobadminton/api exec vitest run --project integration --no-cache test/integration/venue-contacts.test.ts test/integration/migration.smoke.test.ts` | 1 | NOT_TESTED: same Corepack failure; DB disabled |
| `node packages/contracts/scripts/check-openapi.mjs` | 1 | NOT_TESTED: ERR_MODULE_NOT_FOUND, @apidevtools/swagger-parser |
| `git diff --check` | 0 | no output; repeated after handoff creation |

Exact Corepack reason: `Network access disabled by the environment; can't reach
https://registry.npmjs.org/pnpm/-/pnpm-10.18.0.tgz`. No dependencies installed.
DB NOT_TESTED; SQL was only read as source, never executed.

## Preserved boundaries and continuity

URL-policy/SQL boundary unchanged: WHATWG normalizes write/read URLs to ASCII
href with post-serialization length limit; SQL checks canonical storage form.
SQL NULL clearing, optional output compatibility and private-contact protections
are unaffected by this fixture-only correction. Existing original handoff records
implementation details and PM_REPORTED / UNVERIFIED_BY_THIS_REVIEW history.

STYLE_GUIDE_PARITY: UNVERIFIED as previously recorded; no visual changes here.
Browser UNVERIFIED. No new STYLE_GUIDE_GAP or OWNER_VISUAL_OVERRIDE asserted.

Rollback this follow-up by reverting the two fixture column/value additions and
this handoff. Application rollback still retains 0038 column/data as documented
in the original handoff; no destructive migration is introduced.

Next bounded action: integrator publishes a candidate with exactSHA/permalink;
independent QA executes D1–D6 in a provisioned environment, including the gated
upgrade path. This source correction does not establish DB acceptance.
