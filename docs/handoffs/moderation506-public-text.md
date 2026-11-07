# Handoff · Issue #506 · MOD-V2-A public text (author pass 8 · TEST-ONLY CI database fixtures)

Bounded TEST-ONLY repair on frozen base
`9f2f082e3cf5da9a4ca2027e0ea86977046fccd7`
(OWNER506_A_PRODUCT_CI_DATABASE_FIXTURE_COMPATIBILITY, attempt 8).
Source remains accepted by independent QA (PR #508). Prior FAIL/receipts
preserved. No DONE / QA / CI / DEV / UAT claims from this source pass.

## Proven Product CI failure (input materials)

CI `42388403418` database job FAIL; other 6 jobs PASS.
Summary sha256 `c3801e05c3fd0fbd1147d12e4a3d1c9b97a5e8ee1cce11cbb0b4bd1e179e138c`.
Excerpts sha256 `cca20604ab55c4da073961feceb13ffaf16c59a9690cc7541b105a093daf6c8f`.

Exact failing integration files (14) match Owner assignment. Known causes from
summary/excerpts:

1. Partial disposable migration cuts omitted `0061_content_moderation_text` →
   HTTP 500 `relation content_moderation_bindings does not exist` on game draft.
2. Stale automatic OAuth/account name expectations vs accepted trusted `Игрок`.
3. Shared synthetic actors exhausted text moderation budget (10 / 15 min) → 429
   on `ensureOpenProfile` / `publishGame` (not a production-cap defect).

## Pass-8 concrete repair (allowed paths only)

### Migration fixture compatibility

- `migration.smoke.test.ts` — expected applied list includes
  `0061_content_moderation_text`; asserts `content_moderation_bindings` present
  and expanded approval surface allowlist; transactional rollback of
  `rollback/0061_content_moderation_text.sql` drops bindings and restores prior
  surface check (then ROLLBACK so smoke DB stays at full head).
- `game-attendance.disposable.test.ts` — after N-1 cut `<0047`, also apply
  `0061_content_moderation_text.sql` (current GamesModule text publication).
- `game-outcomes.disposable.test.ts` — apply `0061` with `0045`; ledger count
  after rolled-back `0042` is **43** (0001–0041 + 0045 + 0061).
- `game-recommendations.disposable.test.ts` — apply `0061` after `0045`; head
  count **43** with explicit `0061` id assertion.

No applied historical migration SQL edited. No production schema weaken.

### Automatic name → `Игрок`

- `auth.identity.test.ts`, `social448.defaults.test.ts`, `lsr1.radar-presence.test.ts`,
  `owner-a.create-setup.test.ts` — stale automatic public-name expectations now
  expect trusted `Игрок` / `SOCIAL_PROFILE_SAFE_DISPLAY_NAME`. OAuth anti-leak
  kept (provider name must not appear on social wire).
- `game-feedback.disposable.test.ts` — seed explicit `player_social_profiles`
  display names in `actor()` so `recipientDisplay` still asserts concrete
  `Ilya` (not generic any-name). Privacy/permission assertions untouched.

### Synthetic text-budget isolation (disposable DB only)

- `formal-invitation-privacy-authority-boundary.test.ts`, `ls03`, `ls04`,
  `ls05`, `lsr2` — `beforeEach` clears `content_moderation_rate_budgets`.
- `publishGame` helpers in formal / ls04 / ls05 / lsr2 also clear the owner's
  text budget before each unique draft (long single tests exceed 10 creates).
- Production caps, business rate-limit behaviour, and dedicated budget tests
  elsewhere are unchanged. No skip / disable / cap raise.

## Author sandbox status

- Allowed paths only: 14 integration tests + this handoff.
- No production / deps / config / CI gates / architecture / release / provider /
  credentials / Git / runtime / live data.
- Parent owns: API types/lint, representative isolated migration/name/budget
  cases, independent delta review of fixture changes, full Product CI again.
- No fake PASS / CI / DEV / UAT from author. #406 remains separately serialized.

## Parent next (exact)

```bash
# From CLEAN repo after trusted integrate of pass-8 allowed paths:
cd apps/api
# Parent: tsc / lint as owned
# Representative disposable migration smoke + name + budget fixtures, then
# independent delta QA on fixture-only diff, then Product CI → DEV (UAT=NOT_TESTED).
```

Focus checks for delta QA:

- Partial cuts include `0061`; no HTTP 500 on `content_moderation_bindings`
- Smoke expected list + bindings + rollback txn assertions
- Automatic names → `Игрок`; seeded feedback still shows `Ilya`
- No 429 from shared synthetic draft/profile churn; caps not raised
- Production sources untouched

## Still not claimed

- Overall PASS/DONE from source author
- Independent QA / Product CI / DEV ACCEPTED
- Mode B binding / AGY author / PROD
