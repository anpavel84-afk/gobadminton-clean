# Owner #448 — social directory/contact defaults ON (preserve explicit OFF)

From: Cursor Auto (`OWNER_SOCIAL_DEFAULTS_ON_PRESERVE_EXPLICIT_OPTOUT`, attempt 1, base `dd3839814fdb4ed8e05a64301e4aaaacff5cf0cc`).
To: independent Codex Sol Medium QA → mandatory Product CI → trusted DEV → Owner UAT.
Status: SOURCE CANDIDATE only. **UAT = NOT_TESTED**. Refs #448. #445 stays open. No release metadata bump. No runtime/PROD deploy by author.

## Summary

Product defaults for new/missing normal-user social profiles: `directoryVisible=true`, `contactPolicy=requests`. Provenance column `directory_visibility_provenance` distinguishes Owner #448 product default (`owner_default`) from individual directory consent (`user_consent`) and explicit hide (`user_opt_out`). Owner default may be ON with unknown city and **without** forged consent stamps. Explicit OFF per flag is never overwritten by ensure/login/GET.

## Changed paths

- `apps/api/migrations/0049_social_profile_defaults.sql`
- `apps/api/migrations/rollback/0049_social_profile_defaults.sql`
- `apps/api/src/profiles/social-profile-defaults.ts`
- `apps/api/src/profiles/profiles.service.ts`
- `apps/api/src/auth/email-auth.service.ts`
- `apps/api/src/auth/identity.service.ts`
- `apps/web/src/components/consumer/pages/ProfilePage.tsx`
- `apps/api/test/unit/social-profile-defaults.test.ts`
- `apps/api/test/integration/social448.defaults.test.ts`
- `apps/api/test/integration/ls01.profiles-safety.test.ts`
- `apps/api/test/integration/auth.identity.test.ts`
- `docs/product/PLAYER_BROWSING_STYLE_GUIDE.md` (narrow #448 default policy note)
- `docs/handoffs/social448-defaults.md`

0048 remains RESERVED (unmerged PG3 candidate) — not stolen.

## Behaviour

| Path | Effect |
| --- | --- |
| Email / OAuth user create | `ensureDefaultSocialProfile` INSERT … ON CONFLICT DO NOTHING |
| Existing login / missing profile | same ensure (no UPDATE) |
| `GET /me/social-profile` missing row | one-time ensure then reload |
| User directory OFF | provenance `user_opt_out`; survives ensure/retry/login |
| User directory ON without inventing city/consent | provenance `owner_default` |
| Explicit consentPolicyVersion on visibility ON | provenance `user_consent` + stamps |
| ProfilePage | city no longer a catalogue-visibility prerequisite; does not invent consent version |

## Author checks (operator runs; model env may lack deps)

```bash
pnpm --filter @gobadminton/api exec vitest run test/unit/social-profile-defaults.test.ts
RUN_DB_INTEGRATION=1 pnpm --filter @gobadminton/api exec vitest run \
  test/integration/social448.defaults.test.ts \
  test/integration/auth.identity.test.ts \
  test/integration/ls01.profiles-safety.test.ts
```

Expect: new email/OAuth both ON; no leaked email / fake city / fake consent; missing profile initializes once; explicit OFF retained across second ensure; directory hide / block / ineligible actor stay negative. Do not expand into full matrix.

## Historical backfill (OPS — not in this migration)

Migration does **not** bulk-enable existing `directory_visible=false` rows.

| Cohort signal | Treatment |
| --- | --- |
| `directory_visible=false`, `version=1`, no opt-in stamps, epoch pristine | likely implicit old default — candidate for later scoped ON after operator review |
| `social_action_epoch > 1` from privacy transitions | preserve OFF |
| Idempotency `social_profile.visibility` with `directoryVisible=false` | treat as explicit OFF |
| `contact_policy=closed` on first patch | preserve closed unless proof it was only implicit |
| Response-body records with 24h TTL | **not** proof of no historical choice |
| Ambiguous OFF | **preserve** and report cohort; operator inspects scoped set before any approved UPDATE |

No per-login reset. No Radar/looking/friend/session auto-creation.

## Non-goals / unchanged

- No PROD/runtime deploy, release bump, SMTP enablement, other PG features, new UI redesign, C5, architecture/framework/queue.
- Blocks, restrictions, Radar consent, and user privacy OFF remain authoritative.
- #445 remains open.
