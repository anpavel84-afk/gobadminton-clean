# Handoff — #501 Visual QA push discoverability / label (source only)

**Assignment:** `OWNER_VISUAL501_NARROW_COPY_PRUNE_AND_RELEASE43`
**Author:** cursor:auto · attempt 2 · base `e25fe3ff0da796cf8c974e49c5d0e0266c4a32b7`
**Refs:** #501 · intermediate source `42156972` (kept, not published) · GoBad comments 6705710554 / 6706369141
**Facts:** alpha.40/41 item2 profile button wrap **PASS**; item1 settings discoverability **FAIL**
**Route:** `/profile/settings` (push)
**App candidate:** **0.1.0-alpha.43** / API **0.37.0** — `source_sha` null · Owner UAT **NOT_TESTED** until real acceptance
**UAT:** Owner / Go Bad / physical iPhone = **NOT_TESTED**

## Scope (narrow copy + prune)

1. General block heading / `aria-label`: «Уведомления» (eyebrow «Настройки»).
2. Master OFF / pre-consent: discoverability hint that after enabling notifications the user can **separately** choose invitations, applications/cancellations, and «Подведите итоги».
3. Visible canonical iPhone Home Screen helper before the permission gesture (no new popup/flow/component).
4. Message-consent button copy unchanged: «Включить уведомления о сообщениях». Canonical event toggles stay inline (optional `eventPreferences?.[key]`, default OFF); no helper extract; no consent/session/API/SW/client behavior changes.
5. `players.css` restored to source-base `fd917` for `.editable-section-header` (no new UI styles; do **not** claim profile button CSS repair — already PASS on alpha.40/41).

## Not claimed

- Profile «Изменить» wrap repair (already accepted).
- New notification types or permission models.
- Alpha.42 venue WebP / Slow4G receipts (historical ACCEPTED PR #503 / `a72905b8` / `r42369478229-a1` only).

## Paths touched (allowed only)

- `apps/web/src/components/consumer/push/PushSettings.tsx`
- `apps/web/src/styles/players.css`
- `apps/web/test/web-push.test.tsx`
- `apps/web/src/lib/releases.ts`
- `apps/web/src/lib/releases.test.ts`
- `apps/web/test/releases.test.tsx`
- `apps/web/test/releases-server.test.ts`
- `docs/handoffs/visual501-push-copy.md`

## Checks (author lane)

- Targeted `web-push.test.tsx`: SSR/pre-consent discoverability + iPhone copy; baseline consent/session/fence assertions; helper-only master-ON test removed with extraction prune.
- Release literals: historical alpha.42 seed exact (`accepted_at` `2026-11-07T11:55:54Z`); deployments 50→51; current alpha.43 notes #501-only Russian copy.
- No new dependencies / network / Git publish / runtime / PROD.

## Status

Source candidate only — before independent QA / Product CI / DEV.43. Independent Sol Medium QA → Product CI → merge `dev` → server DEV ACCEPTED → readonly browser 390/1280. Go Bad closes visual-qa Issue only after real PASS. No CI/DEV ACCEPTED / READY / Mode B claim by author.
