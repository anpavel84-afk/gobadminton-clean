# Owner #448 — social directory/contact defaults ON (preserve explicit OFF)

From: Cursor Auto (`OWNER_SOCIAL_DEFAULTS_ON_PRESERVE_EXPLICIT_OPTOUT`, attempt 2 / exact pass1 candidate repair, base `464b3b1f3dc06683f430cb0fa613d4592cd62a3a`).
To: independent Codex Sol Medium QA → mandatory Product CI → trusted DEV → Owner UAT.
Status: SOURCE CANDIDATE only. **UAT = NOT_TESTED**. Refs #448. #445 stays open. No release metadata bump. No runtime/PROD deploy by author. Pass1 typecheck FAIL preserved in evidence (`EMAIL_BINDING_COOKIE` import); this candidate fixes that import only.

## Summary

Product defaults for new/missing normal-user social profiles: `directoryVisible=true`, `contactPolicy=requests`. Provenance column `directory_visibility_provenance` distinguishes:

| Value | Meaning |
| --- | --- |
| `owner_default` | Owner #448 product default ON (future inserts / migration enables) — not individual consent |
| `user_consent` | Visible row with real directory consent stamps |
| `user_opt_out` | Explicit directory hide via visibility API |
| `legacy` | Pre-#448 existing row without Owner-default label and without proven opt-out |

Automatic account-fallback public names use a small pure normalizer: email-shaped → «Игрок». Intentionally provided public `displayName` on patch is preserved. `ensureDefaultSocialProfile` never UPDATEs existing rows.

## Changed paths (allowed attempt-2 scope)

- `apps/api/migrations/0049_social_profile_defaults.sql`
- `apps/api/migrations/rollback/0049_social_profile_defaults.sql`
- `apps/api/src/profiles/social-profile-defaults.ts`
- `apps/api/src/profiles/profiles.service.ts`
- `apps/api/test/unit/social-profile-defaults.test.ts`
- `apps/api/test/integration/social448.defaults.test.ts`
- `docs/handoffs/social448-defaults.md`

0048 remains RESERVED (unmerged PG3 candidate) — not stolen.

## Migration behaviour (0049)

1. Column defaults: `directory_visible=true`, `contact_policy=requests`.
2. Add provenance nullable → label all existing `legacy` → visible+stamps → `user_consent` → remaining visible → `owner_default`; then `DEFAULT owner_default` + NOT NULL.
3. Demo cohort (operator-verified): reserved `d0f00001-*` + `demo:synthetic:foundation-v001` + `version=1` + `epoch=1` → enable directory+contact flags only; preserve city/name/consent/Radar/`social_eligible` (ineligible stays false); `version+1` once; CAS blocks reapply.
4. Pristine non-demo hidden: `legacy` + v1 + epoch1 + no stamps + not email-shaped + no retained completed `social_profile.visibility` receipt with `directoryVisible=false` → directory ON only (never flip non-demo contact closed). PROD v26 / epoch>1 / opt-out / modified version preserved by CAS.
5. Missing ACTIVE unrestricted users: INSERT safe name («Игрок» / non-email) + null city + ON/requests/`owner_default` / `ON CONFLICT DO NOTHING`.

Root operator captures DB backup + before/after/readback separately. No whole-DB restore by author.

## Rollback

Prefer **app-only** rollback retaining additive schema/data. Optional DB rollback **HOLD/refuses** if any visible row cannot meet the pre-#448 city+consent contract — never silently hide rows, forge consent, or delete profiles to force PASS.

## Author checks (operator runs; model env may lack deps)

```bash
pnpm --filter @gobadminton/api exec vitest run test/unit/social-profile-defaults.test.ts
# typecheck: social448 import must resolve EMAIL_BINDING_COOKIE from auth/email-security
pnpm --filter @gobadminton/api typecheck
RUN_DB_INTEGRATION=1 pnpm --filter @gobadminton/api exec vitest run \
  test/integration/social448.defaults.test.ts
```

Expect: typecheck clean for this import; email-shaped automatic name → Игрок; normal name kept; missing profile initializes once; explicit OFF retained; demo/pristine CAS-once enable; modified/opt-out untouched; no consent fabrication.

## Non-goals / unchanged

- No PROD/runtime/live DB/auth deploy, release bump, Git publish, C5, new framework/audit engine.
- Blocks, restrictions, Radar consent, and user privacy OFF remain authoritative.
- #445 remains open.
