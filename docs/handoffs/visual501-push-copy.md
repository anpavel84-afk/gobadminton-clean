# Handoff — #501 Visual QA push discoverability (denied visibility + alpha.44)

**Assignment:** `OWNER_MEDIA_WEBP_ALL_SURFACES_AND_CONFIRMED_501_DENIED_FIX_RELEASE44`
**Author:** cursor:auto · attempt 6 · base `83ddeb3e1bda95f1d5003d089cadcf2e501c0aba`
**Refs:** #501 · #406 · combined bounded candidate for DEV.44
**Route:** `/profile/settings` (push)
**App candidate:** **0.1.0-alpha.44** / API **0.37.0** — `source_sha` null · Owner UAT **NOT_TESTED**
**UAT:** Owner / Go Bad / physical iPhone / provider = **NOT_TESTED**

## Actual alpha.43 browser FAIL (installed DEV; not product PASS)

Trusted server ACCEPTED receipt for 43: PR #504 / SHA `4614a000` / `r42372648654-a1` / `accepted_at` `2026-11-07T12:33:39Z` — **server ACCEPTED**, not UI PASS.

Installed-43 browser receipt (`visual501-alpha43-installed-browser/receipt.json`): `Notification.permission='denied'`, master OFF, title «Уведомления», **no** game/iPhone discoverability copy. Root cause: `showMasterOffHints` excluded `capability === "denied"`. Corrective **44** pending — **not** already PASS.

## Scope this pass

1. Remove **only** the `capability !== "denied"` visibility exclusion so game/postgame + iPhone pre-consent copy stays visible when the browser already blocked notifications (same real GoBad case). Preserve featureAvailable / master-OFF condition, retired return, disabled permission button, enable handler (still no opt-in when denied), session fences, defaults.
2. Do **not** make browser permission “ready”; do not change fixture expectations to force PASS; keep inline game fieldset / default OFF; no helper refactor; no profile CSS.
3. Regression: denied pre-consent SSR shows discoverability + iPhone copy; message-consent label unchanged; no `requestPermission` / auto-permission. Existing SSR case remains labeled as SSR (not live API-ready).
4. Root expected readback after DEV.44: readonly GET fixtures ready OFF/ON at 390/1280 with `Notification.permission=denied`, writes 0; no auth/provider/iPhone fiction.

## Paths touched (allowed only)

- `apps/web/src/components/consumer/push/PushSettings.tsx`
- `apps/web/test/web-push.test.tsx`
- `apps/web/src/lib/releases.ts` (+ tests) — alpha.44 notes; exact 43 server seed appended (51→52 deployments)
- `docs/handoffs/visual501-push-copy.md`
- `docs/handoffs/media406-webp-expansion.md`

## Status

Source candidate only — **no independent 44 QA yet**. Independent Codex Sol Medium → Product CI → merge `dev` → server DEV ACCEPTED → actual HTTP/GUI hints readback. Go Bad closes visual-qa Issue only after real PASS. No PROD / Mode B / full product PASS claim. Prior 43 UI FAIL retained separately from server ACCEPTED seed.
