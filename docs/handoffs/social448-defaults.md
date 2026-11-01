# Owner #448 — P2 narrow repair: ensureDefaultSocialProfile eligibility guard

From: Cursor Auto (`OWNER_SOCIAL_DEFAULTS_ON_PRESERVE_EXPLICIT_OPTOUT`, attempt 3, base `c3b9126d0c09ea5369522f19de29c045c44fe52c`).
To: independent Codex Sol Medium delta-QA → mandatory Product CI → trusted DEV → Owner UAT.
Status: SOURCE CANDIDATE (narrow repair). **UAT = NOT_TESTED**. Refs #448.
Ops P1 (PROD Radar preview env copy) is **out of this writer scope** — trusted PMA separately.
No Git/runtime/root/PROD by author. Deployment NOT DONE.

## QA FAIL preserved (pass 1)

| Sev | Finding | This pass |
| --- | --- | --- |
| P2 | OAuth inactive / restricted `getOwn` could call `ensureDefaultSocialProfile` and materialize a visible profile; migration 0049 filters ACTIVE + unrestricted | **Fixed** in central helper |
| P1 | PROD Ops fragment copies Radar preview vars from DEV | **Not touched** (allowed_paths exclude Ops; PMA) |

## Repair

`ensureDefaultSocialProfile` now uses atomic `INSERT … SELECT … ON CONFLICT DO NOTHING` matching migration 0049 missing-ACTIVE insert:

- `users.status = 'active'`
- no effective `account.access` / `profile.public` / `social.directory` restriction
- clock: `revoked_at IS NULL` + `starts_at <= clock_timestamp()` + `expires_at > clock_timestamp()`
- existing rows unchanged (preserves OFF); future OFF not re-enabled
- all callers (OAuth identity, email signup, `getOwn`) share the same helper — no per-branch bypass

Auth status rejection / own-read empty-fallback behavior unchanged; helper does not grant access or fake a guard pass.

## Author checks (this pass)

- Unit `social-profile-defaults.test.ts`: **6/6 PASS** (guarded SELECT SQL + safe name)
- API `tsc --noEmit`: **PASS** (pinned Node 24.21.0)
- Integration `social448.defaults.test.ts`: negatives added (inactive + each of three capabilities + existing OFF); retained positives unchanged — **not executed here** (no disposable PostGIS/docker socket in author sandbox)
- No Ops/metadata/runtime/PROD/Git; no full suite expansion

### Operator-addressed (author cannot claim)

- `RUN_DB_INTEGRATION=1` disposable DB for `social448.defaults.test.ts` (incl. new negative block)
- Product CI 7/7
- Independent delta-QA on this repair only
- Ops P1 PROD fragment (PMA)

## Changed paths (exact allowed only)

- `apps/api/src/profiles/social-profile-defaults.ts`
- `apps/api/test/unit/social-profile-defaults.test.ts`
- `apps/api/test/integration/social448.defaults.test.ts`
- `docs/handoffs/social448-defaults.md`

## Input materials read

| Material | Delivered path | SHA256 | Read |
| --- | --- | --- | --- |
| QA pass 1 final | `…/design-inputs/final.txt` | `984dbeaf1db1cfe0a842457e992b09049b0c17afc5f867c84c8f55d602d58686` | Yes — P2 helper guard + P1 Ops out of scope |

## Non-goals

- No Ops/PROD/Git/runtime/C5/secrets; no new framework; no rewrite of historical admissions; no huge test matrix.
