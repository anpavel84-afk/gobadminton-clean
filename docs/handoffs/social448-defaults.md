# Owner #448 — release metadata alpha.8 (social defaults ON / preserve OFF)

From: Cursor Auto (`OWNER_SOCIAL448_RELEASE_METADATA`, attempt 1, base `f9ae4bbd3eb1af80d6445c57cbcd413921cde6e6`).
To: independent Codex Sol Medium QA → mandatory Product CI → trusted DEV → Owner UAT → separate PROD receipt.
Status: SOURCE CANDIDATE for `0.1.0-alpha.8` release descriptor only. **UAT = NOT_TESTED**.
Refs #448. Product source already on core `f9ae…` — this pass is **release metadata only**.
No production-logic edits. No Git/runtime/root/PROD deploy by author. Deployment NOT DONE.

## Scope this writer

Final application/release metadata for Owner #448 social directory/contact defaults.
Sets `CURRENT_APPLICATION_VERSION = 0.1.0-alpha.8` (API contract remains `0.22.0`), records
confirmed alpha.7 historical seed from delivered DEV receipt, and marks alpha.7 changelog
as factual DEV ACCEPTED (not a pending candidate). First named alpha.1 baseline kept literal.
PROD remains old alpha.2; #445 stays OPEN/retest pending; PG-3/PG-4 still not installed.

## Product policy (source approved both environments; install separate)

| Topic | Fact |
| --- | --- |
| New email/OAuth + missing ACTIVE | `directoryVisible=true`, `contactPolicy=requests` (catalog + DM) |
| Provenance | `owner_default` vs real consent / legacy / `user_opt_out` |
| Safe automatic name | no email-shaped public name; no fake city; no fabricated consent |
| Explicit OFF | preserved on login/reread; unknown modified legacy OFF untouched |
| Migration 0049 | pristine / verified synthetic defaults + missing ACTIVE only |
| Future OFF | not re-enabled |
| Unchanged | Radar / blocks / moderation; private email not auto-public; no geo/skill fabrication |
| Backfill honesty | verified initial synthetic/pristine → ON; explicit/ambiguous old OFF preserved; no guarantee all already-OFF reset |
| API wire | unchanged `0.22.0` |
| Deploy | Owner policy approved in source for DEV+PROD; actual installs need separate receipts |

## Alpha.7 already delivered (historical seed — do not claim pending)

| Fact | Value |
| --- | --- |
| Application version | `0.1.0-alpha.7` |
| Accepted source | `dd3839814fdb4ed8e05a64301e4aaaacff5cf0cc` |
| PR | #447 |
| Product CI | `41330759194` 7/7 PASS |
| DEV receipt | `r41331655353-a1` accepted `2026-11-01T17:33:52Z` |
| Digests | api `sha256:c11807e1d7d9661f284a64236288c98f8afc1a53d1029c59ec51c9121b9f3705`, web `sha256:25a6f51d6d5b5a5218a9b8e2ae84fdf3561dde274e1ff6705bb07501f1e9fba1` |
| Owner UAT | NOT_TESTED |

## Author operator checks already recorded (product source; not this metadata pass)

- social448.defaults disposable integration: 6 PASS
- ls01 profiles security: 11 PASS
- auth identity: 4 PASS
- helper unit: 6 PASS
- API/web typecheck PASS; Foundation PASS
- Earlier typecheck wrong `EMAIL_BINDING` import + PMA unsafe email fallback / legacy provenance findings repaired; history preserved

This metadata pass does **not** re-run product logic tests. No independent QA / CI / runtime yet — not Source PASS as install.

### Author checks this pass

- Deterministic source/changelog/seed sanity against delivered alpha.7 JSON + receipt:
  alpha.8 current unbound SHA, alpha.7 historical ACCEPTED facts, first-alpha baseline literal.
- Trusted operator should run:
  `pnpm --filter @gobadminton/web exec vitest run test/releases.test.tsx test/releases-server.test.ts`

## CURRENT_NAMED_RELEASE delta (alpha.8 candidate)

- New/missing profiles: catalog + DM defaults ON with `owner_default` provenance.
- Safe automatic name without email / fake city / fake consent.
- Explicit OFF preserved; migration 0049 scoped; legacy modified OFF untouched.
- `source_sha`: **null** until trusted ACCEPTED (unbound).
- DEV then PROD = separate future receipts; do not claim installed.

## Required next gates (handoff)

1. Independent Codex Sol Medium QA (release metadata + retained product facts).
2. Mandatory Product CI.
3. Trusted DEV install + backup/readback for migration 0049 (operator, not author).
4. Owner UAT (explicitly NOT_TESTED until then).
5. Separate Owner decision + receipt for PROD (currently alpha.2).

## Input materials read (this pass)

| Material | Delivered path | SHA256 | Read |
| --- | --- | --- | --- |
| alpha7 history seed | `…/design-inputs/alpha7-history-seed-for-alpha8.json` | `a6583e9463fc7ad546c615a7faccb34f1b81907c8df756a81987ae2c386b3132` | Yes — exact alpha.7 HistoricalReleaseSeed |
| accepted deploy receipt | `…/design-inputs/accepted.json` | `62ebd0fdf7fb484d9f1418b8e222902a078b8dde17dc528d57216cd6999b9945` | Yes — `r41331655353-a1` / SHA `dd383981…` / digests |

## Changed paths (exact allowed only)

- `apps/web/src/lib/releases.ts`
- `apps/web/test/releases.test.tsx`
- `apps/web/test/releases-server.test.ts`
- `docs/releases/CHANGELOG.md`
- `docs/handoffs/social448-defaults.md`

## Non-goals

- No production-logic / SMTP / unrelated feature enablement; no Git/runtime/root/PROD/C5/secrets.
- No new framework, scheduler, or full test matrix.
- No rewrite of older historical seeds beyond factual alpha.7 ACCEPTED status already delivered.
- No reset of old UNKNOWN/attempts; #445 stays open until Go Bad full PASS.
