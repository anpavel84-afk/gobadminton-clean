# Handoff — #506 DEV-only temporary moderation quantity-quota pause (attempt 29)

## Assignment

- Issue: #506 · `OWNER506_DEV_ONLY_TEMPORARY_QUANTITY_QUOTA_PAUSE_UNTIL_20270101`
- Owner: comment `6714311820` · Refs #488
- Author: Cursor Auto · base `3153e3cd1fd1e1f1936e60ea27f7632589701bea` (merged PR #514 / source.50)
- Pass scope: **functional + tests + Owner decision only**
- Not claimed: release catalogue.51, DEV.50 receipt, independent QA PASS, CI 7/7, PROD, B2/C/D/#507

## What changed

| Path | Change |
| --- | --- |
| `apps/api/src/moderation/moderation-quota-policy.ts` | Versioned helper: exact trusted DEV env guard, hard expiry `2027-01-01T00:00:00Z`, `reserveModerationAttemptRow` with quantity OR-group separate from `next_allowed_at` |
| `apps/api/src/moderation/moderation.service.ts` | `reserveAttempt` uses helper; still increments; no early return without reservation |
| `apps/api/test/unit/moderation-quota-policy.test.ts` | Env/origin fail-closed; before/at/after expiry; SQL grouping assertion |
| `apps/api/test/unit/text-moderation.test.ts` | Local/test pause off + provider Retry-After unaffected |
| `apps/api/test/integration/moderation-quota.disposable.test.ts` | Synthetic DB: over-quota increments under DEV pause; deadline/non-DEV/`next_allowed_at`; never provider I/O |
| `docs/decisions/OWNER_DECISION_DEV_MODERATION_QUOTAS_PAUSE_20270101_V001.md` | Binding Owner decision |
| `docs/handoffs/moderation506-dev-quota-pause.md` | This handoff |

## Discrimination (no new env/deploy vars)

- Active only when trusted server config is `NODE_ENV=production` + `APP_ENV` mvp|stage + both PUBLIC origins exact `https://dev.gobadminton.ru`.
- Actual DEV is `APP_ENV=mvp` (not `dev`).
- Expiry via SQL `now() < $pauseUntil` with production binding the Owner constant.
- Request Origin / Admin QA flags do not admit pause.

## Author checks

- Unit: `moderation-quota-policy` + targeted `text-moderation` (and related moderation unit if run).
- Disposable suite gated on `RUN_DB_INTEGRATION=1` + dedicated DB name `gobadminton_moderation_quota_disposable` (or hosted Actions recipe).
- No runtime/network/live DB/Git/deploy in this author pass.
- Coverage matrix not edited (B2/C/D/#507 still pending; A/B1* statuses unchanged).

## Remaining (parent)

1. Independent QA (other model) on this delta.
2. Full Product CI → guarded DEV after actual.50 receipt; release-agent follow-up for.51 metadata only then.
3. Parent post-release import counter >50 verifies live DEV path.
4. Owner UAT = NOT_TESTED until after DEV ACCEPTED.
