# Handoff — #506 DEV-only temporary moderation quantity-quota pause (attempt 30)

## Assignment

- Issue: #506 · `OWNER506_DEV_QUOTA_TRUE51_METADATA_AND_TEST_TYPE_EXPIRY_REPAIR`
- Owner continuation after known-completed `4962fc1b2c0014d52c9c818cdf4b1a18fed5ae98`
- Actual DEV.50 ACCEPTED: `3153e3cd1fd1e1f1936e60ea27f7632589701bea` / `r42424550031-a1` (Full Product CI `42423713323`)
- Author: Cursor Auto · sole writer
- Pass scope: **two concrete repairs + release.51 metadata only**
- Not claimed: DEV.51 install, independent QA PASS, CI 7/7, PROD, B2/C/D/#507, whole moderation DONE

## What changed (attempt 30)

| Path | Change |
| --- | --- |
| `apps/api/src/moderation/moderation-quota-policy.ts` | Narrow `ModerationQuotaQueryPort` `(sql, params)` method port; real `Pool` still compatible; Owner hard deadline unchanged |
| `apps/api/test/unit/moderation-quota-policy.test.ts` | Stub matches port; asserts production-style binding of exact Owner `2027-01-01T00:00:00.000Z` |
| `apps/api/test/integration/moderation-quota.disposable.test.ts` | Active-pause SQL branches use future `pauseUntil` relative to own DB `now()`; before/at/after stay relative; production caller still uses Owner constant |
| `apps/web/src/lib/releases.ts` | CURRENT → `0.1.0-alpha.51` quantity-pause user copy; trusted alpha.50 seed archived exact; 49 and earlier untouched; `source_sha` null / UAT NOT_TESTED |
| `apps/web/src/lib/releases.test.ts` | Literals for 51 + exact 50 seed fields |
| `apps/web/test/releases.test.tsx` | Same; seed length 54 / deployments 59 |
| `apps/web/test/releases-server.test.ts` | Fifty-nine deployments; accepted_at includes `2026-11-07T23:32:15Z` |
| `docs/decisions/CONTENT_MODERATION_V2_COVERAGE_V001.md` | B1c actual 50 ACCEPTED; quota 51 SOURCE candidate not DEV; B2/C/D/#507 pending |
| `docs/handoffs/moderation506-dev-quota-pause.md` | This handoff |

## Discrimination (unchanged policy)

- Active only when trusted server config is `NODE_ENV=production` + `APP_ENV` mvp|stage + both PUBLIC origins exact `https://dev.gobadminton.ru`.
- Production `ContentModerationService` still always passes Owner hard deadline `2027-01-01T00:00:00Z` (not dynamically extended for tests).
- Request Origin / Admin QA flags do not admit pause.
- No new env/date kill-switch; Owner ADR not rewritten.

## Prior attempt 29 (preserved)

- Functional body: SQL disposable PASS6 + legacy image PASS36 + public text PASS5 + units PASS28
- API typecheck FAIL retained (`TS2345` Pool.query overload vs unit stub) — repaired here without dropping tests
- Paid/FAIL history of 29 not replayed

## Author checks (this pass)

- API typecheck + unit `moderation-quota-policy`
- Web release co-located + `test/releases*` Vitest
- Disposable suite still gated on `RUN_DB_INTEGRATION=1` (relative DB deadlines)
- No runtime/network/live DB/Git/deploy/PROD in this author pass

## Remaining (parent)

1. Independent QA (other model) on this delta.
2. Full Product CI → guarded DEV; release-agent binds SHA/receipt only after ACCEPTED.
3. Parent post-release import counter >50 verifies live path.
4. Owner / real Admin UI / physical iPhone UAT = NOT_TESTED.
5. B2/C/D/#507 remain pending.
