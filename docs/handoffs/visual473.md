# Handoff — #473 role review eligibility copy (source only)

**Assignment:** `OWNER_COMPLETION_VISUAL473_ROLE_REVIEW_ELIGIBILITY_COPY_ONLY`
**Author:** cursor:auto · attempt 1 · base `360001c6231157f30fdf11606ef8111c291fb099` (DEV alpha.26)
**App candidate:** `0.1.0-alpha.27` · API unchanged `0.33.0` · `source_sha` / release receipt **unknown** until acceptance · UAT=**NOT_TESTED**
**Refs:** #473 · original PR #472 · route `/games/d0f00020-0000-4000-8000-000000000005`
**Design:** `https://files.anpavel.ru/projects/gobadminton/design/style-guide/reviews/organizer-trainer/20261103-astra-v2/index.html` (verified local copy used)

## Exact scope (allowed paths only)

1. **Role panels** — compact neutral eligibility hint in both `ready` and `unavailable` states: write only about one's past game/training with confirmed participation and attendance. No viewer-specific eligible/ineligible claim; no private history reveal; no extra API reads; `canWrite` unchanged; unavailable still does not offer write.
2. **alpha.20 history** — replace ambiguous «отзыв публикации» with «автор может снять свой отзыв с публикации». Other released facts untouched.
3. **alpha.27 current notes** — solely these two repairs; append exact accepted alpha.26 seed from provided material; baseline counts 35 / switched-off 6 / unnamed 2; history rows 30 / deployments 35.
4. **Targeted checks** — render both panel states; update existing release current/seed expectations only.

## Paths touched

- `apps/web/src/components/consumer/games/RoleReputationPanel.tsx`
- `apps/web/test/role-reputation.test.tsx`
- `apps/web/src/lib/releases.ts`
- `apps/web/src/lib/releases.test.ts`
- `apps/web/test/releases.test.tsx`
- `apps/web/test/releases-server.test.ts`
- `docs/handoffs/visual473.md`

## Status

Source candidate only. No auth/API/schema/DB/Safety/role-moderation changes. No fixtures/secrets/sessions/netcalls. Author does not deploy or Git-publish. Independent Sol Medium QA, Product CI, merge `dev`, server DEV ACCEPTED — Root PMA. Preserve UNKNOWN and history. Mode B / AGY READY not claimed. PROD forbidden.
